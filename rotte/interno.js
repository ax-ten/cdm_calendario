// ---------- rotte interne, per il bot ----------
// Il bot non e' una pagina dentro Telegram, quindi non ha un initData da
// firmare: si autentica con un segreto condiviso (segreto_interno.txt).
// Qui gli errori tornano col loro motivo: chi legge e' il bot, non chi usa
// l'app.

import express from 'express';
import crypto from 'crypto';
import { DateTime } from 'luxon';
import * as prenotazioni from '../prenotazioni.js';
import * as odoo from '../odoo.js';
import * as soci from '../soci.js';
import { ZONA, SEGRETO_INTERNO, GRUPPI, STAFF, calendarioDi, nomeSede } from '../config.js';
import { getAuthScrittura, eventiDiTutte } from '../calendario.js';
import { telegram } from '../telegram.js';
import { mancaGruppo, dimenticaSocio } from '../sessione.js';
import { approvaFissa } from '../fisse.js';
import { erroriDaDire } from '../erroriPagina.js';
import { testoCandidati, tastieraRegistrazione } from './account.js';

export const router = express.Router();

function soloBot(req, res) {
  if (!SEGRETO_INTERNO) {
    res.status(503).json({ errore: 'manca segreto_interno.txt' });
    return false;
  }
  const dato = req.get('X-Segreto') || '';
  const a = Buffer.from(dato);
  const b = Buffer.from(SEGRETO_INTERNO);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ errore: 'non autorizzato' });
    return false;
  }
  return true;
}

// Chi preme "Apro io" viene scritto nell'evento. Il primo che arriva vince:
// se due premono insieme, al secondo si dice chi c'era gia' invece di
// sovrascriverlo.
router.post('/prenota/api/interno/apre', async (req, res) => {
  if (!soloBot(req, res)) return;
  const { sede, eventId, chi } = req.body || {};
  const calendarId = calendarioDi(sede);
  if (!calendarId) return res.status(400).json({ errore: 'Sede sconosciuta.' });
  try {
    const gia = await prenotazioni.segnaChiApre(getAuthScrittura(), calendarId, eventId, chi);
    res.json({ ok: true, giaPreso: gia });
  } catch (err) {
    console.error('apre:', err.message);
    res.status(500).json({ errore: err.message });
  }
});

// Sospendere qualcuno e' cosa da staff, e lo staff sta nei gruppi Telegram:
// il posto giusto e' un comando li' dentro, non una scheda nell'app che il
// 95% di chi la apre non deve nemmeno vedere.
router.post('/prenota/api/interno/blocca', (req, res) => {
  if (!soloBot(req, res)) return;
  const { userId, nome, daChi, sblocca: togli } = req.body || {};
  if (!userId) return res.status(400).json({ errore: 'serve userId' });
  if (togli) {
    res.json({ ok: true, sbloccato: prenotazioni.sblocca(userId) });
  } else {
    prenotazioni.blocca(userId, nome || '', daChi || 'staff');
    res.json({ ok: true });
  }
});

router.post('/prenota/api/interno/bloccati', (req, res) => {
  if (!soloBot(req, res)) return;
  res.json({ bloccati: prenotazioni.elencoBloccati() });
});

// Lo staff ha detto si a un'attivita' periodica dal gruppo: adesso l'evento
// nasce, e si ripete con la cadenza chiesta.
router.post('/prenota/api/interno/approva', async (req, res) => {
  if (!soloBot(req, res)) return;
  const { id, daChi } = req.body || {};
  try {
    res.json({ ok: true, ...await approvaFissa(id, daChi) });
  } catch (err) {
    console.error('approva:', err.message);
    res.status(err.stato || (err.perUtente ? 404 : 500)).json({ errore: err.message });
  }
});

