// La configurazione del server: i file .txt accanto al codice (sedi,
// calendari, gruppi, categorie) e le chiavi che stanno fuori dal repo. Si
// leggono una volta all'avvio; per cambiarle si riavvia.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const DIR_BASE = path.dirname(fileURLToPath(import.meta.url));
export const ZONA = 'Europe/Rome';

// Le righe utili di un file di configurazione: senza spazi in fondo, senza
// quelle vuote e senza i commenti. Un file che manca e' un file vuoto.
function righe(nome) {
  const file = path.join(DIR_BASE, nome);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .map((r) => r.trim())
    .filter((r) => r && !r.startsWith('#'));
}

// Le righe come colonne separate da "|".
const colonne = (nome) => righe(nome).map((r) => r.split('|').map((x) => x.trim()));

// Formato "chiave | valore", in una mappa.
function coppie(nome) {
  const out = new Map();
  for (const [chiave, valore] of colonne(nome)) {
    if (chiave && valore) out.set(chiave, valore);
  }
  return out;
}

// Un file di testo con un segreto dentro, o '' se manca.
function segreto(nome) {
  try {
    return fs.readFileSync(path.join(DIR_BASE, nome), 'utf8').trim();
  } catch {
    return '';
  }
}


// ---------- Telegram ----------
// Token del bot: serve a verificare la firma dei dati che Telegram passa
// all'app, e a mandare la richiesta allo staff. Sta in un file suo, fuori dal
// repo, come le chiavi di Google.
export const BOT_TOKEN = segreto('bot_token.txt');
if (!BOT_TOKEN) console.error('bot_token.txt mancante: l\'app di prenotazione resta spenta');

// Il bot non e' una pagina dentro Telegram, quindi non ha un initData da
// firmare: si autentica con un segreto condiviso. Non riusiamo il token del
// bot come segreto, perche' chi scoprisse uno avrebbe l'altro.
export const SEGRETO_INTERNO = segreto('segreto_interno.txt');

// Formato di staff.txt:  slug_sede | chat_id del gruppo staff
export const STAFF = coppie('staff.txt');

// Formato di gruppi.txt:  nome | chat_id. Per ora serve solo "direttivo":
// chi ne fa parte puo' mettere un'attivita' in vetrina.
export const GRUPPI = coppie('gruppi.txt');


// ---------- Drive ----------
// API key da drive_key.json: senza, il server non parte, come prima.
export const DRIVE_API_KEY = JSON.parse(
  fs.readFileSync(path.join(DIR_BASE, 'drive_key.json'), 'utf8')).APIKEY;

// Mappa categoria -> FolderID (Drive)
export const FOLDER_IDS = {
  libro:        '1YrG1NvGF3EMi2xkr1zAjhbMd3QWGIl6V',
  mana:         '19Z4nL7IhDx9Ov4oZJHgUFkYH4OQMVS2f',
  disegno:      '1mLkzEL66s_OYvoftt3VFA4uqifS9PkyE',
  gdr:          '18I1scrhzo4n47RAih-IJGHQDVaDmeUXX',
  gdt:          '1RE2NTe_WXGb57sYHWHoZ-4rdB5YqUiP2',
};


// ---------- categorie ----------
// Formato di event_types.txt:  class: keyword1, keyword2, ...
// Esempio riga: "gdr: gdr, rpg". Il file si legge una volta sola e ne
// escono due cose: la mappa parola -> categoria, e l'ordine delle
// categorie in vetrina, che e' quello delle righe. Non e' cronologico
// apposta (vedi raggruppaInSerie), e tenerlo in un file vuol dire che si
// cambia spostando una riga.
export const EVENT_TYPE_MAP = new Map();   // keyword -> class
export const ORDINE_CATEGORIE = new Map(); // class -> posto
for (const riga of righe('event_types.txt')) {
  const [cls, rest] = riga.split(':');
  const className = cls?.trim();
  if (className && !ORDINE_CATEGORIE.has(className)) {
    ORDINE_CATEGORIE.set(className, ORDINE_CATEGORIE.size);
  }
  if (!className || !rest) continue;
  for (const kw of rest.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    EVENT_TYPE_MAP.set(kw, className);
  }
}

