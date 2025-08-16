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
app.use(express.static('public'));

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
    const s = (googleEvent.description).toLowerCase();
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
    if (!line || line.startsWith('#')) continue;
    const [cls, rest] = line.split(':');
    if (!cls || !rest) continue;
    const className = cls.trim();
    const keywords = rest.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    for (const kw of keywords) map.set(kw, className);
  }
  return map;
}
const EVENT_TYPE_MAP = loadEventTypeMap();


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

async function getRandomImageFromDrive(folderId) {
  const files = await listPublicImages(folderId); // files(id,name)
  if (!files.length) return null;
  const f = files[Math.floor(Math.random() * files.length)];
  // invece di un link esterno:
  return `/img/${f.id}`; // sarà servito dal tuo backend
}


async function enrichWithImages(items) {
  for (const it of items) {
    const slug = (it.categoria).toLowerCase();
    const folderId = FOLDER_IDS[slug];
    if (!folderId) {
        console.log("non ho trovato una cartella per ", slug)
        continue
    };
    const url = await getRandomImageFromDrive(folderId);
    if (url) it.immagine = url;
  }
}




// ---------- Normalizzazione campi ----------
function normalizeEvent(ev, zone = 'Europe/Rome') {
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

    const tags = Array.from(
        new Set(
        [...String(desc).matchAll(/#\s*([\s\S]*?)(?=\s+#|$)/gu)]
            .map(m => m[1].trim().replace(/\s+/g, ' ').normalize('NFC'))
        )
    );

    const durataMinuti = Math.max(0, Math.round(end.diff(start, 'minutes').minutes));
    const riferimento = start.set({ hour: 17, minute: 0 });
    const offsetMinuti = Math.max(0, Math.round(start.diff(riferimento, 'minutes').minutes));

    return {
        id: ev.id,
        nome: ev.summary || '',
        categoria,
        orainizio: start.toFormat('HH:mm'),
        orafine: end.toFormat('HH:mm'),
        giorno: start.setLocale('it').toFormat('EEEE d'),
        descrizione: desc,
        verbose,
        tags,
        immagine: null,
        durataMinuti,
        offsetMinuti,
        dayNum,
        dayAbbr,
        dayKey,
        raw: ev
    };
}

// ---------- API ----------

app.get('/immagine/:categoria', async (req, res) => {
    const categoria = req.params.categoria;

    try {
        const driveUrl = await getRandomImageFromDrive(categoria);
        const response = await fetch(driveUrl);

        // se non trova l'immagine
        if (!response.ok) throw new Error(`Drive HTTP ${response.status}`);

        res.setHeader('Content-Type', response.headers.get('content-type'));
        response.body.pipe(res);

    } catch (err) {
        console.error(`Drive fallito per ${categoria}:`, err.message);
        // fallback con immagine salvata localmente
        const fallbackPath = path.join(__dirname, 'public', 'imgcache', `${categoria}.jpg`);
        if (fs.existsSync(fallbackPath)) {
            res.setHeader('Content-Type', 'image/jpeg');
            fs.createReadStream(fallbackPath).pipe(res);
        } else {
            res.status(404).send('Nessuna immagine trovata');
        }
    }
});


app.get('/api/weekly', async (req, res) => {
  try {
    const offset = parseInt(req.query.offset || "0", 10); // di default 0 = questa settimana
    const auth = await getAuth();
    const calendar = google.calendar({ version: 'v3', auth });
    const { timeMin, timeMax, human } = getWeekRange(offset);

    const { data } = await calendar.events.list({
      calendarId: CALENDAR_ID,
      singleEvents: true,
      timeMin,
      timeMax,
      orderBy: 'startTime',
      maxResults: 2500
    });

    let items = (data.items || []).map(ev => normalizeEvent(ev));
    items = items.filter(ev => {
      const desc = (ev.raw?.description || '').toLowerCase();
      return !desc.includes('segret');
    });

    const aperti = [], chiusi = [];
    for (const item of items) {
      if (isOpen(item.raw)) aperti.push(item);
      else chiusi.push(item);
    }

    await enrichWithImages(aperti);

    res.json({
      range: human,
      tz: 'Europe/Rome',
      offset,
      count: { aperti: aperti.length, chiusi: chiusi.length, totale: items.length },
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