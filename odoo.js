// Odoo, per la sezione Inventario dell'app dentro Telegram.
//
// Si parla con il modello crocevia.miniapp (modulo crocevia_miniapp) via
// JSON-RPC, con l'utente tecnico "Miniapp Telegram". Le regole stanno tutte
// li': un prestito per socio, trenta giorni, chi puo' agganciare chi. Qui si
// verifica solo chi e' la persona (initData) e se e' staff (gruppi Telegram).
//
// Le credenziali stanno in odoo.json, fuori dal repo come le chiavi di
// Google:  { "url": "...", "db": "crocevia", "login": "miniapp", "chiave": "..." }
// Senza il file l'Inventario resta spento e le stanze vanno come prima.

import fs from 'fs';
import path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);

function leggiConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(DIR, 'odoo.json'), 'utf8'));
    if (c.url && c.db && c.login && c.chiave) {
      return { ...c, url: String(c.url).replace(/\/+$/, '') };
    }
    console.error('odoo.json incompleto: servono url, db, login, chiave');
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('odoo.json illeggibile:', err.message);
  }
  return null;
}
const CONFIG = leggiConfig();

export const attivo = () => Boolean(CONFIG);

// Gli errori che Odoo scrive per chi usa l'app ("hai gia' un prestito
// aperto") vanno mostrati come sono. Gli altri sono guasti: a chi usa l'app
// non dicono niente, e finiscono nel log.
export class ErroreOdoo extends Error {
  constructor(messaggio, perUtente) {
    super(messaggio);
    this.perUtente = perUtente;
  }
}

const ERRORI_PER_UTENTE = new Set([
  'odoo.exceptions.UserError',
  'odoo.exceptions.ValidationError',
]);

async function rpc(service, method, args) {
  const risposta = await fetch(`${CONFIG.url}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args } }),
  });
  if (!risposta.ok) throw new ErroreOdoo(`Odoo HTTP ${risposta.status}`, false);
  const esito = await risposta.json();
  if (esito.error) {
    const dati = esito.error.data || {};
    throw new ErroreOdoo(dati.message || esito.error.message, ERRORI_PER_UTENTE.has(dati.name));
  }
  return esito.result;
}

// L'uid cambia solo se cambia l'utente: si chiede una volta.
let uid = null;
async function autentica() {
  if (uid) return uid;
  const trovato = await rpc('common', 'authenticate', [CONFIG.db, CONFIG.login, CONFIG.chiave, {}]);
  if (!trovato) throw new ErroreOdoo('Odoo ha rifiutato le credenziali di odoo.json', false);
  uid = trovato;
  return uid;
}

export async function miniapp(metodo, ...args) {
  if (!CONFIG) throw new ErroreOdoo('inventario non configurato: manca odoo.json', false);
  return rpc('object', 'execute_kw',
    [CONFIG.db, await autentica(), CONFIG.chiave, 'crocevia.miniapp', metodo, args]);
}
