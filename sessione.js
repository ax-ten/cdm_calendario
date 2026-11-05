// Chi sta usando l'app: identita' (initData di Telegram), se e' sociə, se
// puo' prenotare, e i ruoli (staff, direttivo, chi amministra).
//
// Ogni richiesta porta l'initData di Telegram e viene verificata: e' l'unica
// cosa che impedisce a chi conosce l'URL di prenotare a nome di altri.
//
// L'app e' dei soci: le stanze come l'inventario. Ogni rotta, tranne quelle
// che servono a registrarsi, controlla che chi chiama sia un socio
// confermato in Odoo. Nascondere le schede nella pagina non basterebbe:
// l'API si chiama anche senza pagina.

import * as prenotazioni from './prenotazioni.js';
import * as odoo from './odoo.js';
import { BOT_TOKEN, calendarioDi } from './config.js';
import { eStaff, eDirettivo } from './telegram.js';
import { Cache } from './util.js';

// Senza la tessera dell'anno non si prenota: la scheda in Odoo lo dice con
// tesserato. Se Odoo non lo manda (versioni di prima), non si blocca nessuno.
export const TESTO_SENZA_TESSERA = 'Per prenotare un’attività bisogna tesserarsi: lo fai dalla scheda Tessera.';
export const senzaTessera = (utente) => utente.socio?.tesserato === false;

// Un gruppo Telegram che manca in gruppi.txt o staff.txt e' un problema di
// chi gestisce il server: va nel log. A chi usa l'app si dice cosa fare.
export function mancaGruppo(res, quale, chi) {
  console.error(`configurazione: manca il gruppo ${quale}`);
  return res.status(500).json({ errore: `Non riesco ad avvisare ${chi}: avvisa in sede.` });
}

export async function conUtente(req, res, azione, { soloSoci = true } = {}) {
  if (!BOT_TOKEN) {
    console.error('app non configurata: manca bot_token.txt');
    return res.status(503).json({ errore: 'L’app non è ancora pronta: riprova più tardi.' });
  }
  let utente;
  try {
    utente = prenotazioni.verificaInitData(req.body?.initData || '', BOT_TOKEN);
  } catch (err) {
    // L'initData vale un giorno: chi tiene l'app aperta da ieri finisce qui, e
    // l'unica cosa da fare e' riaprirla.
    console.error('identita non verificata:', err.message);
    return res.status(401).json({ errore: /scaduto/.test(err.message)
      ? 'È passato troppo tempo: chiudi e riapri l’app.'
      : 'Non riesco a riconoscerti: chiudi e riapri l’app.' });
  }
  if (troppeChiamate(utente.id)) {
    return res.status(429).json({ errore: 'Troppe richieste in poco tempo: riprova fra un minuto.' });
  }
  try {
    if (soloSoci) {
      utente.socio = await socioDi(utente.id);
      if (!utente.socio) {
        return res.status(403).json({ errore: 'L’app è riservata al corpo associativo: registrati prima.', registrati: true });
      }
    }
    await azione(utente);
  } catch (err) {
    if (err instanceof odoo.ErroreOdoo && err.perUtente) {
      return res.status(409).json({ errore: err.message });
    }
    // Un guasto di Odoo o di Google non dice niente a chi usa l'app: il
    // dettaglio va nel log.
    console.error('prenotazioni:', err);
    if (!res.headersSent) res.status(500).json({ errore: 'Qualcosa non ha funzionato, riprova.' });
  }
}

// Un initData vale un giorno: chi lo copia da' l'app puo' usarlo in uno
// script e chiamare l'API a raffica, e molte rotte arrivano fino a Odoo o a
// Google. Uso normale e' qualche decina di chiamate al minuto, trascinando
// la fascia oraria; il tetto sta ben sopra.
const CHIAMATE_AL_MINUTO = 120;
const chiamate = new Map();

export function troppeChiamate(userId) {
  const ora = Date.now();
  // Le finestre scadute si buttano ogni tanto, se no la mappa cresce con
  // ogni persona che abbia mai aperto l'app.
  if (chiamate.size > 5000) {
    for (const [id, c] of chiamate) if (ora - c.inizio > 60_000) chiamate.delete(id);
  }
  const c = chiamate.get(String(userId));
  if (!c || ora - c.inizio > 60_000) {
    chiamate.set(String(userId), { inizio: ora, n: 1 });
    return false;
  }
  c.n += 1;
  return c.n > CHIAMATE_AL_MINUTO;
}

