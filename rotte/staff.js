// ---------- prenotazioni, per lo staff ----------
// Lo staff vede dall'app le prenotazioni dei prossimi giorni in tutte le
// sedi, dice "apro io", annulla una data, e decide le attivita' periodiche
// in attesa: le stesse cose che fa dai gruppi, senza aprire il calendario.

import express from 'express';
import { DateTime } from 'luxon';
import * as prenotazioni from '../prenotazioni.js';
import { ZONA, calendarioDi, nomeSede } from '../config.js';
import { getAuth, getAuthScrittura, eventiDiTutte, noteDallEvento } from '../calendario.js';
import { telegram, nomeTelegram } from '../telegram.js';
import { conUtente, soloStaff } from '../sessione.js';
import { approvaFissa } from '../fisse.js';

export const router = express.Router();

const GIORNI_PRENOTAZIONI_STAFF = 14;

router.post('/prenota/api/staff/prenotazioni', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloStaff(utente, res)) return;
  const adesso = DateTime.now().setZone(ZONA);
  const letti = await eventiDiTutte({
    timeMin: adesso.startOf('day').toISO(),
    timeMax: adesso.plus({ days: GIORNI_PRENOTAZIONI_STAFF }).endOf('day').toISO(),
    maxResults: 250,
  });
  const lista = letti.filter(({ ev }) => ev.start?.dateTime).map(({ ev, sede }) => {
    const priv = ev.extendedProperties?.private || {};
    return {
      id: ev.id,
      sede,
      sedeNome: nomeSede(sede),
      titolo: ev.summary || 'senza titolo',
      inizio: ev.start.dateTime,
      fine: ev.end?.dateTime,
      chi: priv.richiedente || '',
      serveApertura: priv.serve_apertura === 'si',
      apre: priv.apre || null,
      fissa: priv.fissa === 'si' || Boolean(ev.recurringEventId),
      serieId: ev.recurringEventId || null,
      // "Ogni giovedi'": per i dettagli di una serie nell'app.
      cadenza: ev.recurringEventId ? prenotazioni.testoRicorrenza(priv.ricorrenza || 'settimanale',
        DateTime.fromISO(ev.start.dateTime).setZone(ZONA)) : null,
      note: noteDallEvento(ev.description).slice(0, 300),
    };
  });
  const richieste = prenotazioni.elencoRichieste().map((r) => {
    const { inizio, fine } = prenotazioni.estremi(r.data, r.oraInizio, r.oraFine);
    return {
      id: r.id,
      sedeNome: nomeSede(r.sede),
      titolo: r.titolo,
      cadenza: `${prenotazioni.testoRicorrenza(r.ricorrenza || 'settimanale', inizio)}, ` +
               `${inizio.toFormat('HH:mm')}-${fine.toFormat('HH:mm')}, dal ${inizio.setLocale('it').toFormat('d MMMM')}`,
      chi: nomeTelegram(r.utente),
      serveApertura: Boolean(r.serveApertura),
    };
  });
  res.json({
    richieste,
    prenotazioni: lista.sort((a, b) => a.inizio.localeCompare(b.inizio)),
  });
}));

router.post('/prenota/api/staff/apro', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloStaff(utente, res)) return;
  const { sede, eventId, serieId, tutte } = req.body || {};
  const calendarId = calendarioDi(sede);
  if (!calendarId || !eventId) return res.status(400).json({ errore: 'Quale prenotazione?' });
  const chi = nomeTelegram(utente);
  // Per tutte le date di un'attivita' periodica si segna sulla serie: le
  // date la seguono, tranne quelle gia' toccate una per una.
  const gia = await prenotazioni.segnaChiApre(getAuthScrittura(), calendarId,
    tutte && serieId ? serieId : eventId, chi);
  if (gia) return res.status(409).json({ errore: `Apre già ${gia}.` });
  res.json({ ok: true, apre: chi });
}));