router.post('/prenota/api/interno/rifiuta', (req, res) => {
  if (!soloBot(req, res)) return;
  const { id } = req.body || {};
  const richiesta = prenotazioni.leggiRichiesta(id);
  if (!richiesta) return res.status(404).json({ errore: 'Richiesta non trovata.' });
  // Mentre qualcuno la sta approvando non si rifiuta: la serie sta gia'
  // nascendo.
  const occupata = prenotazioni.richiestaInCaricoA(id);
  if (occupata) return res.status(409).json({ errore: `Ci sta già pensando ${occupata}.` });
  prenotazioni.chiudiRichiesta(id);
  res.json({ ok: true, richiesta });
});

// Il direttivo ha risposto a una registrazione. `scelta` e' l'id della
// scheda da collegare, "nuovo" o "no". Il bot poi aggiorna il
// messaggio e scrive alla persona: per questo la risposta riporta la
// richiesta intera.
router.post('/prenota/api/interno/socio', async (req, res) => {
  if (!soloBot(req, res)) return;
  const { id, scelta, daChi } = req.body || {};
  const chi = daChi || 'staff';
  const presa = soci.prendiInCarico(id, chi);
  if (presa.esito === 'sparita') return res.status(404).json({ errore: 'Qualcuno ha già risposto.' });
  if (presa.esito === 'occupata') {
    return res.status(409).json({ errore: `Ci sta già pensando ${presa.daChi}.` });
  }
  const r = presa.richiesta;

  if (scelta === 'no') {
    // Con la scheda provvisoria, "no" chiude anche l'accesso all'app.
    if (r.provvisorio) {
      try {
        await odoo.miniapp('rifiuta_provvisorio', r.provvisorio, chi);
      } catch (err) {
        soci.rilascia(id);
        console.error('registrazione:', err.message);
        return res.status(err.perUtente ? 409 : 500).json({ errore: err.message });
      }
    }
    soci.chiudi(id);
    soci.segnaRifiutato(r.utente.id, chi);
    dimenticaSocio(r.utente.id);
    return res.json({ ok: true, esito: 'no', richiesta: r });
  }

  try {
    // Le richieste fatte prima della registrazione provvisoria non hanno una
    // scheda: per quelle valgono ancora i metodi di prima.
    const partner = scelta === 'nuovo' ? false : Number(scelta);
    const socio = r.provvisorio
      ? await odoo.miniapp('conferma_provvisorio', r.provvisorio, partner, chi)
      : scelta === 'nuovo'
        ? await odoo.miniapp('crea_socio', r.utente.id, r.nome, r.cognome, r.privacy, chi)
        : await odoo.miniapp('collega_socio', r.utente.id, partner, r.privacy, chi);
    soci.chiudi(id);
    soci.dimenticaRifiuto(r.utente.id);
    dimenticaSocio(r.utente.id);
    res.json({ ok: true, esito: scelta === 'nuovo' ? 'nuovo' : 'collegato', socio, richiesta: r });
  } catch (err) {
    // La richiesta resta aperta: lo staff puo' scegliere un'altra strada.
    soci.rilascia(id);
    console.error('registrazione:', err.message);
    res.status(err.perUtente ? 409 : 500).json({ errore: err.message });
  }
});

// Lo staff ha guardato la foto della restituzione e il bene non c'e': il
// prestito torna aperto, e chi l'aveva lo sa da un messaggio.
router.post('/prenota/api/interno/riapri', async (req, res) => {
  if (!soloBot(req, res)) return;
  const prestitoId = Number(req.body?.prestitoId);
  const chi = String(req.body?.daChi || 'staff');
  if (!prestitoId) return res.status(400).json({ errore: 'Quale prestito?' });
  try {
    const prestito = await odoo.miniapp('riapri_prestito', prestitoId, chi);
    if (prestito.riaperto && prestito.telegram_id) {
      telegram('sendMessage', {
        chat_id: prestito.telegram_id,
        text: `Lo staff di ${prestito.sede} non trova “${prestito.titolo}” in sede, ` +
              'quindi il prestito è di nuovo aperto. Se l’hai riportato, parlane con lo staff.',
      }).catch((err) => console.error('riapri: messaggio non mandato:', err.message));
    }
    res.json({ ok: true, prestito });
  } catch (err) {
    console.error('riapri:', err.message);
    res.status(err.perUtente ? 409 : 500).json({ errore: err.message });
  }
});

