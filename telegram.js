// Le chiamate a Telegram: messaggi, file, e chi sta in quale gruppo.

import { BOT_TOKEN, STAFF, GRUPPI } from './config.js';
import { Cache } from './util.js';

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Telegram di solito risponde in meno di un secondo: oltre questi tempi non
// risponde piu', e una richiesta appesa tiene appesa anche la pagina. I file
// (ricevute, foto) sono piu' grossi e ne hanno di piu'.
const TEMPO_MESSAGGI_MS = 10 * 1000;
const TEMPO_FILE_MS = 60 * 1000;

// Telegram rifiuta i messaggi oltre 4096 caratteri e le didascalie oltre
// 1024: meglio un messaggio tagliato che nessun messaggio.
const MAX_TESTO = 4096;
const MAX_DIDASCALIA = 1024;
const tagliaA = (t, max) => (t.length > max ? t.slice(0, max - 1) + '…' : t);

// Un "no" di Telegram (chat mai aperta col bot, bot bloccato) e' diverso
// da un Telegram che non risponde: chi chiama a volte li deve distinguere.
export class ErroreTelegram extends Error {}

async function esito(risposta, metodo) {
  const dati = await risposta.json();
  if (!dati.ok) throw new ErroreTelegram(`${metodo}: ${dati.description}`);
  return dati.result;
}

export async function telegram(metodo, payload) {
  const corpo = typeof payload?.text === 'string'
    ? { ...payload, text: tagliaA(payload.text, MAX_TESTO) }
    : payload;
  const risposta = await fetch(`${API}/${metodo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(TEMPO_MESSAGGI_MS),
  });
  return esito(risposta, metodo);
}

// Un file (sendDocument, sendPhoto): `campi` sono gli altri parametri, e
// quelli che non sono testo (reply_markup) vanno come JSON.
export async function mandaFile(metodo, campi, campoFile, contenuto, tipo, nomeFile) {
  const form = new FormData();
  for (const [k, v] of Object.entries(campi)) {
    if (v === undefined || v === null) continue;
    let testo = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (k === 'caption') testo = tagliaA(testo, MAX_DIDASCALIA);
    form.append(k, testo);
  }
  form.append(campoFile, new Blob([contenuto], { type: tipo }), nomeFile);
  const risposta = await fetch(`${API}/${metodo}`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(TEMPO_FILE_MS),
  });
  return esito(risposta, metodo);
}


// ---------- nomi ----------
export function nomeTelegram(utente) {
  return `${utente.nome}${utente.username ? ' (@' + utente.username + ')' : ''}`;
}

// I messaggi con parse_mode HTML: tutto quello che arriva da fuori passa di qui.
export const escHtml = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');


// ---------- gruppi ----------
// true, false, o null se Telegram non ha risposto: "non lo so" non e' "no",
// e non si deve tenere come un no.
async function membroDi(chatId, userId) {
  try {
    const membro = await telegram('getChatMember', { chat_id: chatId, user_id: userId });
    return ['creator', 'administrator', 'member'].includes(membro.status) ||
      (membro.status === 'restricted' && Boolean(membro.is_member));
  } catch (err) {
    console.error(`getChatMember su ${chatId}:`, err.message);
    return null;
  }
}

// Staff e direttivo si chiedono di continuo (a ogni apertura dell'app, a
// ogni annullamento), e ogni volta erano una domanda a Telegram per gruppo,
// una dopo l'altra. Si chiede ai gruppi tutti insieme, e la risposta si
// tiene un paio di minuti: chi esce da un gruppo lo perde poco dopo.
const GRUPPI_VALIDI_PER_MS = 2 * 60 * 1000;

function inUnoDi() {
  const visti = new Cache(5000);
  // true, false o null (non si sa) come membroDi.
  return async (chats, userId) => {
    const visto = visti.cerca(userId, GRUPPI_VALIDI_PER_MS);
    if (visto) return visto.valore;
    if (!chats.length) return false;
    const esiti = await Promise.all(chats.map((chat) => membroDi(chat, userId)));
    if (esiti.includes(true)) {
      visti.metti(userId, true);
      return true;
    }
    // Un gruppo non ha risposto (gia' nel log): "non so" non si tiene.
    if (esiti.includes(null)) return null;
    visti.metti(userId, false);
    return false;
  };
}
const statoStaff = inUnoDi();
const statoDirettivo = inUnoDi();

const chatStaff = () => [...STAFF.values()];
const chatDirettivo = () => (GRUPPI.get('direttivo') ? [GRUPPI.get('direttivo')] : []);

// Staff = chi sta in uno dei gruppi staff, qualunque. Lo chiediamo a Telegram
// invece di tenere una lista da aggiornare a mano: chi entra o esce dal gruppo
// e' gia' la decisione, e una lista finirebbe subito fuori sincrono.
export async function eStaff(userId) {
  return (await statoStaff(chatStaff(), userId)) === true;
}

// Il direttivo si riconosce allo stesso modo: sta nel suo gruppo.
export async function eDirettivo(userId) {
  return (await statoDirettivo(chatDirettivo(), userId)) === true;
}

// Direttivo o staff: lo dicono i gruppi Telegram, come per l'app. Per un
// elenco intero sono tante domande a Telegram: la risposta si tiene un'ora.
// Se Telegram non risponde non si tiene niente: un "nessun ruolo" sbagliato
// per un'ora toglierebbe la stellina a chi ce l'ha.
const RUOLI_VALIDI_PER_MS = 60 * 60 * 1000;
const ruoliVisti = new Cache(5000);

export async function ruoloDi(telegramId) {
  const visto = ruoliVisti.cerca(telegramId, RUOLI_VALIDI_PER_MS);
  if (visto) return visto.valore;
  const [direttivo, staff] = await Promise.all([
    statoDirettivo(chatDirettivo(), telegramId),
    statoStaff(chatStaff(), telegramId),
  ]);
  const ruolo = direttivo ? 'direttivo' : staff ? 'staff' : null;
  if (ruolo || (direttivo !== null && staff !== null)) ruoliVisti.metti(telegramId, ruolo);
  return ruolo;
}

// Lo username Telegram di una persona, per aprirle la chat (t.me/<username>).
// Lo sa Telegram (getChat), se la persona ha avviato il bot; si tiene un
// giorno, e chi non ne ha uno resta senza pulsante. Una chat mai aperta col
// bot e' una risposta (niente pulsante); un Telegram che non risponde no, e
// non si tiene.
const USERNAME_VALIDI_PER_MS = 24 * 60 * 60 * 1000;
const usernameVisti = new Cache(5000);

export async function usernameDi(telegramId) {
  const visto = usernameVisti.cerca(telegramId, USERNAME_VALIDI_PER_MS);
  if (visto) return visto.valore;
  try {
    const username = (await telegram('getChat', { chat_id: telegramId })).username || null;
    usernameVisti.metti(telegramId, username);
    return username;
  } catch (err) {
    if (err instanceof ErroreTelegram) usernameVisti.metti(telegramId, null);
    return null;
  }
}
