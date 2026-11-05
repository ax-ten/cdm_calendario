// ---------- inventario ----------
// Catalogo, prestiti e aggiunta beni. Le regole (un prestito per volta,
// trenta giorni, chi puo' restituire cosa) stanno in Odoo: qui si dice solo
// chi e' la persona e se e' staff.

import express from 'express';
import { DateTime } from 'luxon';
import * as odoo from '../odoo.js';
import * as isbn from '../isbn.js';
import { STAFF } from '../config.js';
import { telegram, mandaFile, nomeTelegram, usernameDi } from '../telegram.js';
import {
  conUtente, mancaGruppo, staffInventario, adminBiblioteca, soloAdmin, soloStaff,
} from '../sessione.js';
import { memoria, mappaConLimite } from '../util.js';

export const router = express.Router();

// Quali generi ha ogni categoria: Odoo i generi li ha tutti insieme, ma un
// genere di romanzi in mezzo ai giochi da tavolo non serve a niente. Si
// ricava dal catalogo, guardando i generi dei beni di ciascuna categoria, e
// si tiene dieci minuti (o fino al prossimo bene aggiunto). Chi arriva
// mentre lo si sta ricavando aspetta lo stesso calcolo. Le categorie sono
// poche e Odoo filtra per categoria, quindi ogni bene si guarda una volta.
const GENERI_VALIDI_PER_MS = 10 * 60 * 1000;
const generiVisti = memoria(GENERI_VALIDI_PER_MS, 1);

function generiPerCategoria(opzioni) {
  return generiVisti('tutti', async () => {
    const perNome = new Map(opzioni.generi.map((g) => [String(g.nome).toLowerCase(), g.id]));
    const mappa = {};
    await Promise.all(opzioni.categorie.map(async (c) => {
      const ids = new Set();
      for (let offset = 0; offset < 5000;) {
        const { beni, totale } = await odoo.miniapp('catalogo', {
          testo: '', sede_id: false, categoria: String(c.id), genere_id: false, sistema_id: false,
          solo_disponibili: false, bene_id: false, autore: '',
        }, offset, 200, false);
        for (const b of beni) {
          for (const nome of b.generi || []) {
            const id = perNome.get(String(nome).toLowerCase());
            if (id) ids.add(id);
          }
        }
        offset += beni.length;
        if (!beni.length || offset >= totale) break;
      }
      mappa[c.id] = [...ids];
    }));
    return mappa;
  });
}

router.post('/prenota/api/inventario/opzioni', (req, res) => conUtente(req, res, async (utente) => {
  const [opzioni, staff, admin, prestiti] = await Promise.all([
    odoo.miniapp('opzioni'),
    staffInventario(utente.id),
    adminBiblioteca(utente),
    odoo.miniapp('miei_prestiti', utente.id),
  ]);
  // Senza la mappa l'app mostra tutti i generi: meglio troppi che nessuno.
  const generi_categoria = await generiPerCategoria(opzioni).catch((err) => {
    console.error('generi per categoria:', err.message);
    return null;
  });
  res.json({ ...opzioni, staff, admin, prestiti, generi_categoria });
}));

const PAGINA_CATALOGO = 30;

router.post('/prenota/api/inventario/catalogo', (req, res) => conUtente(req, res, async () => {
  const f = req.body?.filtri || {};
  const filtri = {
    testo: String(f.testo || '').slice(0, 100),
    sede_id: Number(f.sede_id) || false,
    // Una scheda della biblioteca puo' tenere piu' tipi (GdR e manuali).
    categoria: Array.isArray(f.categoria)
      ? f.categoria.map(String).slice(0, 5)
      : String(f.categoria || ''),
    genere_id: Number(f.genere_id) || false,
    sistema_id: Number(f.sistema_id) || false,
    solo_disponibili: Boolean(f.solo_disponibili),
    // Da un suggerimento scelto: quel bene, o tutti quelli di quell'autore.
    bene_id: Number(f.bene_id) || false,
    autore: String(f.autore || '').slice(0, 200),
  };
  const offset = Math.max(0, Number(req.body?.offset) || 0);
  // L'ordine lo controlla Odoo contro un elenco suo; qui basta che sia corto.
  const ordine = String(req.body?.ordine || 'popolari').slice(0, 20);
  // Nel catalogo non si dice mai chi ha un bene ne' fino a quando, a
  // nessuno: chi amministra lo vede nella vista dei prestiti.
  // Per l'ordine a caso: lo stesso seme da' la stessa estrazione, pagina dopo pagina.
  const seme = Math.abs(Math.round(Number(req.body?.seme) || 0)) % 1e9;
  const esito = await odoo.miniapp('catalogo', filtri, offset, PAGINA_CATALOGO, false, ordine, seme);
  res.json({ ...esito, beni: (esito.beni || []).map(senzaPrestito) });
}));