// /mydata: quello che l'app sa di chi scrive al bot.
router.post('/prenota/api/interno/dati', async (req, res) => {
  if (!soloBot(req, res)) return;
  const userId = String(req.body?.userId || '');
  if (!userId) return res.status(400).json({ errore: 'serve userId' });
  try {
    res.json({ dati: await odoo.miniapp('dati_personali', userId), richiesta: Boolean(soci.richiestaDi(userId)) });
  } catch (err) {
    console.error('dati:', err.message);
    res.status(500).json({ errore: err.message });
  }
});

// La persona chiede di togliere i suoi dati dall'app. Odoo stacca il
// Telegram; qui si chiude la registrazione ancora da decidere, se c'e', e si
// avvisa il direttivo, che per il resto (libro soci, prestiti passati) ha
// obblighi di conservazione da valutare.
router.post('/prenota/api/interno/cancella-dati', async (req, res) => {
  if (!soloBot(req, res)) return;
  const userId = String(req.body?.userId || '');
  const nome = String(req.body?.nome || '').slice(0, 120);
  if (!userId) return res.status(400).json({ errore: 'serve userId' });
  let esito;
  try {
    esito = await odoo.miniapp('cancella_dati', userId);
  } catch (err) {
    console.error('cancella dati:', err.message);
    return res.status(err.perUtente ? 409 : 500).json({ errore: err.message });
  }
  dimenticaSocio(userId);
  const richiesta = soci.richiestaDi(userId);
  if (richiesta) {
    soci.chiudi(richiesta.id);
    for (const m of richiesta.messaggi || []) {
      telegram('editMessageText', {
        chat_id: m.chat, message_id: m.id,
        text: `${richiesta.testo}\n\nRitirata: ha chiesto di cancellare i suoi dati.`,
        ...(richiesta.html ? { parse_mode: 'HTML' } : {}),
      }).catch((err) => console.error('cancella dati: messaggio non aggiornato:', err.message));
    }
  }
  const chatDirettivo = GRUPPI.get('direttivo');
  if (esito && chatDirettivo) {
    telegram('sendMessage', {
      chat_id: chatDirettivo,
      text: `${esito.nome} (Telegram ${nome || userId}) ha chiesto dal bot di cancellare i suoi dati.\n` +
            (esito.provvisorio
              ? 'La registrazione non era ancora confermata: la scheda provvisoria è archiviata e Telegram è scollegato.'
              : 'Telegram è scollegato dalla scheda, quindi niente più app né promemoria. ' +
                'Libro soci e storico dei prestiti restano: valutate voi cosa va conservato.'),
    }).catch((err) => console.error('cancella dati: direttivo non avvisato:', err.message));
  }
  res.json({ ok: true, esito });
});

// /registrazioni dal gruppo del direttivo: le richieste ancora senza
// risposta tornano in fondo alla chat, con i loro bottoni. Le copie vecchie
// restano e si aggiornano insieme alle nuove quando qualcuno decide.
router.post('/prenota/api/interno/registrazioni', async (req, res) => {
  if (!soloBot(req, res)) return;
  const chatDirettivo = GRUPPI.get('direttivo');
  if (!chatDirettivo) return mancaGruppo(res, 'direttivo', 'il direttivo');
  const richieste = soci.inAttesa();
  let mandate = 0;
  for (const r of richieste) {
    try {
      const candidati = await odoo.miniapp('candidati', r.nome, r.cognome);
      const quando = DateTime.fromISO(r.quando).setZone(ZONA).setLocale('it').toFormat('d MMMM');
      const m = await telegram('sendMessage', {
        chat_id: chatDirettivo,
        text: r.html
          ? `In attesa dal ${quando}.\n${r.testo}\n\n${testoCandidati(candidati, r.nome, r.cognome)}`
          : `In attesa dal ${quando}.\n${r.testo}`,
        ...(r.html ? { parse_mode: 'HTML' } : {}),
        reply_markup: { inline_keyboard: tastieraRegistrazione(r.id, candidati) },
      });
      soci.aggiorna(r.id, { messaggi: [...(r.messaggi || []), { chat: chatDirettivo, id: m.message_id }] });
      mandate += 1;
    } catch (err) {
      console.error('registrazioni:', err.message);
    }
  }
  res.json({ ok: true, inAttesa: richieste.length, mandate });
});

