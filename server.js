import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';
import { DateTime } from 'luxon';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;


const CALENDAR_ID = "4b70a04394809659390244a872836e10cc89e9016fdf66cd2f0a40c2a4830729@group.calendar.google.com"




// --- DRIVE API KEY (da drive_key.json) ---
const driveKeyPath = path.join(__dirname, 'drive_key.json');
const DRIVE_API_KEY = JSON.parse(fs.readFileSync(driveKeyPath, 'utf8')).APIKEY;

// --- Mappa categoria -> FolderID (Drive) ---
const FOLDER_IDS = {
  libro:        '1YrG1NvGF3EMi2xkr1zAjhbMd3QWGIl6V',
  mana:         '19Z4nL7IhDx9Ov4oZJHgUFkYH4OQMVS2f',
  disegno:      '1mLkzEL66s_OYvoftt3VFA4uqifS9PkyE',
  gdr:          '18I1scrhzo4n47RAih-IJGHQDVaDmeUXX',
  gdt:          '1RE2NTe_WXGb57sYHWHoZ-4rdB5YqUiP2',
};
 

const app = express();
app.use(cors());
// app.use(express.static('public'));
// esponi tutto ciò che sta in /public
app.use('/calendario', express.static(path.join(__dirname, 'public')));


// ---------- AUTH ----------
async function getAuth() {
  const keyFile = path.join(__dirname, 'calendar_key.json');

  return new google.auth.JWT({
    keyFile,
    scopes: [
        'https://www.googleapis.com/auth/calendar.readonly']
  });
}

// ---------- settimana corrente ----------
function getWeekRange(offsetWeeks = 0) {
    const now = DateTime.now().setZone('Europe/Rome');
    const start = now.startOf('week').plus({ days: 0, weeks: offsetWeeks });
    const end = start.plus({ days: 6 }).endOf('day');
    return {
        timeMin: start.toISO(),
        timeMax: end.toISO(),
        human: { start: start.toISODate(), end: end.toISODate() }
    };
}


function isOpen(googleEvent) {
    if (!googleEvent) {return}
    const s = (googleEvent.description || '').toLowerCase();
    const isEvent = s.includes('event');
    return isEvent;
}


// -------- mappatura categorie ------------
function loadEventTypeMap() {
  // Formato:  class: keyword1, keyword2, ...
  // Esempio riga: "gdr: gdr, rpg"  
  const file = new URL('./event_types.txt', import.meta.url).pathname;
  const txt = fs.readFileSync(file, 'utf8');
  const map = new Map(); // keyword -> class
  for (const rawLine of txt.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;    const [cls, rest] = line.split(':');
    if (!cls || !rest) continue;
    const className = cls.trim();
    const keywords = rest.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    for (const kw of keywords) map.set(kw, className);
  }
  return map;
}
const EVENT_TYPE_MAP = loadEventTypeMap();


// -------- mappatura sedi ------------
// La sede si ricava dal campo `location` nativo di Google Calendar, che e' gia'
// presente nella risposta di events.list: non costa una chiamata in piu'.
// Formato di sedi.txt:  slug | Nome mostrato | keyword1, keyword2, ...
function loadSediMap() {
  const file = new URL('./sedi.txt', import.meta.url).pathname;
  const sedi = new Map();      // slug -> nome mostrato
  const keywords = new Map();  // keyword -> slug
  if (!fs.existsSync(file)) return { sedi, keywords };
  const txt = fs.readFileSync(file, 'utf8');
  for (const rawLine of txt.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('|');
    if (parts.length < 3) continue;
    const slug = parts[0].trim();
    const nome = parts[1].trim();
    if (!slug) continue;
    sedi.set(slug, nome || slug);
    for (const kw of parts[2].split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) {
      keywords.set(kw, slug);
    }
  }
  return { sedi, keywords };
}
const { sedi: SEDI_NOMI, keywords: SEDI_KEYWORDS } = loadSediMap();
// Ora da cui parte la fascia disegnata sotto "Altre attivita'". Le colonne
// 17..23 nell'header di index.html partono da qui: se si cambia, va cambiato
// anche li'.
const ORA_INIZIO_FASCIA = 17;

