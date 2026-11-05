// Il calendario pubblico: la settimana e le foto delle schede. Niente
// initData: lo guarda chiunque, quindi esce solo quello che si mostra.

import express from 'express';
import fs from 'fs';
import path from 'path';
import { DIR_BASE, FOLDER_IDS } from '../config.js';
import {
  settimanaPubblica, scegliImmagineDrive, urlDownloadDrive, categoriaImmagine,
} from '../calendario.js';

export const router = express.Router();

// Le settimane che si possono chiedere: due anni avanti e indietro bastano,
// e ogni settimana diversa e' una voce nella cache.
const OFFSET_MAX = 104;

router.get('/calendario/immagine/:categoria', async (req, res) => {
  // Il nome finisce in un percorso di file (la foto di riserva): si
  // accettano solo le categorie conosciute.
  const categoria = categoriaImmagine(req.params.categoria);
  if (!categoria) return res.status(404).send('Nessuna immagine trovata');

  try {
    const folderId = FOLDER_IDS[categoria];
    if (!folderId) throw new Error(`nessuna cartella Drive per "${categoria}"`);

    const fileId = await scegliImmagineDrive(folderId);
    if (!fileId) throw new Error(`la cartella Drive di "${categoria}" non ha immagini visibili (vuota o non condivisa in pubblico)`);

    const response = await fetch(urlDownloadDrive(fileId), { signal: AbortSignal.timeout(15000) });

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
    const fallbackPath = path.join(DIR_BASE, 'public', 'imgcache', `${categoria}.jpg`);
    if (fs.existsSync(fallbackPath)) {
      res.setHeader('Content-Type', 'image/jpeg');
      fs.createReadStream(fallbackPath).pipe(res);
    } else {
      res.status(404).send('Nessuna immagine trovata');
    }
  }
});

// La pagina sta sotto /calendario, quindi il client chiama
// /calendario/api/weekly. Teniamo attivo anche /api/weekly, che e' il percorso
// storico usato da fuori.
router.get(['/api/weekly', '/calendario/api/weekly'], async (req, res) => {
  try {
    // di default 0 = questa settimana
    const chiesto = parseInt(req.query.offset || '0', 10);
    const offset = Number.isFinite(chiesto) ? Math.max(-OFFSET_MAX, Math.min(OFFSET_MAX, chiesto)) : 0;
    res.json(await settimanaPubblica(offset));
  } catch (err) {
    console.error('settimana pubblica:', err);
    res.status(500).json({ error: 'Calendario non disponibile, riprova fra poco.' });
  }
});