// Formato di categorie.txt:  slug | Nome mostrato
//
// Per ogni categoria servono tre cose oltre al nome: la parola chiave da
// scrivere in cima alla descrizione (e' l'unico modo che ha il calendario di
// riconoscere il tipo di attivita'), il colore, e l'icona. Nessuna delle tre
// si riscrive qui: la parola arriva da event_types.txt, il colore dal CSS dei
// colori, l'icona e' un file in public/src. Cosi' non esistono due verita'.
function loadCategorie() {
  // La prima parola chiave di ogni classe: e' garantito che il calendario la
  // riconosca, mentre il nome della classe a volte non e' fra le sue chiavi
  // (per "libro" le chiavi sono lettura, bookclub, book...).
  const primaParola = new Map();
  for (const [kw, cls] of EVENT_TYPE_MAP.entries()) {
    if (!primaParola.has(cls)) primaParola.set(cls, kw);
  }

  const colori = new Map();
  const cssColori = fs.readFileSync(
    path.join(DIR_BASE, 'public', 'colori_appuntamenti.css'), 'utf8');
  for (const m of cssColori.matchAll(/^\.([a-z0-9]+)\s*\{\s*background:\s*(#[0-9A-Fa-f]{3,8})/gm)) {
    colori.set(m[1], m[2]);
  }

  const out = [];
  for (const [slug, nome, esempio] of colonne('categorie.txt')) {
    if (!slug || !nome) continue;
    out.push({
      slug,
      nome,
      // Il testo grigio del campo del nome: cambia con la categoria, perche'
      // "D&D - Nome campagna" e "Serata Pokemon" non si suggeriscono insieme.
      esempio: esempio || '',
      // "default" non ha una parola chiave: e' quello che esce quando non se
      // ne riconosce nessuna, quindi non se ne scrive nessuna.
      parola: slug === 'default' ? '' : (primaParola.get(slug) || slug),
      colore: colori.get(slug) || colori.get('default') || '#6b7280',
      icona: fs.existsSync(path.join(DIR_BASE, 'public', 'src', slug + '.png'))
        ? `/calendario/src/${slug}.png`
        : '/calendario/src/default.png',
    });
  }
  return out;
}
export const CATEGORIE = loadCategorie();
console.log('Categorie per l\'app:', CATEGORIE.map((c) => c.slug).join(', '));


// ---------- sedi ----------
// La sede si ricava dal campo `location` nativo di Google Calendar, che e' gia'
// presente nella risposta di events.list: non costa una chiamata in piu'.
// Formato di sedi.txt:  slug | Nome mostrato | keyword1, keyword2, ... | Indirizzo
export const SEDI_NOMI = new Map();      // slug -> nome mostrato
export const SEDI_KEYWORDS = new Map();  // keyword -> slug
export const SEDI_INDIRIZZI = new Map(); // slug -> indirizzo, se c'e'
for (const parti of colonne('sedi.txt')) {
  if (parti.length < 3) continue;
  const [slug, nome, parole, indirizzo] = parti;
  if (!slug) continue;
  SEDI_NOMI.set(slug, nome || slug);
  for (const kw of parole.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    SEDI_KEYWORDS.set(kw, slug);
  }
  if (indirizzo) SEDI_INDIRIZZI.set(slug, indirizzo);
}

export const nomeSede = (slug) => SEDI_NOMI.get(slug) || slug;

// Sede a cui attribuire gli eventi che non hanno `location` valorizzato.
export const SEDE_DEFAULT = process.env.SEDE_DEFAULT || 'barletta';

// Ora da cui parte la fascia disegnata sotto "Altre attivita'". Le colonne
// 17..23 nell'header di index.html partono da qui: se si cambia, va cambiato
// anche li'.
export const ORA_INIZIO_FASCIA = 17;


// ---------- calendari (uno per sede) ----------
// Formato di calendari.txt:  slug_sede | Calendar ID
// Aggiungere una sede = condividere il suo calendario in sola lettura con il
// service account e incollare qui l'ID. Nessuna modifica al codice.
// Il calendario storico serve solo se il file manca o e' vuoto: cosi' il
// servizio non si pianta mai per una questione di configurazione.
const CALENDARIO_STORICO = '4b70a04394809659390244a872836e10cc89e9016fdf66cd2f0a40c2a4830729@group.calendar.google.com';

export const CALENDARI = colonne('calendari.txt')
  .filter(([sede, id]) => sede && id && !id.startsWith('INCOLLA'))
  .map(([sede, id]) => ({ sede, id }));
if (!CALENDARI.length) CALENDARI.push({ sede: SEDE_DEFAULT, id: CALENDARIO_STORICO });
console.log('Calendari configurati:', CALENDARI.map((c) => c.sede).join(', '));

export function calendarioDi(sede) {
  return CALENDARI.find((c) => c.sede === sede)?.id || null;
}
