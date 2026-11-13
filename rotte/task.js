// ---------- task, per lo staff ----------
// Le cose da fare dello staff: sono le task del modulo Progetti di Odoo,
// quindi chi usa il gestionale le vede come sempre. Le vede e le cambia lo
// staff (gruppi staff o direttivo). Chi se ne occupa lo sa in chat: quando
// gliela assegnano, quando qualcuno la commenta o la chiude, e il giorno
// prima della scadenza (quello lo manda il bot, da interno.js).
//
// In Odoo (crocevia.miniapp): task_opzioni, task_elenco, task_dettaglio,
// task_salva, task_prendo, task_stato, task_commenta, task_foto, task_voce,
// e per il bot task_promemoria e task_settimana.

import express from 'express';
import { DateTime } from 'luxon';
import * as odoo from '../odoo.js';
import { ZONA } from '../config.js';
import { telegram, nomeTelegram } from '../telegram.js';
import { conUtente, soloStaff } from '../sessione.js';

export const router = express.Router();

const giornoTesto = (iso) => DateTime.fromISO(iso, { zone: ZONA }).setLocale('it').toFormat('cccc d MMMM');

// Un messaggio a ognuna delle persone, senza fermarsi se una ha bloccato il bot.
function avvisa(persone, testo) {
  for (const p of persone || []) {
    telegram('sendMessage', { chat_id: p.telegram_id, text: testo })
      .catch((err) => console.error(`task: avviso a ${p.nome} non mandato:`, err.message));
  }
}

const idTask = (b) => Number(b?.taskId) || 0;

router.post('/prenota/api/task/elenco', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloStaff(utente, res)) return;
  const fatte = Math.min(60, Math.max(0, Number(req.body?.fatteDaGiorni) || 0));
  const [task, opzioni] = await Promise.all([
    odoo.miniapp('task_elenco', utente.id, fatte),
    odoo.miniapp('task_opzioni'),
  ]);
  res.json({ task, ...opzioni });
}));

router.post('/prenota/api/task/dettaglio', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloStaff(utente, res)) return;
  if (!idTask(req.body)) return res.status(400).json({ errore: 'Quale task?' });
  // I numeri di Telegram restano qui.
  const { telegram: _tg, ...task } = await odoo.miniapp('task_dettaglio', idTask(req.body), utente.id);
  res.json({ task });
}));

// I nomi per "Chi se ne occupa": tutte le persone socie, cercate per nome.
router.post('/prenota/api/task/persone', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloStaff(utente, res)) return;
  const testo = String(req.body?.testo || '').trim().slice(0, 60);
  res.json({ persone: (await odoo.miniapp('cerca_soci', testo)).slice(0, 20) });
}));

function leggiTask(b) {
  const nome = String(b.nome || '').trim().slice(0, 200);
  if (!nome) return { errore: 'Dai un nome alla task.' };
  const scadenza = b.scadenza ? DateTime.fromISO(String(b.scadenza), { zone: ZONA }) : null;
  if (scadenza && !scadenza.isValid) return { errore: 'Che scadenza?' };
  const lista = (v, max) => (Array.isArray(v) ? v : []).slice(0, max);
  // L'inizio arriva col fuso (dal calendario) o gia' in UTC (da Odoo, senza
  // fuso): a Odoo va in UTC.
  const inizioEvento = (s) => {
    s = String(s || '').slice(0, 40);
    if (!s) return '';
    const d = /([zZ]|[+-]\d\d:\d\d)$/.test(s) ? DateTime.fromISO(s) : DateTime.fromISO(s.replace(' ', 'T'), { zone: 'utc' });
    return d.isValid ? d.toUTC().toFormat('yyyy-MM-dd HH:mm:ss') : '';
  };
  const evento = b.evento && typeof b.evento === 'object' ? {
    titolo: String(b.evento.titolo || '').slice(0, 200),
    inizio: inizioEvento(b.evento.inizio),
    sede: String(b.evento.sede || '').slice(0, 60),
    id: String(b.evento.id || '').slice(0, 200),
  } : false;
  return {
    valori: {
      nome,
      progetto_id: Number(b.progettoId) || 0,
      scadenza: scadenza ? scadenza.toISODate() : false,
      importante: Boolean(b.importante),
      persone: lista(b.persone, 20).map(Number).filter(Boolean),
      etichette: lista(b.etichette, 20).map(Number).filter(Boolean),
      etichette_nuove: lista(b.etichetteNuove, 5).map((x) => String(x).trim().slice(0, 40)).filter(Boolean),
      descrizione: String(b.descrizione || '').slice(0, 4000),
      checklist: lista(b.checklist, 30).map((x) => String(x).trim().slice(0, 200)).filter(Boolean),
      ripete: ['settimana', 'mese'].includes(b.ripete) ? b.ripete : false,
      evento,
    },
  };
}