function senzaPrestito({ prestito, socio, scadenza, data_prestito, ...bene }) {
  return bene;
}

// Mentre si scrive nella barra di ricerca: titoli, autori e generi.
router.post('/prenota/api/inventario/suggerimenti', (req, res) => conUtente(req, res, async () => {
  const testo = String(req.body?.testo || '').trim().slice(0, 100);
  const esito = await odoo.miniapp('suggerimenti', testo, 8);
  res.json({ ...esito, beni: (esito.beni || []).map(senzaPrestito) });
}));

// Dopo aver preso un bene, per dieci secondi lo si puo' annullare (un tocco
// sbagliato). L'avviso allo staff della sede parte quando la finestra e'
// chiusa: un prestito annullato non lascia messaggi in giro.
const ATTESA_AVVISO_MS = 12 * 1000;
const avvisiInSospeso = new Map();   // prestitoId -> { timer, utenteId }

function avvisaStaffDelPrestito(prestito, utente, note) {
  const chatStaff = STAFF.get(String(prestito?.sede || '').toLowerCase());
  if (!chatStaff) {
    console.error(`prestito: nessun gruppo staff per ${prestito?.sede}`);
    return;
  }
  const scade = prestito.scadenza
    ? DateTime.fromISO(prestito.scadenza).setLocale('it').toFormat('d MMMM') : '';
  telegram('sendMessage', {
    chat_id: chatStaff,
    text: `${prestito.socio || nomeTelegram(utente)}` +
      `${utente.username && prestito.socio ? ' (@' + utente.username + ')' : ''}` +
      ` ha preso in prestito “${prestito.titolo}” a ${prestito.sede}.` +
      (scade ? `\nDa riportare entro il ${scade}.` : '') +
      (note ? `\nNote: ${note}` : ''),
  }).catch((err) => console.error('prestito: messaggio allo staff non mandato:', err.message));
}

router.post('/prenota/api/inventario/presta', (req, res) => conUtente(req, res, async (utente) => {
  const beneId = Number(req.body?.beneId);
  if (!beneId) return res.status(400).json({ errore: 'Quale bene?' });
  const note = String(req.body?.note || '').trim().slice(0, 500) || false;
  const prestito = await odoo.miniapp('presta', utente.id, beneId, note);
  // Il prestito in Odoo c'e' gia': se poi il messaggio non parte lo si scrive
  // nel log, e il socio non ne paga le conseguenze.
  avvisiInSospeso.set(prestito.id, {
    utenteId: utente.id,
    timer: setTimeout(() => {
      avvisiInSospeso.delete(prestito.id);
      avvisaStaffDelPrestito(prestito, utente, note);
    }, ATTESA_AVVISO_MS),
  });
  res.json({ prestito });
}));

router.post('/prenota/api/inventario/annulla-prestito', (req, res) => conUtente(req, res, async (utente) => {
  const prestitoId = Number(req.body?.prestitoId);
  if (!prestitoId) return res.status(400).json({ errore: 'Quale prestito?' });
  // Si annulla solo finche' lo staff non e' stato avvisato: dopo, per lui il
  // bene e' uscito, e va restituito come gli altri.
  const sospeso = avvisiInSospeso.get(prestitoId);
  if (!sospeso) {
    return res.status(409).json({ errore: 'È passato troppo tempo per annullarlo: restituiscilo.' });
  }
  // Il prestito l'ha appena fatto qualcuno da qui: lo annulla solo chi l'ha
  // fatto. Odoo lo ricontrolla per conto suo (riceve chi chiede).
  if (sospeso.utenteId !== utente.id) {
    return res.status(403).json({ errore: 'Non è un tuo prestito.' });
  }
  await odoo.miniapp('annulla_prestito', utente.id, prestitoId);
  clearTimeout(sospeso.timer);
  avvisiInSospeso.delete(prestitoId);
  res.json({ ok: true });
}));

router.post('/prenota/api/inventario/miei', (req, res) => conUtente(req, res, async (utente) => {
  res.json({ prestiti: await odoo.miniapp('miei_prestiti', utente.id) });
}));

// Restituire vuol dire riportare in sede, e lo si dimostra con una foto: va
// nel gruppo staff della sede del bene, e solo se e' arrivata il prestito si
// chiude. Se si chiudesse prima, una foto persa sarebbe un prestito chiuso
// senza prova.
const FOTO_MAX_BYTE = 4 * 1024 * 1024;

