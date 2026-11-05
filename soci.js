// Le richieste di registrazione alla sezione Inventario.
//
// Chi apre l'Inventario la prima volta dice nome e cognome e che e' socio;
// lo staff conferma dal gruppo Telegram. Finche' non c'e' risposta la
// richiesta non e' niente in Odoo, quindi vive qui, come le richieste di
// attivita' periodiche.
//
// Si tengono anche i "non e' socio" recenti: senza, chi viene respinto
// rimanda la stessa richiesta un minuto dopo, e lo staff se la ritrova.

import crypto from 'crypto';
import path from 'path';
import { DateTime } from 'luxon';
import { creaStore } from './jsonStore.js';

const ZONA = 'Europe/Rome';
const DIR = path.dirname(new URL(import.meta.url).pathname);
// Tenuto anche in memoria: richiestaDi si chiede a ogni apertura dell'app
// di chi non e' ancora sociə.
const store = creaStore(path.join(DIR, 'dati', 'registrazioni.json'), {
  vuoto: () => ({}),
  normalizza: (dati) => ({ richieste: dati?.richieste || {}, rifiutati: dati?.rifiutati || {} }),
});
const leggi = () => store.leggi();
const copia = () => store.copia();
const scrivi = (dati) => store.scrivi(dati);

// Dopo un "non e' socio" si puo' richiedere fra una settimana: abbastanza
// per non insistere, poco per chi e' stato respinto per sbaglio.
export const GIORNI_DOPO_RIFIUTO = 7;

// Oltre questo numero di richieste ancora senza risposta non se ne
// accettano altre: non e' un numero che si raggiunge per caso.
export const MAX_IN_ATTESA = 20;

export function quanteInAttesa() {
  return Object.keys(leggi().richieste).length;
}

export function richiestaDi(userId) {
  const trovata = Object.entries(leggi().richieste)
    .find(([, r]) => r.utente.id === String(userId));
  return trovata ? { id: trovata[0], ...structuredClone(trovata[1]) } : null;
}

export function salva(richiesta) {
  const dati = copia();
  const id = crypto.randomBytes(6).toString('hex');
  dati.richieste[id] = { ...richiesta, quando: DateTime.now().setZone(ZONA).toISO() };
  scrivi(dati);
  return id;
}

export function leggiRichiesta(id) {
  const r = Object.hasOwn(leggi().richieste, String(id)) ? leggi().richieste[id] : null;
  return r ? { id, ...structuredClone(r) } : null;
}

export function aggiorna(id, campi) {
  const dati = copia();
  if (!dati.richieste[id]) return false;
  dati.richieste[id] = { ...dati.richieste[id], ...campi };
  scrivi(dati);
  return true;
}

// Due persone dello staff premono insieme in due gruppi: decide la prima.
// Lettura e scrittura qui sono sincrone, quindi nessun'altra richiesta puo'
// infilarsi in mezzo.
export function prendiInCarico(id, daChi) {
  const dati = copia();
  const r = dati.richieste[id];
  if (!r) return { esito: 'sparita' };
  if (r.inCaricoA) return { esito: 'occupata', daChi: r.inCaricoA };
  r.inCaricoA = daChi;
  scrivi(dati);
  return { esito: 'presa', richiesta: { id, ...r } };
}

export function rilascia(id) {
  aggiorna(id, { inCaricoA: null });
}

export function chiudi(id) {
  const dati = copia();
  if (!dati.richieste[id]) return false;
  delete dati.richieste[id];
  scrivi(dati);
  return true;
}

export function segnaRifiutato(userId, daChi) {
  const dati = copia();
  dati.rifiutati[String(userId)] = { quando: DateTime.now().setZone(ZONA).toISO(), daChi };
  scrivi(dati);
}

// Fino a quando non puo' richiedere, o null se puo' gia'.
export function rifiutatoFinoA(userId) {
  const r = leggi().rifiutati[String(userId)];
  if (!r) return null;
  const fino = DateTime.fromISO(r.quando).plus({ days: GIORNI_DOPO_RIFIUTO });
  return fino > DateTime.now() ? fino.setZone(ZONA) : null;
}

export function dimenticaRifiuto(userId) {
  const dati = copia();
  if (!dati.rifiutati[String(userId)]) return;
  delete dati.rifiutati[String(userId)];
  scrivi(dati);
}

// Le richieste ancora senza risposta, dalla piu' vecchia.
export function inAttesa() {
  return Object.entries(leggi().richieste)
    .map(([id, r]) => ({ id, ...structuredClone(r) }))
    .sort((a, b) => String(a.quando).localeCompare(String(b.quando)));
}