// Sede a cui attribuire gli eventi che non hanno `location` valorizzato.
const SEDE_DEFAULT = process.env.SEDE_DEFAULT || 'barletta';

// `sedeCalendario` e' la sede da cui arriva l'evento, cioe' il calendario in cui
// e' stato inserito: e' il dato piu' affidabile che abbiamo. `location` serve
// solo a riconoscere gli eventi fuori sede.
function detectSede(location, sedeCalendario) {
  const raw = String(location || '').trim();
  const fallback = sedeCalendario || SEDE_DEFAULT;
  if (!raw) {
    // Nessuna location: l'evento e' nella sede del suo calendario.
    return {
      sede: fallback,
      sedeNome: SEDI_NOMI.get(fallback) || fallback,
      sedeEsterna: false,
      sedeIndirizzo: ''
    };
  }
  const s = raw.toLowerCase();
  for (const [kw, slug] of SEDI_KEYWORDS) {
    if (s.includes(kw)) {
      return {
        sede: slug,
        sedeNome: SEDI_NOMI.get(slug) || slug,
        sedeEsterna: false,
        sedeIndirizzo: raw
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
    sedeOrganizza: fallback
  };
}


// -------- calendari (uno per sede) ------------
// Formato di calendari.txt:  slug_sede | Calendar ID
// Aggiungere una sede = condividere il suo calendario in sola lettura con il
// service account e incollare qui l'ID. Nessuna modifica al codice.
function loadCalendari() {
  const file = new URL('./calendari.txt', import.meta.url).pathname;
  const out = [];
  if (fs.existsSync(file)) {
    for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const [sede, id] = line.split('|').map(s => s.trim());
      if (!sede || !id || id.startsWith('INCOLLA')) continue;
      out.push({ sede, id });
    }
  }
  // Se il file manca o e' vuoto restiamo sul calendario storico: cosi' il
  // servizio non si pianta mai per una questione di configurazione.
  if (!out.length) out.push({ sede: SEDE_DEFAULT, id: CALENDAR_ID });
  return out;
}
const CALENDARI = loadCalendari();
console.log('Calendari configurati:', CALENDARI.map(c => c.sede).join(', '));


function firstWordLower(s) {
  if (!s) return '';
  // prendi la prima parola e togli punteggiatura
  const w = s.trim().split(/\s+/)[0] || '';
  return w.toLowerCase().replace(/[.,;:!?#()\[\]{}"']/g, '');
}


function detectCategoria(description) {
  const first = firstWordLower(description);
  if (!first) return 'default';
  if (EVENT_TYPE_MAP.has(first)) return EVENT_TYPE_MAP.get(first);
  for (const [kw, cls] of EVENT_TYPE_MAP.entries()) {
    if (kw.includes(' ') && description.toLowerCase().startsWith(kw)) return cls;
  }
  return 'default';
}

function getDriveClient() {
  return google.drive({ version: 'v3', auth: DRIVE_API_KEY });
}

async function listPublicImages(folderId) {
  const drive = getDriveClient();
  const { data } = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
    fields: 'files(id,name)',
    pageSize: 1000,
  });
  return data.files || [];
}

// Restituisce l'id di un'immagine a caso della cartella, o null se la cartella
// non ha immagini visibili. Attenzione: "non visibili" comprende il caso in
// cui la cartella non e' condivisa in pubblico, perche' la chiamiamo con una
// API key e non con un utente: Drive risponde una lista vuota, non un errore.
async function scegliImmagineDrive(folderId) {
  const files = await listPublicImages(folderId); // files(id,name)
  if (!files.length) return null;
  return files[Math.floor(Math.random() * files.length)].id;
}

// L'URL di download vero. Contiene la API key, quindi non deve mai finire in
// una risposta JSON: si usa solo per scaricare lato server e ristreammare.
function urlDownloadDrive(fileId) {
  return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${DRIVE_API_KEY}`;
}


// Le schede chiedono la foto a /calendario/immagine/:categoria, che sceglie e
// scarica al momento. Qui segnaliamo soltanto le categorie che non hanno una
// cartella o che hanno una cartella senza immagini leggibili, se no una foto
// che non si vede non lascia traccia da nessuna parte.
async function enrichWithImages(items) {
  const gia = new Set();
  for (const it of items) {
    const slug = (it.categoria || '').toLowerCase();
    if (gia.has(slug)) continue;
    gia.add(slug);
    const folderId = FOLDER_IDS[slug];
    if (!folderId) {
      console.log(`Nessuna cartella Drive per la categoria "${slug}"`);
      continue;
    }
    const fileId = await scegliImmagineDrive(folderId);
    if (!fileId) {
      console.log(`La cartella Drive di "${slug}" non ha immagini visibili: e' vuota oppure non e' condivisa in pubblico`);
    }
  }
}




// ---------- Normalizzazione campi ----------
function normalizeEvent(ev, zone = 'Europe/Rome', sedeCalendario = null) {
    const startISO = ev.start?.dateTime || ev.start?.date;
    const endISO   = ev.end?.dateTime   || ev.end?.date;

    const start = DateTime.fromISO(startISO, { zone });
    const end   = DateTime.fromISO(endISO,   { zone });

    const dayKey   = start.toISODate(); 
    const dayNum = start.toFormat('dd'); 
    const dayAbbr = start.setLocale('it').toFormat('ccc').toUpperCase(); 


    let desc = ev.description || '';
    let verbose = '';
    if (desc.includes("desc:")) {
      const parts = desc.split("desc:");
      desc = parts[0].trim();
      verbose = parts.slice(1).join("desc:").trim(); 
    }

    let categoria = detectCategoria(desc);
    const sedeInfo = detectSede(ev.location, sedeCalendario);

    const tags = Array.from(
        new Set(
        [...String(desc).matchAll(/#\s*([\s\S]*?)(?=\s+#|$)/gu)]
            .map(m => m[1].trim().replace(/\s+/g, ' ').normalize('NFC'))
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
        raw: ev
    };
}

// ---------- API ----------
app.get('/calendario/immagine/:categoria', async (req, res) => {
    const categoria = req.params.categoria;

    try {
        // Qui passava `categoria` a una funzione che vuole l'id della cartella:
        // la query a Drive era `'gdr' in parents`, che non trova niente. Poi
        // faceva fetch di "/img/<id>", un percorso relativo che fetch non sa
        // risolvere. Risultato: si finiva sempre nel catch e la foto usciva
        // dalla cache locale, quindi Drive non e' mai stato davvero in uso.
        const folderId = FOLDER_IDS[categoria.toLowerCase()];
        if (!folderId) throw new Error(`nessuna cartella Drive per "${categoria}"`);

        const fileId = await scegliImmagineDrive(folderId);
        if (!fileId) throw new Error(`la cartella Drive di "${categoria}" non ha immagini visibili (vuota o non condivisa in pubblico)`);

        const response = await fetch(urlDownloadDrive(fileId));

        if (!response.ok) throw new Error(`Drive HTTP ${response.status}`);
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        // Il file si legge tutto in memoria prima di rispondere, invece di
        // ristreammarlo: sono locandine, non video, e se lo streaming si rompe
        // a meta' la risposta e' gia' partita e non si puo' piu' ripiegare
        // sulla cache locale. Cosi' o va tutto, o si finisce nel catch pulito.
        const immagine = Buffer.from(await response.arrayBuffer());
        res.setHeader('Content-Type', contentType);
        res.end(immagine);

    } catch (err) {
        console.error(`Drive fallito per ${categoria}:`, err.message);
        const fallbackPath = path.join(__dirname, 'public', 'imgcache', `${categoria}.jpg`);
        if (fs.existsSync(fallbackPath)) {
            res.setHeader('Content-Type', 'image/jpeg');
            fs.createReadStream(fallbackPath).pipe(res);
        } else {
            res.status(404).send('Nessuna immagine trovata');
        }
    }
});


// La pagina sta sotto /calendario, quindi il client chiama
// /calendario/api/weekly. Teniamo attivo anche /api/weekly, che e" il percorso
// storico usato da fuori.
app.get(['/api/weekly', '/calendario/api/weekly'], async (req, res) => {
  try {
    const offset = parseInt(req.query.offset || "0", 10); // di default 0 = questa settimana
    const auth = await getAuth();
    const calendar = google.calendar({ version: 'v3', auth });
    const { timeMin, timeMax, human } = getWeekRange(offset);

    // Un calendario per sede: li leggiamo tutti e li fondiamo in una settimana
    // sola. Se un calendario non e' leggibile (tipico: non ancora condiviso col
    // service account) lo saltiamo e lo segnaliamo, senza far cadere la
    // risposta: meglio mezzo calendario che una pagina rotta.
    const errori = [];
    const perCalendario = await Promise.all(CALENDARI.map(async (c) => {
      try {
        const { data } = await calendar.events.list({
          calendarId: c.id,
          singleEvents: true,
          timeMin,
          timeMax,
          orderBy: 'startTime',
          maxResults: 2500
        });
        return (data.items || []).map(ev => normalizeEvent(ev, 'Europe/Rome', c.sede));
      } catch (err) {
        const msg = String(err?.message || err);
        console.error(`Calendario "${c.sede}" (${c.id}) non leggibile: ${msg}`);
        errori.push({ sede: c.sede, errore: msg });
        return [];
      }
    }));

    let items = perCalendario.flat();

    // Lo stesso evento copiato su piu' calendari va contato una volta sola.
    // Deduplico sull'id e non su nome+orario, perche' la stessa attivita' puo'
    // girare davvero nelle due sedi alla stessa ora, e sono due eventi distinti.
    const visti = new Set();
    items = items.filter(ev => {
      if (!ev.id || visti.has(ev.id)) return !ev.id;
      visti.add(ev.id);
      return true;
    });

    items = items.filter(ev => {
      const desc = (ev.raw?.description || '').toLowerCase();
      return !desc.includes('segret');
    });

    // Ogni calendario arriva gia' ordinato, ma l'unione no.
    items.sort((a, b) => String(a.startISO).localeCompare(String(b.startISO)));

    // Gli aperti diventano schede, con l'orario scritto per esteso: li' un
    // evento della mattina si legge benissimo. I chiusi diventano barre sulla
    // fascia oraria, che parte dalle ORA_INIZIO_FASCIA, quindi quelli che
    // cominciano prima vanno lasciati fuori invece che disegnati all'ora
    // sbagliata.
    const aperti = [], chiusi = [], fuoriFascia = [];
    for (const item of items) {
      if (isOpen(item.raw)) aperti.push(item);
      else if (item.primaDellaFascia) fuoriFascia.push(item);
      else chiusi.push(item);
    }
    for (const ev of fuoriFascia) {
      console.log(`Fuori fascia, non disegnato: "${ev.nome}" ${ev.giorno} ${ev.orainizio}`);
    }

    await enrichWithImages(aperti);

    res.json({
      range: human,
      tz: 'Europe/Rome',
      offset,
      count: { aperti: aperti.length, chiusi: chiusi.length, totale: items.length },
      sedi: CALENDARI.map(c => c.sede),
      errori,
      aperti,
      chiusi
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server pronto su http://0.0.0.0:${PORT}`);
});
