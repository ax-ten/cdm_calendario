// Prenotazione delle stanze, per l'app dentro Telegram.
//
// Sta qui e non nel bot perche' qui ci sono gia' le chiavi di Google e la
// mappa sede -> calendario: le credenziali restano in un posto solo.
//
// Non c'e' un database. Chi ha prenotato, e se ha chiesto che qualcuno apra,
// stanno negli extendedProperties dell'evento di Google Calendar: sono dati
// dell'evento, e cosi' non esiste il caso in cui l'evento c'e' ma la riga nel
// database no. L'unica cosa che vive a parte e' l'elenco dei bloccati, che a
// un evento non appartiene.

import crypto from 'crypto';
import path from 'path';
import { DateTime } from 'luxon';
import { google } from 'googleapis';
import { creaStore } from './jsonStore.js';

const ZONA = 'Europe/Rome';

// Ogni sede regge due attivita' insieme, non di piu'.
export const MAX_CONTEMPORANEI = 2;
// La fascia in cui la sede e' prenotabile.
export const ORA_MINIMA = 16;
export const ORA_MASSIMA = 24;
// Oltre due mesi si prenota "per sicurezza" e poi non si disdice.
export const GIORNI_AVANTI = 60;

const DIR = path.dirname(new URL(import.meta.url).pathname);
// Tenuti anche in memoria: eBloccato si chiede quasi a ogni chiamata.
const bloccati = creaStore(path.join(DIR, 'dati', 'bloccati.json'));
const richieste = creaStore(path.join(DIR, 'dati', 'richieste.json'));


// ---------- identita' di chi apre l'app ----------
// Telegram firma i dati dell'utente con il token del bot. Verificarli e'
// l'unica cosa che ci separa da "chiunque conosca l'URL puo' prenotare a nome
// di chiunque": senza questo controllo l'app e' aperta al mondo.
export function verificaInitData(initData, botToken) {
  const parametri = new URLSearchParams(initData);
  const hash = parametri.get('hash');
  if (!hash) throw new Error('initData senza hash');
  parametri.delete('hash');

  const stringa = [...parametri.entries()]
    .map(([chiave, valore]) => `${chiave}=${valore}`)
    .sort()
    .join('\n');

  const segreto = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const atteso = crypto.createHmac('sha256', segreto).update(stringa).digest('hex');

  // timingSafeEqual vuole due buffer della stessa lunghezza: un hash storto
  // per lunghezza va scartato prima, se no butta un'eccezione al posto di un
  // "false".
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(atteso, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('firma non valida');
  }

  // Un initData vecchio e' un initData rubato: quello buono viene rigenerato
  // ogni volta che si apre l'app.
  const eta = DateTime.now().toSeconds() - Number(parametri.get('auth_date') || 0);
  if (!Number.isFinite(eta) || eta > 24 * 3600) {
    throw new Error('initData scaduto');
  }

  const utente = JSON.parse(parametri.get('user') || 'null');
  if (!utente || !utente.id) throw new Error('initData senza utente');
  return {
    id: String(utente.id),
    nome: [utente.first_name, utente.last_name].filter(Boolean).join(' ') || 'senza nome',
    username: utente.username || '',
    // Aperta dal link ...?startapp=debug: le cose ancora in prova. Lo
    // start_param sta dentro la firma, quindi non si inventa.
    debug: parametri.get('start_param') === 'debug',
  };
}


// ---------- blocchi ----------
export function eBloccato(userId) {
  return Boolean(bloccati.leggi()[String(userId)]);
}

export function blocca(userId, nome, daChi) {
  const dati = bloccati.copia();
  dati[String(userId)] = {
    nome,
    daChi,
    quando: DateTime.now().setZone(ZONA).toISO(),
  };
  bloccati.scrivi(dati);
}

export function sblocca(userId) {
  const dati = bloccati.copia();
  if (!dati[String(userId)]) return false;
  delete dati[String(userId)];
  bloccati.scrivi(dati);
  return true;
}

export function elencoBloccati() {
  return Object.entries(bloccati.leggi()).map(([id, v]) => ({ id, ...v }));
}


