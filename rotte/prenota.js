// Le stanze, per chi usa l'app: disponibilita', prenotare, spostare,
// annullare, e chiedere che una prenotazione diventi periodica.

import express from 'express';
import { DateTime } from 'luxon';
import * as prenotazioni from '../prenotazioni.js';
import { ZONA, CATEGORIE, STAFF, CALENDARI, calendarioDi, nomeSede } from '../config.js';
import {
  getAuth, getAuthScrittura, componiDescrizione, inVetrina, noteDallEvento,
  detectCategoria, detectSede, eventiDiTutte, eventiVisibili, normalizeEvent, raggruppaInSerie,
} from '../calendario.js';
import { telegram, nomeTelegram, eStaff, eDirettivo } from '../telegram.js';
import { conUtente, controllaPrenotazione, mancaGruppo } from '../sessione.js';
import { chiediAlloStaff } from '../fisse.js';
import { inFila, taglia } from '../util.js';

export const router = express.Router();

// Il nome e le note finiscono nel calendario e nei messaggi allo staff:
// l'app ne fa scrivere meno, questi sono i tetti veri.
const TITOLO_MAX = 100;
const NOTE_MAX = 1000;

// Il controllo "c'e' posto?" e la scrittura che lo segue si fanno uno per
// volta per sede e giorno: due prenotazioni insieme vedrebbero tutte e due
// il posto libero, e in quelle ore ci sarebbero tre attivita'.
const lucchettoGiorno = (calendarId, giorno) => `posto:${calendarId}|${giorno.toISODate()}`;

router.post('/prenota/api/disponibilita', (req, res) => conUtente(req, res, async () => {
  const { sede, data, oraInizio, oraFine } = req.body || {};
  const calendarId = calendarioDi(sede);
  if (!calendarId) return res.status(400).json({ errore: 'Sede sconosciuta.' });

  const guai = prenotazioni.validaRichiesta({ data, oraInizio, oraFine });
  if (guai.length) return res.json({ ok: false, guai });

  const { inizio, fine } = prenotazioni.estremi(data, oraInizio, oraFine);
  const sovrapposti = await prenotazioni.occupazione(getAuth(), calendarId, inizio, fine);

  res.json({
    ok: true,
    guai: [],
    occupati: sovrapposti.length,
    eventi: sovrapposti.map((e) => ({ nome: e.nome, inizio: e.inizio, fine: e.fine })),
    pieno: sovrapposti.length >= prenotazioni.MAX_CONTEMPORANEI,
    secondo: sovrapposti.length === 1,
  });
}));

// Un mese per volta: l'app disegna il calendario e sa gia' quali giorni sono
// occupati e quali non hanno piu' un buco, senza chiedere giorno per giorno.
router.post('/prenota/api/mese', (req, res) => conUtente(req, res, async () => {
  const { sede, anno, mese } = req.body || {};
  const calendarId = calendarioDi(sede);
  if (!calendarId) return res.status(400).json({ errore: 'Sede sconosciuta.' });
  const a = Number(anno), m = Number(mese);
  if (!Number.isInteger(a) || !Number.isInteger(m) || m < 1 || m > 12) {
    return res.status(400).json({ errore: 'Anno o mese non validi.' });
  }
  res.json({ giorni: await prenotazioni.occupazioneDelMese(getAuth(), calendarId, a, m) });
}));