// Annullare una data: chi l'aveva prenotata lo sa da un messaggio. Di
// un'attivita' periodica si toglie solo quella volta.
router.post('/prenota/api/staff/annulla', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloStaff(utente, res)) return;
  const { sede, eventId } = req.body || {};
  const calendarId = calendarioDi(sede);
  if (!calendarId || !eventId) return res.status(400).json({ errore: 'Quale prenotazione?' });
  // Due righe dello staff per chi aveva prenotato: il perche', se c'e'.
  const messaggio = String(req.body?.messaggio || '').trim().slice(0, 500);
  const auth = getAuthScrittura();
  const evento = await prenotazioni.leggiPrenotazione(auth, calendarId, eventId);
  await prenotazioni.annullaPrenotazione(auth, calendarId, eventId);
  const telegramId = evento.extendedProperties?.private?.telegram_id;
  if (telegramId) {
    const quando = DateTime.fromISO(evento.start?.dateTime).setZone(ZONA).setLocale('it');
    telegram('sendMessage', {
      chat_id: telegramId,
      text: `Lo staff ha annullato “${evento.summary || 'la tua prenotazione'}” di ` +
            `${quando.toFormat('cccc d MMMM')} alle ${quando.toFormat('HH:mm')} ` +
            `a ${nomeSede(sede)}.` +
            (messaggio ? `\n\n${nomeTelegram(utente)} scrive: ${messaggio}`
              : ` Per sapere perché, scrivi a ${nomeTelegram(utente)}.`),
    }).catch((err) => console.error('annulla staff: messaggio non mandato:', err.message));
  }
  res.json({ ok: true });
}));

// Un'attivita' periodica intera, prima di chiuderla: cos'e', chi l'ha
// proposta, da quando va e quali date spariranno. Lo staff la guarda in una
// pagina sua, e solo da li' la chiude.
const GIORNI_SERIE_DA_MOSTRARE = 365;
const DATE_SERIE_DA_MOSTRARE = 8;

router.post('/prenota/api/staff/serie', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloStaff(utente, res)) return;
  const { sede, serieId } = req.body || {};
  const calendarId = calendarioDi(sede);
  if (!calendarId || !serieId) return res.status(400).json({ errore: 'Quale attività?' });
  const auth = getAuth();
  const serie = await prenotazioni.leggiPrenotazione(auth, calendarId, serieId);
  if (!serie.recurrence?.length || serie.status === 'cancelled') {
    return res.status(404).json({ errore: 'Questa serie non c’è più.' });
  }
  const priv = serie.extendedProperties?.private || {};
  const inizio = DateTime.fromISO(serie.start.dateTime).setZone(ZONA);
  const fine = DateTime.fromISO(serie.end.dateTime).setZone(ZONA);
  const adesso = DateTime.now().setZone(ZONA);
  const prossime = await prenotazioni.prossimeDellaSerie(auth, calendarId, serieId,
    adesso, adesso.plus({ days: GIORNI_SERIE_DA_MOSTRARE }));
  res.json({
    serie: {
      id: serieId,
      sede,
      sedeNome: nomeSede(sede),
      titolo: serie.summary || 'senza titolo',
      cadenza: prenotazioni.testoRicorrenza(priv.ricorrenza || 'settimanale', inizio),
      orario: `${inizio.toFormat('HH:mm')}-${fine.toFormat('HH:mm')}`,
      dal: inizio.toISODate(),
      cominciata: inizio < adesso,
      chi: priv.richiedente || '',
      avvisabile: Boolean(priv.telegram_id),
      quante: prossime.length,
      prossime: prossime.slice(0, DATE_SERIE_DA_MOSTRARE).map((ev) => ({
        inizio: ev.start.dateTime,
        apre: ev.extendedProperties?.private?.apre || null,
      })),
    },
  });
}));