// -------- richieste di attivita' periodiche, in attesa dello staff --------
// Un'attivita' che si ripete ogni settimana occupa la stanza per sempre: la
// decide lo staff, non chi la chiede. Finche' non e' approvata non esiste
// sul calendario, quindi vive qui.
export function salvaRichiesta(richiesta) {
  const dati = richieste.copia();
  const id = crypto.randomBytes(6).toString('hex');
  dati[id] = { ...richiesta, quando: DateTime.now().setZone(ZONA).toISO() };
  richieste.scrivi(dati);
  return id;
}

export function leggiRichiesta(id) {
  const r = Object.hasOwn(richieste.leggi(), String(id)) ? richieste.leggi()[id] : null;
  return r ? structuredClone(r) : null;
}

export function elencoRichieste() {
  return Object.entries(richieste.leggi()).map(([id, r]) => ({ id, ...structuredClone(r) }));
}

export function aggiornaRichiesta(id, campi) {
  const dati = richieste.copia();
  if (!Object.hasOwn(dati, String(id))) return false;
  dati[id] = { ...dati[id], ...campi };
  richieste.scrivi(dati);
  return true;
}

export function chiudiRichiesta(id) {
  const dati = richieste.copia();
  if (!Object.hasOwn(dati, String(id))) return false;
  delete dati[id];
  richieste.scrivi(dati);
  return true;
}

// Due persone dello staff approvano insieme (una dal gruppo, una dall'app):
// decide la prima. Si segna qui, prima di qualsiasi chiamata a Google:
// lettura e scrittura sono sincrone, quindi nessun'altra richiesta puo'
// infilarsi in mezzo. Una presa in carico vecchia di qualche minuto e' di un
// tentativo morto a meta' (il server riavviato), e non blocca piu'.
const PRESA_VALIDA_PER_MS = 5 * 60 * 1000;

function inCarico(r) {
  return r?.inCaricoA && Date.now() - Number(r.inCaricoDal || 0) < PRESA_VALIDA_PER_MS
    ? r.inCaricoA : null;
}

export function prendiInCaricoRichiesta(id, daChi) {
  const r = leggiRichiesta(id);
  if (!r) return { esito: 'sparita' };
  const gia = inCarico(r);
  if (gia) return { esito: 'occupata', daChi: gia };
  aggiornaRichiesta(id, { inCaricoA: daChi || 'staff', inCaricoDal: Date.now() });
  return { esito: 'presa', richiesta: r };
}

export function rilasciaRichiesta(id) {
  aggiornaRichiesta(id, { inCaricoA: null, inCaricoDal: null });
}

// Chi la sta approvando, o null: una richiesta in approvazione non si
// rifiuta, se no si chiude mentre la serie sta nascendo.
export function richiestaInCaricoA(id) {
  return inCarico(leggiRichiesta(id));
}


// ---------- orari ----------
export function validaRichiesta({ data, oraInizio, oraFine }) {
  const guai = [];

  const giorno = DateTime.fromISO(data, { zone: ZONA });
  if (!giorno.isValid) return ['data non valida'];

  const oggi = DateTime.now().setZone(ZONA).startOf('day');
  if (giorno < oggi) guai.push('la data e gia passata');
  if (giorno > oggi.plus({ days: GIORNI_AVANTI })) {
    guai.push(`non si prenota oltre ${GIORNI_AVANTI} giorni`);
  }

  const inizio = Number(oraInizio);
  const fine = Number(oraFine);
  if (!Number.isFinite(inizio) || !Number.isFinite(fine)) return ['orari non validi'];
  if (inizio < ORA_MINIMA) guai.push(`non si prenota prima delle ${ORA_MINIMA}`);
  if (fine > ORA_MASSIMA) guai.push(`non si prenota oltre le ${ORA_MASSIMA}`);
  if (fine <= inizio) guai.push('l orario di fine deve venire dopo quello di inizio');

  return guai;
}

// Gli estremi in DateTime. La fine alle 24 e' la mezzanotte del giorno dopo:
// scriverla come "ora 24" sullo stesso giorno non esiste.
// L'ora si imposta sull'orologio del giorno, non si somma alla mezzanotte:
// nei due giorni del cambio d'ora la giornata dura 23 o 25 ore, e "mezzanotte
// piu' 16 ore" diventava le 15 o le 17. Le ore possono avere la mezz'ora
// (18.5 sono le 18:30).
function allOra(giorno, ore) {
  const n = Number(ore);
  const intere = Math.floor(n);
  const minuti = Math.round((n - intere) * 60);
  const base = intere >= 24 ? giorno.plus({ days: Math.floor(intere / 24) }).startOf('day') : giorno;
  return base.set({ hour: intere % 24, minute: minuti, second: 0, millisecond: 0 });
}