// Il bot chiede ogni pochi minuti se tutto risponde: se no avvisa il
// direttivo. Se non risponde nemmeno questa rotta, e' giu' il server.
// Il tempo massimo sta nella richiesta a Odoo, che allo scadere si chiude:
// prima si correva contro un timer, e la richiesta perdente restava appesa.
const SALUTE_TEMPO_MS = 15 * 1000;
router.post('/prenota/api/interno/salute', async (req, res) => {
  if (!soloBot(req, res)) return;
  const errori = erroriDaDire();
  if (!odoo.attivo()) return res.json({ odoo: 'non configurato', errori });
  try {
    await odoo.miniappConTempo(SALUTE_TEMPO_MS, 'socio_da_telegram', '0');
    res.json({ odoo: 'ok', errori });
  } catch (err) {
    res.json({ odoo: err.message, errori });
  }
});

// Ogni giorno: a chi ha un prestito che scade fra tre giorni, un messaggio
// in privato, finche' c'e' tempo per riportarlo o chiedere di prolungarlo.
const GIORNI_PRIMA = 3;
router.post('/prenota/api/interno/promemoria-scadenza', async (req, res) => {
  if (!soloBot(req, res)) return;
  let prestiti;
  try {
    prestiti = await odoo.miniapp('in_scadenza', GIORNI_PRIMA);
  } catch (err) {
    console.error('promemoria scadenza:', err.message);
    return res.status(500).json({ errore: err.message });
  }
  let mandati = 0;
  for (const p of prestiti) {
    const giorno = DateTime.fromISO(p.scadenza).setLocale('it').toFormat('cccc d MMMM');
    try {
      await telegram('sendMessage', {
        chat_id: p.telegram_id,
        text: `“${p.titolo}” va riportato a ${p.sede} entro ${giorno}. ` +
              'Se ti serve più tempo, chiedi allo staff di prolungarlo.',
      });
      mandati += 1;
    } catch (err) {
      console.error('promemoria scadenza: non mandato:', err.message);
    }
  }
  res.json({ ok: true, prestiti: prestiti.length, mandati });
});

// Il direttivo ha risposto a una richiesta di tesseramento: `scelta` e' il
// metodo con cui e' stata pagata la quota, o "no".
router.post('/prenota/api/interno/iscrizione', async (req, res) => {
  if (!soloBot(req, res)) return;
  const id = Number(req.body?.id);
  const scelta = String(req.body?.scelta || '');
  const chi = String(req.body?.daChi || 'direttivo');
  if (!id) return res.status(400).json({ errore: 'Quale richiesta?' });
  try {
    if (scelta === 'no') {
      const r = await odoo.miniapp('rifiuta_iscrizione', id, chi);
      if (r.telegram_id) {
        telegram('sendMessage', {
          chat_id: r.telegram_id,
          text: 'Il direttivo non ha approvato la tua richiesta di tesseramento. Se è un errore, parlane in sede.',
        }).catch((err) => console.error('iscrizione: esito non mandato:', err.message));
      }
      return res.json({ ok: true, esito: 'no' });
    }
    const socio = await odoo.miniapp('approva_iscrizione', id, scelta, chi);
    if (socio.telegram_id) dimenticaSocio(socio.telegram_id);
    res.json({ ok: true, esito: 'approvata', socio });
  } catch (err) {
    console.error('iscrizione:', err.message);
    res.status(err.perUtente ? 409 : 500).json({ errore: err.message });
  }
});