// Chiudere la serie: le date da adesso in poi se ne vanno, quelle passate
// restano. Chi l'aveva proposta lo sa da un messaggio, con le due righe
// che lo staff ha voluto aggiungere.
router.post('/prenota/api/staff/annulla-serie', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloStaff(utente, res)) return;
  const { sede, serieId } = req.body || {};
  const calendarId = calendarioDi(sede);
  if (!calendarId || !serieId) return res.status(400).json({ errore: 'Quale attività?' });
  const messaggio = String(req.body?.messaggio || '').trim().slice(0, 500);
  const auth = getAuthScrittura();
  const serie = await prenotazioni.leggiPrenotazione(auth, calendarId, serieId);
  if (!serie.recurrence?.length || serie.status === 'cancelled') {
    return res.status(404).json({ errore: 'Questa serie non c’è più.' });
  }
  await prenotazioni.chiudiSerie(auth, calendarId, serieId, DateTime.now().setZone(ZONA));
  const telegramId = serie.extendedProperties?.private?.telegram_id;
  if (telegramId) {
    telegram('sendMessage', {
      chat_id: telegramId,
      text: `Lo staff ha chiuso l’attività periodica “${serie.summary || 'senza titolo'}” ` +
            `a ${nomeSede(sede)}: le prossime date non ci sono più.` +
            (messaggio ? `\n\n${nomeTelegram(utente)} scrive: ${messaggio}`
              : `\nPer sapere perché, scrivi a ${nomeTelegram(utente)}.`),
    }).catch((err) => console.error('annulla serie: messaggio non mandato:', err.message));
  }
  res.json({ ok: true });
}));

// Approvare o rifiutare un'attivita' periodica dall'app. Il messaggio nel
// gruppo staff perde i bottoni e riceve la risposta, cosi' nessuno ci
// ripensa da li'.
router.post('/prenota/api/staff/richiesta', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloStaff(utente, res)) return;
  const { id, scelta } = req.body || {};
  const richiesta = prenotazioni.leggiRichiesta(id);
  if (!richiesta) return res.status(404).json({ errore: 'Qualcuno ha già deciso questa richiesta.' });
  const chi = nomeTelegram(utente);
  let riga, avviso;
  if (scelta === 'si') {
    let esito;
    try {
      esito = await approvaFissa(id, chi);
    } catch (err) {
      if (!err.perUtente) throw err;
      return res.status(err.stato || 409).json({ errore: err.message });
    }
    riga = `Approvata dall’app da ${chi}. Da adesso è in calendario: ${esito.cadenza}.`;
    avviso = `Lo staff ha approvato “${richiesta.titolo}”: da adesso è in calendario. ` +
             `${esito.cadenza}. Il giorno prima ti chiedo se si fa, così puoi saltare una volta quando serve.`;
  } else {
    // Mentre qualcuno la sta approvando non si rifiuta: la serie sta gia'
    // nascendo.
    const occupata = prenotazioni.richiestaInCaricoA(id);
    if (occupata) return res.status(409).json({ errore: `Ci sta già pensando ${occupata}.` });
    prenotazioni.chiudiRichiesta(id);
    riga = `Rifiutata dall’app da ${chi}.`;
    avviso = `Lo staff non ha approvato “${richiesta.titolo}” come attività periodica. ` +
             'Puoi sempre prenotare una serata per volta.';
  }
  const m = richiesta.messaggio;
  if (m) {
    telegram('editMessageReplyMarkup', { chat_id: m.chat, message_id: m.id, reply_markup: { inline_keyboard: [] } })
      .catch(() => {});
    telegram('sendMessage', { chat_id: m.chat, text: riga, reply_parameters: { message_id: m.id } })
      .catch((err) => console.error('richiesta staff: gruppo non aggiornato:', err.message));
  }
  if (richiesta.utente?.id) {
    telegram('sendMessage', { chat_id: richiesta.utente.id, text: avviso })
      .catch((err) => console.error('richiesta staff: esito non mandato:', err.message));
  }
  res.json({ ok: true });
}));