export function estremi(data, oraInizio, oraFine) {
  const giorno = DateTime.fromISO(data, { zone: ZONA }).startOf('day');
  return {
    inizio: allOra(giorno, oraInizio),
    fine: allOra(giorno, oraFine),
  };
}


// ---------- ricorrenze ----------
// Le cadenze che si possono chiedere. La chiave e' quella che viaggia fra app,
// richiesta ed evento; il testo e' quello che legge chi prenota.
export const RICORRENZE = {
  settimanale: 'ogni settimana',
  quindicinale: 'ogni due settimane',
  mensile: 'una volta al mese',
  giornoFisso: 'ogni mese, sempre lo stesso giorno',
};

// "il 17", ma "l'1", "l'8", "l'11".
export function articoloGiorno(n) {
  return [1, 8, 11].includes(n) ? `l'${n}` : `il ${n}`;
}

const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

// Una volta al mese vuol dire "il terzo giovedi'", non "il 16": un'attivita'
// si fissa su un giorno della settimana, e il 16 cade ogni mese in un giorno
// diverso. La quinta volta nel mese non esiste in tutti i mesi, quindi diventa
// l'ultima.
function settimanaDelMese(inizio) {
  const n = Math.ceil(inizio.day / 7);
  return n === 5 ? -1 : n;
}

export function regolaRicorrenza(ricorrenza, inizio) {
  if (ricorrenza === 'quindicinale') return 'RRULE:FREQ=WEEKLY;INTERVAL=2';
  if (ricorrenza === 'giornoFisso') return `RRULE:FREQ=MONTHLY;BYMONTHDAY=${inizio.day}`;
  if (ricorrenza === 'mensile') {
    return `RRULE:FREQ=MONTHLY;BYDAY=${settimanaDelMese(inizio)}${BYDAY[inizio.weekday - 1]}`;
  }
  return 'RRULE:FREQ=WEEKLY';
}

// "Ogni giovedi'", "Ogni due settimane, di giovedi'", "Ogni mese, il terzo
// giovedi'". Domenica e' l'unico giorno femminile, e l'ordinale va accordato.
export function testoRicorrenza(ricorrenza, inizio) {
  const giorno = inizio.setLocale('it').toFormat('cccc');
  if (ricorrenza === 'quindicinale') return `Ogni due settimane, di ${giorno}`;
  // Google salta i mesi in cui quel giorno non c'e': meglio dirlo prima.
  if (ricorrenza === 'giornoFisso') {
    return `Ogni mese, ${articoloGiorno(inizio.day)}` +
      (inizio.day > 28 ? ', saltando i mesi che non ce l\'hanno' : '');
  }
  if (ricorrenza === 'mensile') {
    const f = inizio.weekday === 7;
    const n = settimanaDelMese(inizio);
    const ordinale = n === -1
      ? (f ? "l'ultima" : "l'ultimo")
      : `${f ? 'la' : 'il'} ${(f ? ['prima', 'seconda', 'terza', 'quarta'] : ['primo', 'secondo', 'terzo', 'quarto'])[n - 1]}`;
    return `Ogni mese, ${ordinale} ${giorno}`;
  }
  return `Ogni ${giorno}`;
}


// ---------- Google Calendar ----------
function client(auth) {
  return google.calendar({ version: 'v3', auth });
}

// Eventi che si sovrappongono davvero all'intervallo chiesto. timeMin/timeMax
// di Google restituiscono anche quelli che lo sfiorano, quindi il confronto
// vero si rifa' qui: un evento che finisce quando il nostro comincia non e'
// una sovrapposizione.
export async function occupazione(auth, calendarId, inizio, fine) {
  const { data } = await client(auth).events.list({
    calendarId,
    singleEvents: true,
    orderBy: 'startTime',
    timeMin: inizio.toISO(),
    timeMax: fine.toISO(),
    maxResults: 50,
  });

  return (data.items || [])
    .filter((ev) => ev.status !== 'cancelled')
    .map((ev) => ({
      id: ev.id,
      nome: ev.summary || 'senza titolo',
      inizio: ev.start?.dateTime || ev.start?.date,
      fine: ev.end?.dateTime || ev.end?.date,
      // Chi ha prenotato dal bot lo sappiamo; gli altri eventi sono del
      // calendario e basta.
      telegramId: ev.extendedProperties?.private?.telegram_id || null,
    }))
    // Gli eventi di tutto il giorno hanno solo la data: va letta come
    // mezzanotte di qui, non dell'orologio del server (UTC). Contano come
    // occupazione di tutta la giornata, come prima.
    .filter((ev) => {
      const a = DateTime.fromISO(ev.inizio, { zone: ZONA });
      const b = DateTime.fromISO(ev.fine, { zone: ZONA });
      return b > inizio && a < fine;
    });
}