router.post('/prenota/api/prenota', (req, res) => conUtente(req, res, async (utente) => {
  const { sede, data, oraInizio, oraFine, titolo, note, serveApertura, categoria,
          fissa, ricorrenza, vetrina } = req.body || {};
  const nome = String(titolo || '').trim();
  const testoNote = String(note || '').trim();
  if (!nome) return res.status(400).json({ errore: 'Dai un nome all’attività.' });
  if (nome.length > TITOLO_MAX) {
    return res.status(400).json({ errore: `Il nome è troppo lungo: al massimo ${TITOLO_MAX} caratteri.` });
  }
  if (testoNote.length > NOTE_MAX) {
    return res.status(400).json({ errore: `Le note sono troppo lunghe: al massimo ${NOTE_MAX} caratteri.` });
  }
  const tipo = CATEGORIE.find((c) => c.slug === categoria);
  if (!tipo) return res.status(400).json({ errore: 'Scegli la categoria.' });
  if (fissa && !prenotazioni.RICORRENZE[ricorrenza]) {
    return res.status(400).json({ errore: 'Scegli ogni quanto si ripete.' });
  }
  const calendarId = controllaPrenotazione(res, utente, { sede, orari: { data, oraInizio, oraFine } });
  if (!calendarId) return;
  if (vetrina && !(await eDirettivo(utente.id))) {
    return res.status(403).json({ errore: 'Solo il direttivo mette le attività in vetrina.' });
  }

  const { inizio, fine } = prenotazioni.estremi(data, oraInizio, oraFine);

  // La parola chiave va in CIMA e da sola: il calendario pubblico guarda la
  // prima parola della descrizione, ed e' cosi' che l'attivita' esce con la
  // sua icona e il suo colore invece che con quelli di default.
  const descrizione = componiDescrizione({
    parola: tipo.parola,
    vetrina,
    note: testoNote,
    firma: `Prenotata da ${nomeTelegram(utente)} via Telegram.`,
  });

  const esito = await inFila(lucchettoGiorno(calendarId, inizio), async () => {
    const sovrapposti = await prenotazioni.occupazione(getAuth(), calendarId, inizio, fine);
    if (sovrapposti.length >= prenotazioni.MAX_CONTEMPORANEI) return { pieno: true };
    // Un'attivita' periodica non nasce adesso: la decide lo staff.
    if (fissa) return { sovrapposti };
    const evento = await prenotazioni.creaPrenotazione(getAuthScrittura(), calendarId, {
      titolo: nome,
      descrizione,
      inizio,
      fine,
      utente,
      serveApertura: Boolean(serveApertura),
    });
    return { sovrapposti, evento };
  });
  if (esito.pieno) return res.status(409).json({ errore: 'In quelle ore ci sono già due attività.' });

  // Un'attivita' periodica occupa quella fascia tutte le settimane: la approva
  // staff prima che esista, se no una richiesta di uno diventa una decisione
  // per tutti.
  if (fissa) {
    const chatStaff = STAFF.get(sede);
    if (!chatStaff) return mancaGruppo(res, 'staff di questa sede', 'lo staff');
    const idRichiesta = prenotazioni.salvaRichiesta({
      sede, data, oraInizio, oraFine, categoria,
      titolo: nome,
      note: testoNote,
      serveApertura: Boolean(serveApertura),
      ricorrenza,
      vetrina: Boolean(vetrina),
      utente,
    });
    const mandato = await chiediAlloStaff(idRichiesta, chatStaff, [
      `Richiesta di attivita periodica a ${nomeSede(sede)}.`,
      nome,
      `${prenotazioni.testoRicorrenza(ricorrenza, inizio)}, ` +
        `${inizio.toFormat('HH:mm')}-${fine.toFormat('HH:mm')}, ` +
        `dal ${inizio.setLocale('it').toFormat('d MMMM')}`,
      ...(serveApertura ? ['Chiede che qualcuno apra.'] : []),
      ...(testoNote ? [testoNote] : []),
    ], utente);
    if (!mandato) return res.status(500).json({ errore: 'Non sono riuscito ad avvisare lo staff: riprova.' });
    return res.json({ ok: true, inAttesa: true });
  }

  const { evento, sovrapposti } = esito;
  let avvisoStaff = null;
  if (serveApertura) {
    const chatStaff = STAFF.get(sede);
    if (!chatStaff) {
      console.error(`configurazione: manca il gruppo staff di ${sede}`);
      avvisoStaff = 'Non sono riuscito ad avvisare lo staff: avvisa in sede.';
    } else {
      try {
        await telegram('sendMessage', {
          chat_id: chatStaff,
          text:
            `Serve qualcuno che apra la sede di ${nomeSede(sede)}.\n` +
            `${inizio.setLocale('it').toFormat('cccc d MMMM')}, ` +
            `${inizio.toFormat('HH:mm')}-${fine.toFormat('HH:mm')}\n` +
            `${nome}\n` +
            `Chiede ${nomeTelegram(utente)}`,
          reply_markup: {
            inline_keyboard: [[{
              text: 'Apro io',
              callback_data: `apre:${sede}:${evento.id}`,
            }]],
          },
        });
      } catch (err) {
        // La prenotazione c'e' comunque: meglio dirlo a chi ha prenotato che
        // annullare tutto perche' un messaggio non e' partito. Il motivo
        // vero va nel log.
        console.error('prenota: staff non avvisato per l apertura:', err.message);
        avvisoStaff = 'Non sono riuscito ad avvisare lo staff: avvisa in sede.';
      }
    }
  }

  res.json({
    ok: true,
    eventId: evento.id,
    secondo: sovrapposti.length === 1,
    avvisoStaff,
  });
}));

