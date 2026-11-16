// ---------- aiuto ----------
// Il pulsante "?" dell'app: a chi scrivere per la biblioteca e un modo per
// segnalare un problema. Le referenti della biblioteca sono le persone con
// la spunta "Amministra la biblioteca" in Odoo e Telegram collegato, le
// stesse a cui arrivano prestiti e restituzioni. Alla pagina va solo nome e
// username, per aprire la chat: il numero di Telegram resta qui.

import express from 'express';
import { DateTime } from 'luxon';
import * as odoo from '../odoo.js';
import { GRUPPI, ZONA } from '../config.js';
import { telegram, nomeTelegram, usernameDi, ErroreTelegram } from '../telegram.js';
import { conUtente } from '../sessione.js';
import { Cache } from '../util.js';

export const router = express.Router();

router.post('/prenota/api/aiuto', (req, res) => conUtente(req, res, async () => {
  let referenti = [];
  try {
    const persone = await odoo.miniapp('responsabili_biblioteca');
    referenti = await Promise.all(persone.map(async (p) => ({ nome: p.nome, username: await usernameDi(p.telegram_id) })));
  } catch (err) {
    console.error('aiuto: referenti non letti:', err.message);
  }
  res.json({ referenti });
}));

// Una segnalazione al gruppo del direttivo, con la pagina da cui parte. Poche
// per persona: tre ogni ora bastano a chi ha davvero un problema.
const SEGNALAZIONI_PER_ORA = 3;
const segnalazioni = new Cache(2000);
router.post('/prenota/api/aiuto/segnala', (req, res) => conUtente(req, res, async (utente) => {
  const testo = String(req.body?.testo || '').trim().slice(0, 1500);
  if (testo.length < 5) return res.status(400).json({ errore: 'Scrivi cosa non va, anche in poche parole.' });
  const ora = Date.now();
  const recenti = (segnalazioni.cerca(utente.id)?.valore || []).filter((t) => ora - t < 3600 * 1000);
  if (recenti.length >= SEGNALAZIONI_PER_ORA) {
    return res.status(429).json({ errore: 'Ne hai già mandate diverse: aspetta un po’, ti rispondiamo.' });
  }
  const chat = GRUPPI.get('direttivo');
  if (!chat) return res.status(503).json({ errore: 'Adesso non riesco a mandarla: scrivi al direttivo in sede.' });
  const NOMI_SCHEDE = { inventario: 'Biblioteca', mie: 'Attività', tessera: 'Tessera', task: 'Task' };
  const pagina = NOMI_SCHEDE[String(req.body?.pagina || '')] || '';
  await telegram('sendMessage', {
    chat_id: chat,
    text: `Segnalazione dall’app di ${nomeTelegram(utente)}${pagina ? ` (scheda ${pagina})` : ''}:\n\n${testo}`,
  });
  segnalazioni.metti(utente.id, [...recenti, ora]);
  res.json({ ok: true });
}));

// "I miei dati": lo stesso messaggio di /mydata, mandato in privato dal bot,
// con lo stesso pulsante per chiedere la cancellazione (lo gestisce il bot,
// callback "dati:"). Il testo segue _testo_dati del bot: se cambia uno, va
// cambiato anche l'altro.
function testoDati(d) {
  const righe = ['Ecco cosa tiene l’app di te:', '', `Nome: ${d.nome}`, `Telegram: id ${d.telegram_id}`];
  if (d.privacy) {
    const quando = DateTime.fromSQL(String(d.privacy), { zone: 'utc' }).setZone(ZONA);
    if (quando.isValid) righe.push(`Informativa accettata il ${quando.toFormat("dd/MM/yyyy 'alle' HH:mm")}`);
  }
  if (d.provvisorio) righe.push('Sociə: in attesa che il direttivo confermi');
  else if (d.socio) righe.push(`Sociə: sì${d.numero_socio ? `, n. ${d.numero_socio}` : ''}`);
  if (d.admin) righe.push('Amministri la biblioteca');
  const p = d.prestito;
  righe.push(p ? `Prestito in corso: “${p.titolo}” a ${p.sede}` : 'Nessun prestito in corso');
  righe.push(`Prestiti in tutto: ${d.prestiti_totali || 0}`);
  righe.push('', 'Se chiedi la cancellazione, il tuo Telegram si stacca subito: niente più ' +
    'app né promemoria. Il libro soci ha obblighi di conservazione suoi: ' +
    'per quello decide la segreteria, che viene avvisata.');
  return righe.join('\n');
}

router.post('/prenota/api/aiuto/miei-dati', (req, res) => conUtente(req, res, async (utente) => {
  const d = await odoo.miniapp('dati_personali', String(utente.id));
  const text = d ? testoDati(d) : 'L’app non ha dati tuoi: questo Telegram non è collegato a nessuna scheda.';
  try {
    await telegram('sendMessage', {
      chat_id: utente.id, text,
      ...(d ? { reply_markup: { inline_keyboard: [[{ text: 'Cancella i miei dati', callback_data: 'dati:chiedi' }]] } } : {}),
    });
  } catch (err) {
    if (!(err instanceof ErroreTelegram)) throw err;
    return res.status(502).json({ errore: 'Non riesco a scriverti: apri la chat con il bot e premi Avvia.' });
  }
  res.json({ ok: true });
}));