router.post('/prenota/api/task/salva', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloStaff(utente, res)) return;
  const { errore, valori } = leggiTask(req.body || {});
  if (errore) return res.status(400).json({ errore });
  const esito = await odoo.miniapp('task_salva', utente.id, valori, idTask(req.body) || false, nomeTelegram(utente));
  const t = esito.task;
  avvisa(esito.avvisare, `${nomeTelegram(utente)} ti ha affidato la task “${t.nome}” (${t.progetto.nome})` +
    (t.scadenza ? `, da fare entro ${giornoTesto(t.scadenza)}.` : '.') + ' La trovi nell’app, scheda Task.');
  res.json({ task: t });
}));

router.post('/prenota/api/task/prendo', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloStaff(utente, res)) return;
  if (!idTask(req.body)) return res.status(400).json({ errore: 'Quale task?' });
  res.json({ task: await odoo.miniapp('task_prendo', utente.id, idTask(req.body)) });
}));

router.post('/prenota/api/task/stato', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloStaff(utente, res)) return;
  if (!idTask(req.body)) return res.status(400).json({ errore: 'Quale task?' });
  const fatta = Boolean(req.body?.fatta);
  const esito = await odoo.miniapp('task_stato', utente.id, idTask(req.body), fatta, nomeTelegram(utente));
  if (fatta) {
    avvisa(esito.avvisare, `${nomeTelegram(utente)} ha chiuso la task “${esito.task.nome}”.` +
      (esito.prossima?.scadenza ? ` La prossima è per ${giornoTesto(esito.prossima.scadenza)}.` : ''));
  }
  res.json({ task: esito.task, prossima: esito.prossima || null });
}));

router.post('/prenota/api/task/commenta', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloStaff(utente, res)) return;
  const testo = String(req.body?.testo || '').trim().slice(0, 2000);
  if (!idTask(req.body) || !testo) return res.status(400).json({ errore: 'Scrivi qualcosa.' });
  const esito = await odoo.miniapp('task_commenta', utente.id, idTask(req.body), testo);
  avvisa(esito.avvisare, `${nomeTelegram(utente)} sulla task “${esito.task}”: ${testo.slice(0, 600)}`);
  res.json({ ok: true });
}));

// La foto arriva gia' rimpicciolita dalla pagina, come quella delle restituzioni.
const FOTO_MAX_BYTE = 4 * 1024 * 1024;
router.post('/prenota/api/task/foto', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloStaff(utente, res)) return;
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.foto || ''));
  if (!idTask(req.body) || !m) return res.status(400).json({ errore: 'Questa foto non va: riprova.' });
  if (Buffer.byteLength(m[1], 'base64') > FOTO_MAX_BYTE) return res.status(400).json({ errore: 'La foto è troppo grande.' });
  const nome = `foto-${DateTime.now().setZone(ZONA).toFormat('yyyyMMdd-HHmm')}.jpg`;
  res.json(await odoo.miniapp('task_foto', utente.id, idTask(req.body), m[1], nome));
}));

router.post('/prenota/api/task/voce', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloStaff(utente, res)) return;
  const azione = String(req.body?.azione || '');
  if (!idTask(req.body) || !['aggiungi', 'spunta', 'togli'].includes(azione)) {
    return res.status(400).json({ errore: 'Cosa devo fare?' });
  }
  const voci = await odoo.miniapp('task_voce', idTask(req.body), azione,
    Number(req.body?.voceId) || false, String(req.body?.testo || '').slice(0, 200));
  res.json({ checklist: voci });
}));