// Le serie gia' in vetrina, per l'app: serve a dire a chi scrive il nome che
// quella data si unira' a quelle, e a fargli scegliere il titolo da un elenco
// invece di ridigitarlo. Un refuso qui non e' un refuso, e' una tessera in
// piu' sul calendario che va nel gruppo.
router.post('/prenota/api/serie', (req, res) => conUtente(req, res, async () => {
  const ora = DateTime.now().setZone(ZONA);
  const fino = ora.plus({ days: prenotazioni.GIORNI_AVANTI });

  const letti = await eventiDiTutte({ timeMin: ora.toISO(), timeMax: fino.toISO(), maxResults: 2500 }, {
    suErrore: (c, err) => console.error(`serie: calendario "${c.sede}" non leggibile: ${err.message}`),
  });

  // Stessi filtri della settimana: un evento copiato su due calendari va
  // contato una volta, e quelli segreti non esistono per nessuno.
  const aperti = eventiVisibili(letti)
    .filter(({ ev }) => inVetrina(ev.description))
    .map(({ ev, sede }) => normalizeEvent(ev, sede))
    .sort((a, b) => String(a.startISO).localeCompare(String(b.startISO)));

  res.json({
    serie: raggruppaInSerie(aperti).map((s) => ({
      chiave: s.chiave,
      nome: s.nome,
      date: s.date.map((d) => ({
        giorno: d.giorno, orainizio: d.orainizio, sedeNome: d.sedeNome,
      })),
    })),
  });
}));

router.post('/prenota/api/mie', (req, res) => conUtente(req, res, async (utente) => {
  const ora = DateTime.now().setZone(ZONA);
  const tutte = await prenotazioni.miePrenotazioni(
    getAuth(), CALENDARI, utente.id, ora, ora.plus({ days: 120 }));
  res.json({
    prenotazioni: tutte
      .filter((p) => DateTime.fromISO(p.fine) > ora)
      .sort((a, b) => a.inizio.localeCompare(b.inizio)),
  });
}));

router.post('/prenota/api/annulla', (req, res) => conUtente(req, res, async (utente) => {
  const { sede, eventId } = req.body || {};
  const calendarId = calendarioDi(sede);
  if (!calendarId) return res.status(400).json({ errore: 'Sede sconosciuta.' });
  if (!eventId) return res.status(400).json({ errore: 'Quale attività?' });

  const auth = getAuthScrittura();
  const evento = await prenotazioni.leggiPrenotazione(auth, calendarId, eventId);
  const proprietario = evento.extendedProperties?.private?.telegram_id;
  // Si annulla la propria, o qualsiasi se si e' staff.
  if (proprietario !== utente.id && !(await eStaff(utente.id))) {
    return res.status(403).json({ errore: 'Non è una tua attività.' });
  }
  // "Elimina la serie" arriva qui con l'id della serie intera: cancellarla
  // toglierebbe anche le date passate, che sono successe davvero. Si chiude
  // da adesso in poi, come fa lo staff.
  if (evento.recurrence?.length) {
    await prenotazioni.chiudiSerie(auth, calendarId, eventId, DateTime.now().setZone(ZONA));
  } else {
    await prenotazioni.annullaPrenotazione(auth, calendarId, eventId);
  }
  res.json({ ok: true });
}));

// Modifica la data di una prenotazione o di una data di serie: giorno, ora e
// sede. Stessi limiti della prenotazione normale e stessi controlli sulla
// sovrapposizione: la pagina e' riscrivibile, quindi si rifanno qui.
router.post('/prenota/api/sposta', (req, res) => conUtente(req, res, async (utente) => {
  const { sede, eventId, nuovaSede, data, oraInizio, oraFine } = req.body || {};
  const calendarId = calendarioDi(sede);
  const nuovoCalendario = controllaPrenotazione(res, utente, {
    sede: nuovaSede || sede, orari: { data, oraInizio, oraFine },
  });
  if (!nuovoCalendario) return;
  if (!calendarId) return res.status(400).json({ errore: 'Sede sconosciuta.' });
  if (!eventId) return res.status(400).json({ errore: 'Quale attività?' });

  const evento = await prenotazioni.leggiPrenotazione(getAuth(), calendarId, eventId);
  const proprietario = evento.extendedProperties?.private?.telegram_id;
  if (proprietario !== utente.id && !(await eStaff(utente.id))) {
    return res.status(403).json({ errore: 'Non è una tua attività.' });
  }

  const { inizio, fine } = prenotazioni.estremi(data, oraInizio, oraFine);
  const pieno = await inFila(lucchettoGiorno(nuovoCalendario, inizio), async () => {
    // L'occorrenza che si sposta non conta fra le sovrapposte: se resta nella
    // stessa sede, puo' anche stare in parte dov'era.
    const sovrapposti = (await prenotazioni.occupazione(getAuth(), nuovoCalendario, inizio, fine))
      .filter((ev) => !(nuovoCalendario === calendarId && ev.id === eventId));
    if (sovrapposti.length >= prenotazioni.MAX_CONTEMPORANEI) return true;
    await prenotazioni.spostaIstanza(getAuthScrittura(), {
      da: calendarId, nuova: nuovoCalendario, eventId, inizio, fine,
      // Un indirizzo che indica la sede di prima, nella sede nuova direbbe
      // il posto sbagliato; uno di fuori sede resta.
      tieniLuogo: (luogo) => detectSede(luogo, sede).sedeEsterna,
    });
    return false;
  });
  if (pieno) return res.status(409).json({ errore: 'In quelle ore ci sono già due attività.' });
  res.json({ ok: true });
}));