// Com'e' messo ogni giorno del mese, per disegnare il calendario dell'app.
// Un giorno e' "pieno" quando in tutta la fascia non resta mezz'ora libera:
// non basta che sia occupato, deve essere impossibile infilarcisi.
export async function occupazioneDelMese(auth, calendarId, anno, mese) {
  const primo = DateTime.fromObject({ year: anno, month: mese, day: 1 }, { zone: ZONA });
  const dopo = primo.plus({ months: 1 });

  const { data } = await client(auth).events.list({
    calendarId,
    singleEvents: true,
    orderBy: 'startTime',
    timeMin: primo.toISO(),
    timeMax: dopo.toISO(),
    maxResults: 500,
  });

  const perGiorno = new Map();
  for (const ev of data.items || []) {
    if (ev.status === 'cancelled') continue;
    const inizio = DateTime.fromISO(ev.start?.dateTime || ev.start?.date, { zone: ZONA });
    const fine = DateTime.fromISO(ev.end?.dateTime || ev.end?.date, { zone: ZONA });
    if (!inizio.isValid || !fine.isValid) continue;

    const giorno = inizio.toISODate();
    if (!perGiorno.has(giorno)) perGiorno.set(giorno, []);
    perGiorno.get(giorno).push({
      nome: ev.summary || 'senza titolo',
      // In ore decimali dalla mezzanotte: e' la stessa unita' con cui l'app
      // disegna la fascia, cosi' non deve riconvertire niente.
      da: inizio.hour + inizio.minute / 60,
      a: fine.hour + fine.minute / 60 + (fine.toISODate() !== giorno ? 24 : 0),
    });
  }

  const fuori = {};
  for (const [giorno, eventi] of perGiorno) {
    const dentro = eventi.filter(e => e.a > ORA_MINIMA && e.da < ORA_MASSIMA);
    let mezzoreLibere = 0;
    for (let h = ORA_MINIMA; h < ORA_MASSIMA; h += 0.5) {
      const insieme = dentro.filter(e => e.a > h && e.da < h + 0.5).length;
      if (insieme < MAX_CONTEMPORANEI) mezzoreLibere++;
    }
    fuori[giorno] = {
      occupati: dentro.length,
      pieno: dentro.length > 0 && mezzoreLibere === 0,
      eventi: dentro,
    };
  }
  return fuori;
}

// Le prenotazioni di una persona in un intervallo. Una chiamata per
// calendario e non una per settimana: prima ne servivano venti per riempire
// una schermata, e si vedeva.
export async function miePrenotazioni(auth, calendari, userId, da, a) {
  const perCalendario = await Promise.all(
    calendari.map(async (c) => {
      const { data: risposta } = await client(auth).events.list({
        calendarId: c.id,
        singleEvents: true,
        orderBy: 'startTime',
        timeMin: da.toISO(),
        timeMax: a.toISO(),
        privateExtendedProperty: `telegram_id=${userId}`,
        maxResults: 250,
      });
      return (risposta.items || [])
        .filter((ev) => ev.status !== 'cancelled')
        .map((ev) => ({
          id: ev.id,
          sede: c.sede,
          nome: ev.summary,
          inizio: ev.start?.dateTime,
          fine: ev.end?.dateTime,
          fissa: ev.extendedProperties?.private?.fissa === 'si',
          // Le serie nate prima delle cadenze non la dicono: erano tutte
          // settimanali.
          ricorrenza: ev.extendedProperties?.private?.ricorrenza || 'settimanale',
          // Con singleEvents gli id sono quelli delle singole occorrenze:
          // cancellarne uno salta quella settimana. Per chiudere la serie
          // serve l'id dell'evento madre, che e' un'altra cosa.
          serieId: ev.recurringEventId || null,
        }));
    })
  );
  return perCalendario.flat();
}