// A gennaio, una volta: chi ha Telegram collegato e non ha ancora la
// ricevuta di tesseramento dell'anno.
router.post('/prenota/api/interno/promemoria-tesseramento', async (req, res) => {
  if (!soloBot(req, res)) return;
  let daRinnovare;
  try {
    daRinnovare = await odoo.miniapp('da_rinnovare');
  } catch (err) {
    console.error('promemoria tesseramento:', err.message);
    return res.status(500).json({ errore: err.message });
  }
  const anno = DateTime.now().setZone(ZONA).year;
  let mandati = 0;
  for (const s of daRinnovare) {
    try {
      await telegram('sendMessage', {
        chat_id: s.telegram_id,
        text: `È cominciato il ${anno}: ricordati di rinnovare il tesseramento al Crocevia dei Mondi. ` +
              'La quota si paga in sede, alla prossima apertura.',
      });
      mandati += 1;
    } catch (err) {
      console.error('promemoria tesseramento: non mandato:', err.message);
    }
  }
  res.json({ ok: true, soci: daRinnovare.length, mandati });
});

// Il lunedi': a chi ha un prestito scaduto un messaggio in privato, e allo
// staff di ogni sede l'elenco di cosa manca e chi ce l'ha. Senza scaduti,
// nessun messaggio.
router.post('/prenota/api/interno/promemoria-prestiti', async (req, res) => {
  if (!soloBot(req, res)) return;
  let scaduti;
  try {
    scaduti = await odoo.miniapp('scaduti');
  } catch (err) {
    console.error('promemoria prestiti:', err.message);
    return res.status(500).json({ errore: err.message });
  }
  const giorno = (d) => DateTime.fromISO(d).setLocale('it').toFormat('d MMMM');
  let privati = 0;
  for (const p of scaduti) {
    if (!p.telegram_id) continue;
    try {
      await telegram('sendMessage', {
        chat_id: p.telegram_id,
        text: `“${p.titolo}” andava riportato a ${p.sede} entro il ${giorno(p.scadenza)}. ` +
              'Riportalo appena puoi; se ti serve più tempo, chiedilo allo staff.',
      });
      privati += 1;
    } catch (err) {
      console.error('promemoria prestiti: privato non mandato:', err.message);
    }
  }
  const perSede = new Map();
  for (const p of scaduti) {
    const chiave = String(p.sede || '').toLowerCase();
    perSede.set(chiave, [...(perSede.get(chiave) || []), p]);
  }
  for (const [sede, lista] of perSede) {
    const chat = STAFF.get(sede);
    if (!chat) continue;
    const righe = lista.map((p) => `- “${p.titolo}”, ${p.socio || '?'}: ` +
      (p.giorni_ritardo ? `scaduto il ${giorno(p.scadenza)}` : 'scade oggi'));
    telegram('sendMessage', {
      chat_id: chat,
      text: `Da riportare a ${lista[0].sede}:\n${righe.join('\n')}`,
    }).catch((err) => console.error('promemoria prestiti: staff non avvisato:', err.message));
  }
  res.json({ ok: true, scaduti: scaduti.length, privati });
});

// Salta una settimana di un'attivita' periodica: cancella quell'istanza sola.
router.post('/prenota/api/interno/salta', async (req, res) => {
  if (!soloBot(req, res)) return;
  const { sede, istanzaId } = req.body || {};
  const calendarId = calendarioDi(sede);
  if (!calendarId) return res.status(400).json({ errore: 'Sede sconosciuta.' });
  try {
    await prenotazioni.saltaIstanza(getAuthScrittura(), calendarId, istanzaId);
    res.json({ ok: true });
  } catch (err) {
    console.error('salta:', err.message);
    res.status(500).json({ errore: err.message });
  }
});