async function fotoAlloStaff(chatId, foto, didascalia, prestitoId) {
  await mandaFile('sendPhoto', {
    chat_id: chatId,
    caption: didascalia,
    // Se in sede il bene non c'e', lo staff lo dice da qui e il prestito si
    // riapre: lo gestisce il bot, che riceve i bottoni.
    reply_markup: { inline_keyboard: [[
      { text: 'Non è rientrato', callback_data: `rientro:${prestitoId}` },
    ]] },
  }, 'photo', foto, 'image/jpeg', 'restituzione.jpg');
}

router.post('/prenota/api/inventario/restituisci', (req, res) => conUtente(req, res, async (utente) => {
  const prestitoId = Number(req.body?.prestitoId);
  if (!prestitoId) return res.status(400).json({ errore: 'Quale prestito?' });

  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.foto || ''));
  if (!m) return res.status(400).json({ errore: 'Serve la foto del bene in sede.' });
  const foto = Buffer.from(m[1], 'base64');
  if (foto.length > FOTO_MAX_BYTE || foto[0] !== 0xff || foto[1] !== 0xd8) {
    return res.status(400).json({ errore: 'Questa foto non va: riprova a scattarla.' });
  }

  // Dai propri prestiti aperti: cosi' si sa la sede, e si sa che e' suo.
  const prestito = (await odoo.miniapp('miei_prestiti', utente.id)).find((p) => p.id === prestitoId);
  if (!prestito) return res.status(404).json({ errore: 'Non è un tuo prestito aperto.' });
  const chatStaff = STAFF.get(String(prestito.sede || '').toLowerCase());
  if (!chatStaff) return mancaGruppo(res, `staff di ${prestito.sede}`, 'lo staff');

  const chi = `${prestito.socio}${utente.username ? ' (@' + utente.username + ')' : ''}`;
  try {
    await fotoAlloStaff(chatStaff, foto,
      `${chi} ha riportato “${prestito.titolo}” a ${prestito.sede}.`, prestitoId);
  } catch (err) {
    console.error('restituzione: foto non mandata:', err.message);
    return res.status(502).json({ errore: 'Non sono riuscito a mandare la foto allo staff: riprova.' });
  }
  res.json({ prestito: await odoo.miniapp('restituisci', utente.id, prestitoId) });
}));

// Solo lo staff prolunga: il socio restituisce e, se vuole, lo riprende.
// ---- vista degli admin: tutti i prestiti in corso
router.post('/prenota/api/inventario/admin/prestiti', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloAdmin(utente, res)) return;
  const prestiti = await odoo.miniapp('prestiti_aperti');
  // Per il pulsante "scrivi in chat": serve lo username, perche' una pagina
  // dentro Telegram apre solo link t.me. Il numero resta qui. Poche domande
  // a Telegram per volta: i prestiti aperti possono essere tanti.
  res.json({ prestiti: await mappaConLimite(prestiti, 5, async ({ telegram_id: tg, ...p }) =>
    ({ ...p, username: tg ? await usernameDi(tg) : null })) });
}));

// Chi amministra segna che un bene l'ha preso qualcun altro: unə sociə
// scelto dai suggerimenti, o solo un nome. Lo staff della sede lo sa subito.
router.post('/prenota/api/inventario/admin/presta', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloAdmin(utente, res)) return;
  const beneId = Number(req.body?.beneId);
  if (!beneId) return res.status(400).json({ errore: 'Quale bene?' });
  const nome = String(req.body?.nome || '').trim().slice(0, 120);
  const partnerId = Number(req.body?.partnerId) || false;
  const prestito = await odoo.miniapp('presta_a_nome', beneId, nome, partnerId, nomeTelegram(utente));
  const chatStaff = STAFF.get(String(prestito.sede || '').toLowerCase());
  if (chatStaff) {
    const scade = prestito.scadenza
      ? DateTime.fromISO(prestito.scadenza).setLocale('it').toFormat('d MMMM') : '';
    telegram('sendMessage', {
      chat_id: chatStaff,
      text: `${nomeTelegram(utente)} ha segnato che “${prestito.titolo}” a ${prestito.sede} ` +
        `l’ha preso ${prestito.socio}.` + (scade ? `\nDa riportare entro il ${scade}.` : ''),
    }).catch((err) => console.error('prestito a nome: messaggio allo staff non mandato:', err.message));
  }
  res.json({ prestito });
}));

// I nomi dellɜ sociɜ mentre si scrive, per collegare il prestito alla scheda.
router.post('/prenota/api/inventario/admin/soci', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloAdmin(utente, res)) return;
  const testo = String(req.body?.testo || '').trim().slice(0, 60);
  // Anche col campo vuoto: l'elenco nel foglio e' aperto da subito, in
  // ordine, e si scorre. Con poche lettere i nomi sono tanti: un tetto.
  res.json({ soci: (await odoo.miniapp('cerca_soci', testo)).slice(0, testo ? 20 : 60) });
}));

