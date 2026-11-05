// Il server: il calendario pubblico (/calendario) e l'app dentro Telegram
// (/prenota). Qui si monta tutto; le rotte stanno in rotte/, divise per
// zona dell'app, e la configurazione in config.js.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { DIR_BASE } from './config.js';
import { router as pubblico } from './rotte/pubblico.js';
import { router as account } from './rotte/account.js';
import { router as prenota } from './rotte/prenota.js';
import { router as inventario } from './rotte/inventario.js';
import { router as tessere } from './rotte/tessere.js';
import { router as staff } from './rotte/staff.js';
import { router as interno } from './rotte/interno.js';

const PORT = process.env.PORT || 8080;

export const app = express();
app.use(cors());
// esponi tutto cio' che sta in /public
app.use('/calendario', express.static(path.join(DIR_BASE, 'public')));
// L'app di prenotazione sta su un percorso suo: e' un'altra cosa dal
// calendario che si guarda, anche se legge gli stessi calendari.
// no-cache: il WebView di Telegram si tiene la pagina, e dopo un
// aggiornamento si continuerebbe a vedere quella vecchia. Cosi' la
// ricontrolla ogni volta (con l'ETag, quindi senza riscaricarla se e' uguale).
app.use('/prenota', express.static(path.join(DIR_BASE, 'public', 'prenota'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

// Le richieste dell'app sono piccole; l'unica eccezione e' la foto del bene
// riportato in sede, che arriva gia' rimpicciolita dalla pagina.
const jsonPiccolo = express.json({ limit: '64kb' });
const jsonConFoto = express.json({ limit: '6mb' });
app.use((req, res, next) =>
  (req.path === '/prenota/api/inventario/restituisci' ? jsonConFoto : jsonPiccolo)(req, res, next));

app.use(account);
app.use(prenota);
app.use(inventario);
app.use(tessere);
app.use(staff);
app.use(interno);
app.use(pubblico);

// Importato da un controllo (SENZA_ASCOLTO=1) il server non si mette in
// ascolto: serve a verificare che tutto si carichi.
if (!process.env.SENZA_ASCOLTO) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server pronto su http://0.0.0.0:${PORT}`);
  });
}
