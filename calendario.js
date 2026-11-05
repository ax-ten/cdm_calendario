// Google Calendar e Drive: le credenziali, la lettura degli eventi di tutte
// le sedi, e come un evento diventa una scheda o una barra del calendario
// pubblico.

import path from 'path';
import { google } from 'googleapis';
import { DateTime } from 'luxon';
import {
  DIR_BASE, ZONA, CALENDARI, EVENT_TYPE_MAP, ORDINE_CATEGORIE,
  SEDI_NOMI, SEDI_KEYWORDS, SEDE_DEFAULT, ORA_INIZIO_FASCIA,
  DRIVE_API_KEY, FOLDER_IDS,
} from './config.js';
import { memoria } from './util.js';

// Google di solito risponde in fretta; quando non risponde, una richiesta
// appesa tiene appesa anche la pagina. Vale per tutte le chiamate.
google.options({ timeout: 20 * 1000 });

// ---------- AUTH ----------
// Un client per tipo, creato una volta: googleapis rinnova il token da se'
// quando scade. Crearne uno a ogni chiamata voleva dire chiedere un token
// nuovo a Google a ogni richiesta.
const FILE_CHIAVE = path.join(DIR_BASE, 'calendar_key.json');

const authLettura = new google.auth.JWT({
  keyFile: FILE_CHIAVE,
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
});

// Auth separata per la scrittura. Il calendario pubblico continua a leggere
// con la sua, in sola lettura: se un giorno le prenotazioni vanno storte, il
// calendario che vede tutto il mondo non si porta dietro il problema.
const authScrittura = new google.auth.JWT({
  keyFile: FILE_CHIAVE,
  scopes: ['https://www.googleapis.com/auth/calendar.events'],
});

export const getAuth = () => authLettura;
export const getAuthScrittura = () => authScrittura;

const calendarApi = google.calendar({ version: 'v3', auth: authLettura });

// Gli eventi di tutte le sedi in un intervallo, uno dopo l'altro, ciascuno
// con la sede del calendario da cui viene: { ev, sede }. Ogni calendario
// arriva gia' ordinato, l'unione no.
// Con `suErrore` un calendario che non si legge (tipico: non ancora
// condiviso col service account) si salta e si segnala, invece di far
// cadere tutto: meglio mezzo calendario che una pagina rotta.
export async function eventiDiTutte(parametri, { suErrore } = {}) {
  const perCalendario = await Promise.all(CALENDARI.map(async (c) => {
    try {
      const { data } = await calendarApi.events.list({
        calendarId: c.id,
        singleEvents: true,
        orderBy: 'startTime',
        ...parametri,
      });
      return (data.items || []).map((ev) => ({ ev, sede: c.sede }));
    } catch (err) {
      if (!suErrore) throw err;
      suErrore(c, err);
      return [];
    }
  }));
  return perCalendario.flat();
}


// ---------- descrizione ----------
// Quello che mette un evento in vetrina e' una riga sola nella descrizione.
// Non la prima: la prima parola decide categoria, colore e icona.
export const RIGA_VETRINA = 'event';

// La descrizione di un evento ha un ordine che il calendario pubblico legge:
// la prima parola dice la categoria, RIGA_VETRINA apre la vetrina, e tutto
// quello che viene dopo "desc:" e' il testo che finisce sotto il titolo nella
// tessera. Percio' "desc:" va per ultimo: da li' in giu' e' tutta descrizione,
// e una riga di servizio finita dopo si leggerebbe in vetrina.
export function componiDescrizione({ parola, vetrina, note, firma }) {
  return [
    parola,
    vetrina ? RIGA_VETRINA : '',
    firma,
    note ? `desc: ${note}` : '',
  ].filter(Boolean).join('\n');
}

// La parola va cercata intera: cosi' com'era, "eventualmente si gioca a X"
// finiva in vetrina con tanto di foto, e nessuno avrebbe capito perche'.
export function inVetrina(descrizione) {
  return /\bevent\b/.test(String(descrizione || '').toLowerCase());
}

// Le righe che scrive il server: chi ha prenotato, chi ha proposto
// un'attivita' periodica, chi apre. Servono allo staff che guarda il
// calendario, non a chi guarda il calendario pubblico: li' ci sarebbero
// nome e username di chi ha prenotato.
const RIGA_DI_SERVIZIO = /^(Prenotata da |Attivita (fissa|periodica) proposta da |Apre: )/;
const senzaRigheDiServizio = (testo) => String(testo || '')
  .split('\n')
  .filter((riga) => !RIGA_DI_SERVIZIO.test(riga.trim()))
  .join('\n')
  .trim();

