// La pagina manda qui i suoi errori JavaScript: senza, un pulsante che non
// risponde lo scopre solo chi lo preme. Non serve initData (un errore puo'
// capitare prima della registrazione), quindi il tetto va per indirizzo e
// gli errori diversi tenuti sono pochi. Il bot li legge col controllo di
// salute e li dice al direttivo, una volta per errore al giorno.

import { DateTime } from 'luxon';
import { ZONA } from './config.js';

const ERRORI_MAX = 30;
const erroriPagina = new Map();

const oggi = () => DateTime.now().setZone(ZONA).toISODate();

export function registraErrore(messaggio, dove, ip) {
  const chiave = `${messaggio}|${dove}`;
  const e = erroriPagina.get(chiave);
  if (e) {
    e.volte += 1;
    e.da.add(ip);
    return;
  }
  // Pieno: fa posto un errore gia' detto e non piu' tornato, prima quelli
  // detti un altro giorno. Se no, dopo trenta errori diversi in tutta la
  // vita del server non se ne sarebbe tenuto piu' nessuno.
  if (erroriPagina.size >= ERRORI_MAX) {
    const quieti = [...erroriPagina.entries()].filter(([, v]) => !v.volte);
    const via = quieti.find(([, v]) => v.detto !== oggi()) || quieti[0];
    if (!via) return;
    erroriPagina.delete(via[0]);
  }
  erroriPagina.set(chiave, { messaggio, dove, volte: 1, da: new Set([ip]), detto: null });
}

// Quelli da dire al direttivo: mai detti, o detti un altro giorno e
// tornati. Si segnano come detti. Quelli detti un altro giorno e mai
// tornati non servono piu' a niente, e se ne vanno.
export function erroriDaDire() {
  const giorno = oggi();
  const fuori = [];
  for (const [chiave, e] of erroriPagina) {
    if (!e.volte) {
      if (e.detto !== giorno) erroriPagina.delete(chiave);
      continue;
    }
    if (e.detto === giorno) continue;
    fuori.push({ messaggio: e.messaggio, dove: e.dove, volte: e.volte, persone: e.da.size });
    e.detto = giorno;
    e.volte = 0;
    e.da = new Set();
  }
  return fuori;
}
