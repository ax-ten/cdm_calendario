import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';
import { DateTime } from 'luxon';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8080
const CALENDAR_ID = "4b70a04394809659390244a872836e10cc89e9016fdf66cd2f0a40c2a4830729@group.calendar.google.com"


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
function getWeekRange(zone = 'Europe/Rome') {
    const now = DateTime.now().setZone(zone);
    const start = now.startOf('week'); // lunedì in ISO
    const end = now.endOf('week');     // domenica 23:59:59.999
    return {
        timeMin: start.toISO(),
        timeMax: end.toISO(),
        human: { start: start.toISODate(), end: end.toISODate() }
    };
}


function isOpen(googleEvent) {
    const s = (googleEvent.description).toLowerCase();
    const isEvent = s.includes('event');
    return isEvent;
}


// -------- mappatura categorie ------------
function loadEventTypeMap() {
  // Formato:  class: keyword1, keyword2, ...
  // Esempio riga: "gdr: gdr, rpg"  (vedi tuo file)  :contentReference[oaicite:3]{index=3}
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
  // prendi la prima "parola" e togli punteggiatura comune
  const w = s.trim().split(/\s+/)[0] || '';
  return w.toLowerCase().replace(/[.,;:!?#()\[\]{}"']/g, '');
}


function detectCategoria(description) {
  const first = firstWordLower(description);
  if (!first) return 'default';
  // match diretto
  if (EVENT_TYPE_MAP.has(first)) return EVENT_TYPE_MAP.get(first);
  // fallback rapido: alcuni alias nei tuoi dati hanno spazi (es. "roll in the dark") :contentReference[oaicite:4]{index=4}
  // se la descrizione inizia con più parole che corrispondono a una chiave multiword
  for (const [kw, cls] of EVENT_TYPE_MAP.entries()) {
    if (kw.includes(' ') && description.toLowerCase().startsWith(kw)) return cls;
  }
  return 'default';
}



// ---------- Normalizzazione campi ----------


function normalizeEvent(ev, zone = 'Europe/Rome') {
    const startISO = ev.start?.dateTime || ev.start?.date;
    const endISO   = ev.end?.dateTime   || ev.end?.date;

    const start = DateTime.fromISO(startISO, { zone });
    const end   = DateTime.fromISO(endISO,   { zone });

    const dayKey   = start.toISODate(); // es. "2025-08-15"
    const dayNum = start.toFormat('dd'); // "13"
    const dayAbbr = start.setLocale('it').toFormat('ccc').toUpperCase(); // "GIO"
    // const dayLabel = { num: dayNum, abbr: dayAbbr };


    const desc = ev.description || '';
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

    // if ('segreto' in desc) {return {}}

    return {
        id: ev.id,
        nome: ev.summary || '',
        categoria,
        orainizio: start.toFormat('HH:mm'),
        orafine: end.toFormat('HH:mm'),
        giorno: start.setLocale('it').toFormat('ccc dd/MM'),
        descrizione: desc,
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
app.get('/api/weekly', async (req, res) => {
    try {
        const auth = await getAuth();
        const calendar = google.calendar({ version: 'v3', auth });
        const { timeMin, timeMax, human } = getWeekRange();

        const { data } = await calendar.events.list({
            calendarId: CALENDAR_ID,
            singleEvents: true,
            timeMin,
            timeMax,
            orderBy: 'startTime',
            maxResults: 2500
        });

        const items = (data.items || []).map(ev => normalizeEvent(ev));

        const aperti = [];
        const chiusi = [];
        for (const item of items) {
            if (isOpen(item.raw)) aperti.push(item);
            else chiusi.push(item);
        }

        res.json({
            range: human,
            tz: 'Europe/Rome',
            count: { aperti: aperti.length, chiusi: chiusi.length, totale: items.length },
            aperti,
            chiusi
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: String(err.message || err) });
    }
});

app.listen(PORT, () => {
    console.log(`Server pronto su http://localhost:${PORT}`);
});
