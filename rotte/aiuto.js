// ---------- aiuto ----------
// Il pulsante "?" dell'app: a chi scrivere per la biblioteca e un modo per
// segnalare un problema. Le referenti della biblioteca sono le persone con
// la spunta "Amministra la biblioteca" in Odoo e Telegram collegato, le
// stesse a cui arrivano prestiti e restituzioni. Alla pagina va solo nome e
// username, per aprire la chat: il numero di Telegram resta qui.

import express from 'express';
import * as odoo from '../odoo.js';
import { GRUPPI } from '../config.js';
import { telegram, nomeTelegram, usernameDi } from '../telegram.js';
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