// Una prenotazione che diventa settimanale e' un'attivita' periodica come le
// altre, e quelle le decide lo staff: stessa richiesta, stessi due pulsanti,
// stesso percorso. L'evento di partenza resta dov'e' finche' non si approva,
// se no chi chiede rischia di perdere anche la settimana che aveva gia'.
router.post('/prenota/api/settimanale', (req, res) => conUtente(req, res, async (utente) => {
  const { sede, eventId } = req.body || {};
  const calendarId = controllaPrenotazione(res, utente, { sede });
  if (!calendarId) return;
  if (!eventId) return res.status(400).json({ errore: 'Quale attività?' });

  const evento = await prenotazioni.leggiPrenotazione(getAuthScrittura(), calendarId, eventId);
  const priv = evento.extendedProperties?.private || {};
  if (priv.telegram_id !== utente.id) {
    return res.status(403).json({ errore: 'Non è una tua attività.' });
  }
  if (priv.fissa === 'si' || evento.recurringEventId) {
    return res.status(409).json({ errore: 'Questa si ripete già ogni settimana.' });
  }

  const inizio = DateTime.fromISO(evento.start?.dateTime, { zone: ZONA });
  const fine = DateTime.fromISO(evento.end?.dateTime, { zone: ZONA });
  if (!inizio.isValid || !fine.isValid) {
    return res.status(400).json({ errore: 'Questa attività non ha un orario.' });
  }

  const chatStaff = STAFF.get(sede);
  if (!chatStaff) return mancaGruppo(res, 'staff di questa sede', 'lo staff');

  // Titolo e note vengono dall'evento, che su Calendar si scrive lungo
  // quanto si vuole: nel messaggio vanno coi tetti di sempre.
  const titolo = taglia(evento.summary || 'senza titolo', TITOLO_MAX);
  const note = taglia(noteDallEvento(evento.description), NOTE_MAX);
  const idRichiesta = prenotazioni.salvaRichiesta({
    sede,
    data: inizio.toISODate(),
    oraInizio: inizio.hour + inizio.minute / 60,
    oraFine: fine.hour + fine.minute / 60,
    categoria: detectCategoria(evento.description || ''),
    titolo,
    note,
    serveApertura: priv.serve_apertura === 'si',
    // Se era in vetrina ci resta: la cadenza cambia, non cosa e'.
    vetrina: inVetrina(evento.description),
    ricorrenza: 'settimanale',
    // Quando si approva, questo sparisce: la serie parte dallo stesso giorno,
    // e senza toglierlo quella settimana avrebbe la stessa cosa due volte.
    daEvento: eventId,
    utente,
  });

  const mandato = await chiediAlloStaff(idRichiesta, chatStaff, [
    `Una prenotazione vuole diventare settimanale, a ${nomeSede(sede)}.`,
    titolo,
    `Ogni ${inizio.setLocale('it').toFormat('cccc')}, ` +
      `${inizio.toFormat('HH:mm')}-${fine.toFormat('HH:mm')}, ` +
      `dal ${inizio.setLocale('it').toFormat('d MMMM')}`,
    ...(priv.serve_apertura === 'si' ? ['Chiede che qualcuno apra.'] : []),
    ...(note ? [note] : []),
  ], utente);
  if (!mandato) return res.status(500).json({ errore: 'Non sono riuscito ad avvisare lo staff: riprova.' });

  res.json({ ok: true, inAttesa: true });
}));