// Chi e' socio lo dice Odoo, ma chiederlo a ogni tocco dell'app vorrebbe
// dire un giro su Odoo per ogni giorno del calendario che si apre. Si tiene
// la risposta per qualche minuto, e se Odoo non risponde si usa l'ultima:
// un Odoo giu' non deve chiudere le stanze a chi le prenotava ieri.
// Senza odoo.json il controllo non c'e', e l'app resta aperta come prima:
// cosi' si puo' aggiornare il server prima di mettere in piedi Odoo.
// "fresco" (all'apertura dell'app e alla registrazione) vuol dire al
// massimo mezzo minuto: abbastanza per vedere subito la conferma dello
// staff, non abbastanza perche' chi riapre l'app a raffica arrivi a Odoo
// ogni volta.
const SOCI_VALIDI_PER_MS = 10 * 60 * 1000;
const SOCI_FRESCHI_PER_MS = 30 * 1000;
const sociVisti = new Cache(5000);

export async function socioDi(userId, { fresco = false } = {}) {
  if (!odoo.attivo()) return { id: null, nome: null, numero_socio: null, senzaOdoo: true };
  const validita = fresco ? SOCI_FRESCHI_PER_MS : SOCI_VALIDI_PER_MS;
  const valido = sociVisti.cerca(userId, validita);
  if (valido) return valido.valore;
  const visto = sociVisti.cerca(userId);
  try {
    const socio = await odoo.miniapp('socio_da_telegram', String(userId));
    sociVisti.metti(userId, socio);
    return socio;
  } catch (err) {
    if (visto) {
      console.error('Odoo non risponde, uso l ultima risposta per', userId, err.message);
      return visto.valore;
    }
    throw err;
  }
}

// Dopo una conferma, un rifiuto o un pagamento la risposta tenuta e'
// vecchia: la prossima domanda va a Odoo.
export function dimenticaSocio(userId) {
  sociVisti.togli(userId);
}

// Prima di prenotare o spostare: la sede esiste, chi chiede non e' sospesə e
// ha la tessera, e (se ci sono) gli orari stanno nei limiti. I controlli si
// rifanno qui e non solo nell'app: l'app e' pagina web, e una pagina web si
// puo' riscrivere. Restituisce il calendario della sede, o null dopo aver
// gia' risposto con l'errore.
export function controllaPrenotazione(res, utente, { sede, orari }) {
  const calendarId = calendarioDi(sede);
  if (!calendarId) {
    res.status(400).json({ errore: 'Sede sconosciuta.' });
    return null;
  }
  if (prenotazioni.eBloccato(utente.id)) {
    res.status(403).json({ errore: 'Lo staff ha sospeso le tue attività.' });
    return null;
  }
  if (senzaTessera(utente)) {
    res.status(403).json({ errore: TESTO_SENZA_TESSERA });
    return null;
  }
  if (orari) {
    const guai = prenotazioni.validaRichiesta(orari);
    if (guai.length) {
      res.status(400).json({ errore: guai.join('; ') });
      return null;
    }
  }
  return calendarId;
}


// ---------- ruoli ----------
// Staff, per l'inventario, e' chi sta in un gruppo staff o nel direttivo.
// Le due risposte di Telegram si tengono qualche minuto (vedi telegram.js).
export async function staffInventario(userId) {
  const [staff, direttivo] = await Promise.all([eStaff(userId), eDirettivo(userId)]);
  return staff || direttivo;
}

// Admin della biblioteca: chi sta nel gruppo del direttivo, o ha la spunta
// "Amministra la biblioteca" sulla scheda in Odoo. Vede tutti i prestiti in
// corso, li prolunga e li chiude a mano.
export async function adminBiblioteca(utente) {
  if (utente.socio?.admin) return true;
  return eDirettivo(utente.id);
}

export async function soloAdmin(utente, res) {
  if (await adminBiblioteca(utente)) return true;
  res.status(403).json({ errore: 'Lo può fare solo chi amministra la biblioteca.' });
  return false;
}

export async function soloStaff(utente, res) {
  if (await staffInventario(utente.id)) return true;
  res.status(403).json({ errore: 'Lo può fare solo lo staff.' });
  return false;
}

// Le quote le gestisce il direttivo, o chi ha la spunta "Gestisce le quote"
// sulla scheda in Odoo: non lo staff di una sede, e non chi amministra la
// biblioteca.
export async function adminTessere(utente) {
  if (utente.socio?.admin_tessere) return true;
  return eDirettivo(utente.id);
}

export async function soloAdminTessere(utente, res) {
  if (await adminTessere(utente)) return true;
  res.status(403).json({ errore: 'Lo può fare solo il direttivo.' });
  return false;
}