export async function creaPrenotazione(auth, calendarId, {
  titolo, descrizione, inizio, fine, utente, serveApertura, fissa, ricorrenza,
}) {
  const corpo = {
    summary: titolo,
    description: descrizione || '',
    start: { dateTime: inizio.toISO(), timeZone: ZONA },
    end: { dateTime: fine.toISO(), timeZone: ZONA },
    extendedProperties: {
      private: {
        telegram_id: String(utente.id),
        richiedente: utente.nome,
        username: utente.username || '',
        serve_apertura: serveApertura ? 'si' : 'no',
        fissa: fissa ? 'si' : 'no',
        ...(fissa ? { ricorrenza: ricorrenza || 'settimanale' } : {}),
      },
    },
  };
  // Un'attivita' periodica e' un evento solo che si ripete: cosi' la si sposta
  // la si chiude in un posto solo, invece di avere cinquantadue eventi
  // slegati che nessuno sa piu' governare.
  if (fissa) corpo.recurrence = [regolaRicorrenza(ricorrenza, inizio)];

  const { data } = await client(auth).events.insert({
    calendarId,
    requestBody: corpo,
  });
  return data;
}

// Le prossime occorrenze delle attivita' periodiche nate dal bot, con dentro chi
// le ha proposte: servono alla conferma settimanale.
export async function istanzeFisse(auth, calendari, da, a) {
  const perCalendario = await Promise.all(calendari.map(async (c) => {
    const { data } = await client(auth).events.list({
      calendarId: c.id,
      singleEvents: true,          // le ricorrenze arrivano gia' srotolate
      orderBy: 'startTime',
      timeMin: da.toISO(),
      timeMax: a.toISO(),
      privateExtendedProperty: 'fissa=si',
      maxResults: 100,
    });
    return (data.items || [])
      .filter((ev) => ev.status !== 'cancelled')
      .map((ev) => ({
        id: ev.id,
        sede: c.sede,
        titolo: ev.summary || 'senza titolo',
        inizio: ev.start?.dateTime,
        fine: ev.end?.dateTime,
        telegramId: ev.extendedProperties?.private?.telegram_id || null,
        richiedente: ev.extendedProperties?.private?.richiedente || '',
        serveApertura: ev.extendedProperties?.private?.serve_apertura === 'si',
      }));
  }));
  return perCalendario.flat();
}

// Salta una sola settimana: si cancella quell'istanza, non la serie. L'id di
// un'istanza e' gia' quello giusto da passare a delete.
export async function saltaIstanza(auth, calendarId, istanzaId) {
  await client(auth).events.delete({ calendarId, eventId: istanzaId });
}

// Sposta una sola data di una serie (o una prenotazione singola): cambia
// giorno, ora e, se serve, sede. Si modifica l'istanza, non la serie, cosi'
// le altre date restano dove sono.
// Cambiando sede non si puo' spostare l'istanza: Google sposta fra
// calendari solo eventi interi, non una data di una serie. Si crea allora
// un evento nuovo nel calendario della nuova sede, con titolo, descrizione
// e dati di chi ha prenotato, e si toglie la data vecchia: da quel momento
// e' una data a se'. Chi apriva apriva l'altra sede, quindi non si copia;
// e il luogo si copia solo se `tieniLuogo` dice che non indica la sede di
// prima (un indirizzo di fuori sede, per esempio).
export async function spostaIstanza(auth, { da, nuova, eventId, inizio, fine, tieniLuogo = () => false }) {
  const api = client(auth);
  const orari = {
    start: { dateTime: inizio.toISO(), timeZone: ZONA },
    end: { dateTime: fine.toISO(), timeZone: ZONA },
  };
  if (nuova === da) {
    await api.events.patch({ calendarId: da, eventId, requestBody: orari });
    return { calendarId: da, eventId };
  }

  const { data: vecchio } = await api.events.get({ calendarId: da, eventId });
  // Una serie intera (l'evento madre) invece si sposta com'e', con tutte le
  // sue date: e' un evento intero, e Google lo sa spostare.
  if (vecchio.recurrence?.length) {
    const { data } = await api.events.move({ calendarId: da, eventId, destination: nuova });
    await api.events.patch({ calendarId: nuova, eventId: data.id, requestBody: orari });
    return { calendarId: nuova, eventId: data.id };
  }
  const { apre, ...privati } = vecchio.extendedProperties?.private || {};
  // Una data staccata dalla serie non si ripete piu': per l'app e per la
  // conferma settimanale e' una prenotazione singola.
  if (vecchio.recurringEventId) {
    privati.fissa = 'no';
    delete privati.ricorrenza;
  }
  const corpo = {
    summary: vecchio.summary,
    description: String(vecchio.description || '')
      .split('\n').filter((riga) => !/^Apre: /.test(riga.trim())).join('\n'),
    ...orari,
    extendedProperties: {
      ...(vecchio.extendedProperties || {}),
      private: privati,
    },
  };
  if (vecchio.colorId) corpo.colorId = vecchio.colorId;
  if (vecchio.location && tieniLuogo(vecchio.location)) corpo.location = vecchio.location;

  const { data: nuovo } = await api.events.insert({ calendarId: nuova, requestBody: corpo });
  try {
    await api.events.delete({ calendarId: da, eventId });
  } catch (err) {
    // Senza togliere la vecchia ci sarebbero due date: si toglie la nuova e
    // si dice che non e' andata.
    await api.events.delete({ calendarId: nuova, eventId: nuovo.id })
      .catch((e) => console.error('sposta: la copia nella nuova sede e rimasta:', e.message));
    throw err;
  }
  return { calendarId: nuova, eventId: nuovo.id };
}