router.post('/prenota/api/inventario/admin/chiudi', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloAdmin(utente, res)) return;
  const prestitoId = Number(req.body?.prestitoId);
  if (!prestitoId) return res.status(400).json({ errore: 'Quale prestito?' });
  res.json({ prestito: await odoo.miniapp('chiudi_prestito', prestitoId, nomeTelegram(utente)) });
}));

router.post('/prenota/api/inventario/prolunga', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloAdmin(utente, res)) return;
  const prestitoId = Number(req.body?.prestitoId);
  if (!prestitoId) return res.status(400).json({ errore: 'Quale prestito?' });
  // Quanti giorni in piu' lo sceglie chi prolunga; senza, quelli di un prestito.
  const giorni = Math.min(365, Math.max(0, Math.round(Number(req.body?.giorni) || 0)));
  res.json({ prestito: await odoo.miniapp('prolunga', prestitoId, giorni, nomeTelegram(utente)) });
}));

// Il form dell'aggiunta parte dall'ISBN: dice se il libro c'e' gia' in
// quella sede, e porta titolo, autore, editore e anno se qualcuno li sa.
router.post('/prenota/api/inventario/isbn', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloStaff(utente, res)) return;
  const codice = isbn.normalizza(req.body?.isbn);
  if (!isbn.valido(codice)) return res.status(400).json({ errore: 'Questo ISBN non torna: controlla le cifre.' });
  const [esistenti, dati] = await Promise.all([
    odoo.miniapp('stesso_isbn', codice, Number(req.body?.sedeId) || false),
    isbn.cerca(codice),
  ]);
  res.json({ isbn: codice, esistenti, dati });
}));

// I campi del form di un bene, come li vuole Odoo. Serve all'aggiunta e
// alla modifica: nella modifica un campo vuoto svuota quello in Odoo.
async function valoriBene(v) {
  const testo = (x, max) => String(x || '').trim().slice(0, max) || false;
  const valori = {
    name: testo(v.titolo, 200),
    categoria: testo(v.categoria, 40) || 'altro',
    sede_id: Number(v.sedeId) || false,
    autore: testo(v.autore, 200),
    editore: testo(v.editore, 200),
    anno_pubblicazione: Number(v.anno) || false,
    isbn: v.isbn ? isbn.normalizza(v.isbn) : false,
    codice_interno: testo(v.codiceInterno, 40),
    valore_stimato: Number(String(v.valore || '').replace(',', '.')) || false,
    proprietario_libero: testo(v.proprietario, 120),
    note: testo(v.note, 2000),
    genere_ids: (v.generi || []).map(Number).filter(Boolean),
  };
  // Generi e sistemi scritti a mano: Odoo li cerca senza guardare le
  // maiuscole prima di crearne uno nuovo.
  for (const nome of (v.nuoviGeneri || []).slice(0, 5)) {
    if (String(nome).trim()) valori.genere_ids.push((await odoo.miniapp('crea_genere', String(nome).trim())).id);
  }
  if (String(v.nuovoSistema || '').trim()) {
    valori.sistema_id = (await odoo.miniapp('crea_sistema', String(v.nuovoSistema).trim())).id;
  } else if (Number(v.sistemaId)) {
    valori.sistema_id = Number(v.sistemaId);
  } else {
    valori.sistema_id = false;
  }
  return valori;
}

router.post('/prenota/api/inventario/aggiungi', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloStaff(utente, res)) return;
  const bene = await odoo.miniapp('crea_bene', await valoriBene(req.body?.valori || {}), nomeTelegram(utente));
  generiVisti.dimentica();   // un genere nuovo, o nuovo per questa categoria
  res.json({ bene });
}));

// Tenendo premuto un bene, chi amministra la biblioteca lo corregge.
router.post('/prenota/api/inventario/admin/bene', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloAdmin(utente, res)) return;
  const beneId = Number(req.body?.beneId);
  if (!beneId) return res.status(400).json({ errore: 'Quale bene?' });
  res.json({ valori: await odoo.miniapp('bene_da_modificare', beneId) });
}));

router.post('/prenota/api/inventario/admin/modifica', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloAdmin(utente, res)) return;
  const beneId = Number(req.body?.beneId);
  if (!beneId) return res.status(400).json({ errore: 'Quale bene?' });
  const v = req.body?.valori || {};
  const valori = await valoriBene(v);
  // Fuori dal form nessuno scrive l'ISBN di un gioco da tavolo: se il campo
  // era nascosto, quello che c'e' in Odoo resta.
  if (v.isbn === undefined) delete valori.isbn;
  valori.mancante = v.mancante === true;
  const bene = await odoo.miniapp('modifica_bene', beneId, valori, nomeTelegram(utente));
  generiVisti.dimentica();
  res.json({ bene });
}));