// La descrizione la scriviamo noi: parola chiave in cima, note in mezzo, in
// fondo la riga di chi ha prenotato (e volendo chi apre). Per rifare l'evento
// come attivita' periodica servono solo le note: il resto lo riscrive chi approva.
export function noteDallEvento(descrizione) {
  const testo = String(descrizione || '');
  // Dopo "desc:" c'e' gia' solo la descrizione: e' il taglio che fa anche il
  // calendario pubblico. "Apre:" pero' si aggiunge in fondo, quindi dopo.
  const taglio = testo.indexOf('desc:');
  if (taglio >= 0) return senzaRigheDiServizio(testo.slice(taglio + 'desc:'.length));
  // Gli eventi scritti prima, o a mano su Calendar, non hanno quel marcatore:
  // li si toglie riga per riga quello che abbiamo scritto noi.
  return senzaRigheDiServizio(testo
    .split('\n')
    .filter((riga, i) => !(i === 0 && EVENT_TYPE_MAP.has(riga.trim().toLowerCase())))
    .filter((riga) => riga.trim().toLowerCase() !== RIGA_VETRINA)
    .join('\n'));
}


// ---------- categorie e sedi ----------
function firstWordLower(s) {
  if (!s) return '';
  // prendi la prima parola e togli punteggiatura
  const w = s.trim().split(/\s+/)[0] || '';
  return w.toLowerCase().replace(/[.,;:!?#()\[\]{}"']/g, '');
}

export function detectCategoria(description) {
  const first = firstWordLower(description);
  if (!first) return 'default';
  if (EVENT_TYPE_MAP.has(first)) return EVENT_TYPE_MAP.get(first);
  for (const [kw, cls] of EVENT_TYPE_MAP.entries()) {
    if (kw.includes(' ') && description.toLowerCase().startsWith(kw)) return cls;
  }
  return 'default';
}

// Quello che non ha una categoria riconosciuta va in fondo: e' l'unico posto
// che non toglie il posto a nessuno.
function pesoCategoria(slug) {
  const posto = ORDINE_CATEGORIE.get(slug);
  return posto === undefined ? Number.MAX_SAFE_INTEGER : posto;
}

// `sedeCalendario` e' la sede da cui arriva l'evento, cioe' il calendario in cui
// e' stato inserito: e' il dato piu' affidabile che abbiamo. `location` serve
// solo a riconoscere gli eventi fuori sede.
export function detectSede(location, sedeCalendario) {
  const raw = String(location || '').trim();
  const fallback = sedeCalendario || SEDE_DEFAULT;
  if (!raw) {
    // Nessuna location: l'evento e' nella sede del suo calendario.
    return {
      sede: fallback,
      sedeNome: SEDI_NOMI.get(fallback) || fallback,
      sedeEsterna: false,
      sedeIndirizzo: '',
    };
  }
  const s = raw.toLowerCase();
  for (const [kw, slug] of SEDI_KEYWORDS) {
    if (s.includes(kw)) {
      return {
        sede: slug,
        sedeNome: SEDI_NOMI.get(slug) || slug,
        sedeEsterna: false,
        sedeIndirizzo: raw,
      };
    }
  }
  // Location valorizzata ma non riconducibile a una nostra sede: fuori sede.
  // `sedeOrganizza` dice comunque quale sede lo porta avanti.
  return {
    sede: 'esterna',
    sedeNome: raw.split(',')[0].trim(),
    sedeEsterna: true,
    sedeIndirizzo: raw,
    sedeOrganizza: fallback,
  };
}


// ---------- Vetrina ----------
// Lo stesso evento ripetuto in piu' giorni o in due sedi e' una cosa sola con
// piu' date, non tre cose che si chiamano uguale. La chiave e' il titolo
// normalizzato: non chiede di scrivere niente di nuovo, perche' le date di
// una serie nascono copiando la prima. Basta cambiare il titolo per separarle.
function chiaveSerie(nome) {
  return String(nome || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// L'ordine e' per categoria e non per orario. Una tessera con tre date in tre
// giorni non ha un posto nella cronologia: metterla al suo primo giorno
// direbbe che le altre due contano meno. Le barre qui sotto la cronologia
// ce l'hanno per intero, la vetrina fa un altro mestiere.
export function raggruppaInSerie(aperti) {
  const serie = new Map();
  for (const ev of aperti) {
    // Senza titolo non c'e' chiave: due eventi anonimi non sono la stessa
    // serie, sono due buchi diversi. L'id li tiene separati.
    const chiave = chiaveSerie(ev.nome) || `senza-titolo:${ev.id}`;
    if (!serie.has(chiave)) {
      serie.set(chiave, {
        chiave,
        nome: ev.nome,
        categoria: ev.categoria,
        // Della serie si mostra una descrizione sola, quella della prima
        // data. Se le altre dicono qualcosa di diverso, non erano la stessa
        // cosa e vanno chiamate con nomi diversi.
        descrizione: ev.descrizione,
        verbose: ev.verbose,
        tags: ev.tags,
        date: [],
      });
    }
    serie.get(chiave).date.push({
      startISO: ev.startISO,
      dayKey: ev.dayKey,
      giorno: ev.giorno,
      orainizio: ev.orainizio,
      orafine: ev.orafine,
      sede: ev.sede,
      sedeNome: ev.sedeNome,
      sedeEsterna: ev.sedeEsterna,
      sedeIndirizzo: ev.sedeIndirizzo,
    });
  }
  const fuori = [...serie.values()];
  for (const s of fuori) s.date.sort((a, b) => String(a.startISO).localeCompare(String(b.startISO)));
  fuori.sort((a, b) =>
    pesoCategoria(a.categoria) - pesoCategoria(b.categoria) ||
    String(a.date[0].startISO).localeCompare(String(b.date[0].startISO)));
  return fuori;
}


// ---------- Normalizzazione campi ----------
// Quello che il calendario pubblico mostra di un evento, e niente altro:
// l'evento di Google intero si porta dietro chi l'ha creato e, per quelli
// nati dall'app, id Telegram, nome e username di chi ha prenotato.
export function normalizeEvent(ev, sedeCalendario = null) {
  const startISO = ev.start?.dateTime || ev.start?.date;
  const endISO = ev.end?.dateTime || ev.end?.date;

  const start = DateTime.fromISO(startISO, { zone: ZONA });
  const end = DateTime.fromISO(endISO, { zone: ZONA });

  const dayKey = start.toISODate();
  const dayNum = start.toFormat('dd');
  const dayAbbr = start.setLocale('it').toFormat('ccc').toUpperCase();

  let desc = ev.description || '';
  let verbose = '';
  if (desc.includes('desc:')) {
    const parts = desc.split('desc:');
    desc = parts[0].trim();
    verbose = parts.slice(1).join('desc:').trim();
  }
  // La categoria si legge dalla descrizione intera (la prima parola), le
  // righe di servizio si tolgono da quello che si mostra.
  const categoria = detectCategoria(desc);
  desc = senzaRigheDiServizio(desc);
  verbose = senzaRigheDiServizio(verbose);
  const sedeInfo = detectSede(ev.location, sedeCalendario);

  const tags = Array.from(
    new Set(
      [...String(desc).matchAll(/#\s*([\s\S]*?)(?=\s+#|$)/gu)]
        .map((m) => m[1].trim().replace(/\s+/g, ' ').normalize('NFC'))
    )
  );

  const durataMinuti = Math.max(0, Math.round(end.diff(start, 'minutes').minutes));
  const riferimento = start.set({ hour: ORA_INIZIO_FASCIA, minute: 0 });
  const scarto = Math.round(start.diff(riferimento, 'minutes').minutes);
  const offsetMinuti = Math.max(0, scarto);
  // Chi comincia prima dell'inizio della fascia non ha un posto dove stare:
  // l'offset lo schiaccerebbe a zero e la barra si leggerebbe come se
  // l'evento iniziasse alle ORA_INIZIO_FASCIA, che e' semplicemente falso.
  const primaDellaFascia = scarto < 0;

  return {
    id: ev.id,
    nome: ev.summary || '',
    startISO: start.toISO(),
    categoria,
    ...sedeInfo,
    orainizio: start.toFormat('HH:mm'),
    orafine: end.toFormat('HH:mm'),
    giorno: start.setLocale('it').toFormat('EEEE d'),
    descrizione: desc,
    verbose,
    tags,
    immagine: null,
    durataMinuti,
    offsetMinuti,
    primaDellaFascia,
    dayNum,
    dayAbbr,
    dayKey,
  };
}

// Gli eventi da mostrare: lo stesso evento copiato su piu' calendari va
// contato una volta sola, e quelli segreti non esistono per nessuno.
// Deduplico sull'id e non su nome+orario, perche' la stessa attivita' puo'
// girare davvero nelle due sedi alla stessa ora, e sono due eventi distinti.
export function eventiVisibili(coppie) {
  const visti = new Set();
  return coppie.filter(({ ev }) => {
    if (ev.id) {
      if (visti.has(ev.id)) return false;
      visti.add(ev.id);
    }
    return !String(ev.description || '').toLowerCase().includes('segret');
  });
}


// ---------- settimana del calendario pubblico ----------
function getWeekRange(offsetWeeks = 0) {
  const now = DateTime.now().setZone(ZONA);
  const start = now.startOf('week').plus({ weeks: offsetWeeks });
  const end = start.plus({ days: 6 }).endOf('day');
  return {
    timeMin: start.toISO(),
    timeMax: end.toISO(),
    human: { start: start.toISODate(), end: end.toISODate() },
  };
}

// La pagina pubblica la apre chiunque, e i monitor in sede la ricaricano di
// continuo: una settimana si tiene due minuti invece di rileggere tutti i
// calendari a ogni visita. Una settimana letta a meta' (un calendario non
// risponde) non si tiene, cosi' alla prossima visita si riprova.
const SETTIMANA_VALIDA_PER_MS = 2 * 60 * 1000;
const settimane = memoria(SETTIMANA_VALIDA_PER_MS, 60);

export async function settimanaPubblica(offset) {
  const fatta = await settimane(offset, () => leggiSettimana(offset));
  if (fatta.errori.length) settimane.togli(offset);
  return fatta;
}

async function leggiSettimana(offset) {
  const { timeMin, timeMax, human } = getWeekRange(offset);

  // Il motivo vero va nel log: fuori si dice solo quale sede manca.
  const errori = [];
  const letti = await eventiDiTutte({ timeMin, timeMax, maxResults: 2500 }, {
    suErrore: (c, err) => {
      console.error(`Calendario "${c.sede}" (${c.id}) non leggibile: ${String(err?.message || err)}`);
      errori.push({ sede: c.sede, errore: 'calendario non leggibile' });
    },
  });

  // Gli aperti diventano schede, con l'orario scritto per esteso: li' un
  // evento della mattina si legge benissimo. I chiusi diventano barre sulla
  // fascia oraria, che parte dalle ORA_INIZIO_FASCIA, quindi quelli che
  // cominciano prima vanno lasciati fuori invece che disegnati all'ora
  // sbagliata.
  const visibili = eventiVisibili(letti);
  const items = [];
  const aperti = [], chiusi = [], fuoriFascia = [];
  for (const { ev, sede } of visibili) {
    const item = normalizeEvent(ev, sede);
    items.push(item);
    if (inVetrina(ev.description)) aperti.push(item);
    else if (item.primaDellaFascia) fuoriFascia.push(item);
    else chiusi.push(item);
  }
  const perInizio = (a, b) => String(a.startISO).localeCompare(String(b.startISO));
  aperti.sort(perInizio);
  chiusi.sort(perInizio);
  for (const ev of fuoriFascia) {
    console.log(`Fuori fascia, non disegnato: "${ev.nome}" ${ev.giorno} ${ev.orainizio}`);
  }

  const vetrina = raggruppaInSerie(aperti);

  return {
    range: human,
    tz: ZONA,
    offset,
    count: {
      aperti: aperti.length, vetrina: vetrina.length,
      chiusi: chiusi.length, totale: items.length,
    },
    sedi: CALENDARI.map((c) => c.sede),
    errori,
    // `vetrina` sono le schede, una per serie. `aperti` resta piatto, una
    // voce per data: serve alla vista di un giorno solo, dove ogni
    // occorrenza e' una barra per conto suo.
    vetrina,
    aperti,
    chiusi,
  };
}


// ---------- Drive ----------
const driveApi = google.drive({ version: 'v3', auth: DRIVE_API_KEY });

// Le immagini di una cartella cambiano di rado, e la pagina ne chiede una a
// ogni scheda: l'elenco si tiene dieci minuti. Una cartella vuota si tiene
// come vuota; un errore di Drive non si tiene.
const IMMAGINI_VALIDE_PER_MS = 10 * 60 * 1000;
const immaginiDi = memoria(IMMAGINI_VALIDE_PER_MS, 50);

async function listPublicImages(folderId) {
  return immaginiDi(folderId, async () => {
    const { data } = await driveApi.files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
      fields: 'files(id,name)',
      pageSize: 1000,
    }, { timeout: 15000 });
    return data.files || [];
  });
}

// Le categorie che /calendario/immagine accetta: quelle con una cartella su
// Drive e quelle che il calendario conosce (per la foto di riserva in
// public/imgcache). Il nome finisce in un percorso di file: tutto il resto
// si rifiuta.
const CATEGORIE_IMMAGINE = new Set([
  ...Object.keys(FOLDER_IDS), ...EVENT_TYPE_MAP.values(), 'default',
]);
export const categoriaImmagine = (c) => {
  const slug = String(c || '').toLowerCase();
  return CATEGORIE_IMMAGINE.has(slug) ? slug : null;
};

// Restituisce l'id di un'immagine a caso della cartella, o null se la cartella
// non ha immagini visibili. Attenzione: "non visibili" comprende il caso in
// cui la cartella non e' condivisa in pubblico, perche' la chiamiamo con una
// API key e non con un utente: Drive risponde una lista vuota, non un errore.
export async function scegliImmagineDrive(folderId) {
  const files = await listPublicImages(folderId);
  if (!files.length) return null;
  return files[Math.floor(Math.random() * files.length)].id;
}

// L'URL di download vero. Contiene la API key, quindi non deve mai finire in
// una risposta JSON: si usa solo per scaricare lato server e ristreammare.
export function urlDownloadDrive(fileId) {
  return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${DRIVE_API_KEY}`;
}