export async function leggiPrenotazione(auth, calendarId, eventId) {
  const { data } = await client(auth).events.get({ calendarId, eventId });
  return data;
}

export async function annullaPrenotazione(auth, calendarId, eventId) {
  await client(auth).events.delete({ calendarId, eventId });
}

// Le prossime date di una serie, da `da` in poi, quelle saltate escluse.
export async function prossimeDellaSerie(auth, calendarId, serieId, da, a) {
  const date = [];
  let pageToken;
  do {
    const { data } = await client(auth).events.instances({
      calendarId, eventId: serieId, timeMin: da.toISO(), timeMax: a.toISO(), maxResults: 250, pageToken,
    });
    date.push(...(data.items || []).filter(ev => ev.status !== 'cancelled' && ev.start?.dateTime));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return date;
}

// Una serie chiusa dallo staff finisce da `da` in poi: le date passate
// restano nel calendario, come quello che e' successo davvero. Se la serie
// non e' ancora cominciata se ne va tutta. Le date toccate a mano (chi apre,
// un orario spostato) sono eventi a se': se dopo il taglio ne resta
// qualcuna, si toglie una per una.
export async function chiudiSerie(auth, calendarId, serieId, da) {
  const serie = await leggiPrenotazione(auth, calendarId, serieId);
  if (DateTime.fromISO(serie.start?.dateTime || serie.start?.date) >= da) {
    await annullaPrenotazione(auth, calendarId, serieId);
    return;
  }
  const fino = da.toUTC().minus({ seconds: 1 }).toFormat("yyyyMMdd'T'HHmmss'Z'");
  const regole = (serie.recurrence || []).map(r => r.startsWith('RRULE:')
    ? r.replace(/;(UNTIL|COUNT)=[^;]*/g, '') + `;UNTIL=${fino}` : r);
  await client(auth).events.patch({ calendarId, eventId: serieId, requestBody: { recurrence: regole } });
  const restano = await prossimeDellaSerie(auth, calendarId, serieId, da, da.plus({ years: 2 }));
  for (const ev of restano) await annullaPrenotazione(auth, calendarId, ev.id);
}

// Chi ha detto "apro io" finisce nell'evento: fra due settimane nessuno si
// ricorda chi aveva le chiavi, e il messaggio in chat e' gia' scivolato via.
export async function segnaChiApre(auth, calendarId, eventId, chi) {
  const evento = await leggiPrenotazione(auth, calendarId, eventId);
  const precedenti = evento.extendedProperties?.private || {};
  if (precedenti.apre) return precedenti.apre;

  await client(auth).events.patch({
    calendarId,
    eventId,
    requestBody: {
      description: `${evento.description || ''}\nApre: ${chi}`.trim(),
      extendedProperties: { private: { ...precedenti, apre: chi } },
    },
  });
  return null;
}
