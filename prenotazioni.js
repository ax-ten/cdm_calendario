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
import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';
import { google } from 'googleapis';

const ZONA = 'Europe/Rome';

// Ogni sede regge due attivita' insieme, non di piu'.
export const MAX_CONTEMPORANEI = 2;
// La fascia in cui la sede e' prenotabile.
export const ORA_MINIMA = 16;
export const ORA_MASSIMA = 24;
// Oltre due mesi si prenota "per sicurezza" e poi non si disdice.
export const GIORNI_AVANTI = 60;

const DIR = path.dirname(new URL(import.meta.url).pathname);
const FILE_BLOCCATI = path.join(DIR, 'dati', 'bloccati.json');
const FILE_RICHIESTE = path.join(DIR, 'dati', 'richieste.json');


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
  };
}


// ---------- blocchi ----------
function leggiBloccati() {
  try {
    return JSON.parse(fs.readFileSync(FILE_BLOCCATI, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('bloccati.json illeggibile:', err.message);
    return {};
  }
}

function scriviBloccati(dati) {
  fs.mkdirSync(path.dirname(FILE_BLOCCATI), { recursive: true });
  const provvisorio = FILE_BLOCCATI + '.tmp';
  fs.writeFileSync(provvisorio, JSON.stringify(dati, null, 2));
  fs.renameSync(provvisorio, FILE_BLOCCATI);
}

export function eBloccato(userId) {
  return Boolean(leggiBloccati()[String(userId)]);
}

export function blocca(userId, nome, daChi) {
  const dati = leggiBloccati();
  dati[String(userId)] = {
    nome,
    daChi,
    quando: DateTime.now().setZone(ZONA).toISO(),
  };
  scriviBloccati(dati);
}

export function sblocca(userId) {
  const dati = leggiBloccati();
  if (!dati[String(userId)]) return false;
  delete dati[String(userId)];
  scriviBloccati(dati);
  return true;
}

export function elencoBloccati() {
  return Object.entries(leggiBloccati()).map(([id, v]) => ({ id, ...v }));
}


// ---------- richieste di attivita' fisse, in attesa dello staff ----------
// Un'attivita' che si ripete ogni settimana occupa la sala per sempre: la
// decide lo staff, non chi la chiede. Finche' non e' approvata non esiste
// sul calendario, quindi vive qui.
function leggiRichieste() {
  try {
    return JSON.parse(fs.readFileSync(FILE_RICHIESTE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('richieste.json illeggibile:', err.message);
    return {};
  }
}

function scriviRichieste(dati) {
  fs.mkdirSync(path.dirname(FILE_RICHIESTE), { recursive: true });
  const provvisorio = FILE_RICHIESTE + '.tmp';
  fs.writeFileSync(provvisorio, JSON.stringify(dati, null, 2));
  fs.renameSync(provvisorio, FILE_RICHIESTE);
}

export function salvaRichiesta(richiesta) {
  const dati = leggiRichieste();
  const id = crypto.randomBytes(6).toString('hex');
  dati[id] = { ...richiesta, quando: DateTime.now().setZone(ZONA).toISO() };
  scriviRichieste(dati);
  return id;
}

export function leggiRichiesta(id) {
  return leggiRichieste()[id] || null;
}

export function chiudiRichiesta(id) {
  const dati = leggiRichieste();
  if (!dati[id]) return false;
  delete dati[id];
  scriviRichieste(dati);
  return true;
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
export function estremi(data, oraInizio, oraFine) {
  const giorno = DateTime.fromISO(data, { zone: ZONA }).startOf('day');
  return {
    inizio: giorno.plus({ hours: Number(oraInizio) }),
    fine: giorno.plus({ hours: Number(oraFine) }),
  };
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
    .filter((ev) => {
      const a = DateTime.fromISO(ev.inizio);
      const b = DateTime.fromISO(ev.fine);
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
        }));
    })
  );
  return perCalendario.flat();
}

export async function creaPrenotazione(auth, calendarId, {
  titolo, descrizione, inizio, fine, utente, serveApertura, fissa,
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
      },
    },
  };
  // Un'attivita' fissa e' un evento solo che si ripete: cosi' la si sposta o
  // la si chiude in un posto solo, invece di avere cinquantadue eventi
  // slegati che nessuno sa piu' governare.
  if (fissa) corpo.recurrence = ['RRULE:FREQ=WEEKLY'];

  const { data } = await client(auth).events.insert({
    calendarId,
    requestBody: corpo,
  });
  return data;
}

// Le prossime occorrenze delle attivita' fisse nate dal bot, con dentro chi
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

export async function leggiPrenotazione(auth, calendarId, eventId) {
  const { data } = await client(auth).events.get({ calendarId, eventId });
  return data;
}

export async function annullaPrenotazione(auth, calendarId, eventId) {
  await client(auth).events.delete({ calendarId, eventId });
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