// Le prenotazioni di domani, per il promemoria.
router.post('/prenota/api/interno/domani', async (req, res) => {
  if (!soloBot(req, res)) return;
  try {
    const domani = DateTime.now().setZone(ZONA).plus({ days: 1 });
    const letti = await eventiDiTutte({
      timeMin: domani.startOf('day').toISO(),
      timeMax: domani.endOf('day').toISO(),
      maxResults: 50,
    });
    const lista = letti
      // Solo quelle nate dall'app: gli altri eventi del calendario non
      // hanno un proprietario a cui mandare un promemoria.
      .filter(({ ev }) => ev.extendedProperties?.private?.telegram_id)
      .map(({ ev, sede }) => ({
        id: ev.id,
        sede,
        sedeNome: nomeSede(sede),
        titolo: ev.summary || 'senza titolo',
        inizio: ev.start?.dateTime,
        fine: ev.end?.dateTime,
        telegramId: ev.extendedProperties.private.telegram_id,
        richiedente: ev.extendedProperties.private.richiedente || '',
        serveApertura: ev.extendedProperties.private.serve_apertura === 'si',
        fissa: ev.extendedProperties.private.fissa === 'si',
        apre: ev.extendedProperties.private.apre || null,
      }));
    res.json({ prenotazioni: lista });
  } catch (err) {
    console.error('domani:', err.message);
    res.status(500).json({ errore: err.message });
  }
});

// ---- task dello staff
// Ogni mattina, a chi se ne occupa: le task che scadono domani e quelle
// scadute ieri (una volta sola: poi c'e' il riepilogo del lunedi').
router.post('/prenota/api/interno/promemoria-task', async (req, res) => {
  if (!soloBot(req, res)) return;
  let task;
  try {
    task = await odoo.miniapp('task_promemoria');
  } catch (err) {
    console.error('promemoria task:', err.message);
    return res.status(500).json({ errore: err.message });
  }
  let mandati = 0;
  for (const t of task) {
    const testo = t.quando === 'domani'
      ? `Promemoria: la task “${t.nome}” (${t.progetto}) scade domani.`
      : `La task “${t.nome}” (${t.progetto}) è scaduta ieri. Se è fatta, segnala nell’app; se no, sposta la scadenza.`;
    for (const p of t.persone) {
      try {
        await telegram('sendMessage', { chat_id: p.telegram_id, text: testo });
        mandati += 1;
      } catch (err) {
        console.error(`promemoria task: a ${p.nome} non mandato:`, err.message);
      }
    }
  }
  res.json({ ok: true, task: task.length, mandati });
});

// Il lunedi', nei gruppi staff: le task scadute e quelle della settimana.
router.post('/prenota/api/interno/riepilogo-task', async (req, res) => {
  if (!soloBot(req, res)) return;
  let task;
  try {
    task = await odoo.miniapp('task_settimana');
  } catch (err) {
    console.error('riepilogo task:', err.message);
    return res.status(500).json({ errore: err.message });
  }
  if (!task.length) return res.json({ ok: true, task: 0, gruppi: 0 });
  const riga = (t) => `• ${t.nome} (${t.progetto}), ` +
    `${DateTime.fromISO(t.scadenza, { zone: ZONA }).setLocale('it').toFormat('ccc d MMM')}` +
    (t.persone.length ? `, ${t.persone.join(', ')}` : ', nessuno se ne occupa');
  const scadute = task.filter((t) => t.scaduta);
  const settimana = task.filter((t) => !t.scaduta);
  const testo = ['Le task della settimana.',
    ...(scadute.length ? ['', 'Scadute:', ...scadute.map(riga)] : []),
    ...(settimana.length ? ['', 'Nei prossimi sette giorni:', ...settimana.map(riga)] : []),
    '', 'Si gestiscono dall’app, scheda Task.'].join('\n');
  let gruppi = 0;
  for (const chat of new Set(STAFF.values())) {
    try {
      await telegram('sendMessage', { chat_id: chat, text: testo });
      gruppi += 1;
    } catch (err) {
      console.error('riepilogo task: gruppo staff non avvisato:', err.message);
    }
  }
  res.json({ ok: true, task: task.length, gruppi });
});
