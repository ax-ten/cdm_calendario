// ---------- tessera ----------
// La propria tessera: mensilita' dell'anno e ricevute. Una ricevuta si
// chiede e arriva in chat come PDF: dentro Telegram una pagina non sa
// scaricare file.
//
// ---------- quote dellɜ sociɜ, per il direttivo ----------
// Non tutte le quote passano dall'app: molte si pagano in sede, in contanti
// o con Satispay, e qualcuno le deve segnare. Da qui il direttivo vede chi
// ha rinnovato il tesseramento e quali mensilita' ha pagato ciascunə,
// registra un pagamento fatto fuori dall'app (la ricevuta nasce in Odoo come
// le altre) e manda un promemoria in chat a chi ha Telegram collegato.
// Annullare o correggere una ricevuta si fa in Odoo, non da qui.
//
// In Odoo (crocevia.miniapp) servono:
//   ricevute_pdf(telegram_id, ricevuta_ids) -> { pdf (base64), nome_file }
//                          un PDF solo con le ricevute scelte (solo le sue),
//                          una per pagina, nell'ordine dato
//   pagamenti(da, a)  -> [{ id, numero, data, partner_id, socio, codice, tipo,
//                          importo, mese, metodo }]  le ricevute del periodo,
//                          annullate escluse, dalla piu' recente
//   quote_soci(anno) -> [{ id, nome, numero_socio, categoria, tesserato, oboli,
//                          mensilita: ['2026-01', ...], telegram_id }]
//   tessera_socio(partner_id, anno) -> come tessera(), piu' id, telegram_id
//                          e importi.tesseramento
//   registra_pagamento(partner_id, { codice, metodo, data, mesi, importo, evento }, da_chi)
//                       evento: il nome dell'evento, per il contributo evento
//                       (sulla ricevuta, e restituito come evento nelle ricevute)
//                       -> { nome, telegram_id, ricevute: [{ id, numero, tipo, importo, data, mese }] }
//                       Per chi non ha la tessera dell'anno, la prima mensilita'
//                       pagata vale anche come tesseramento.
//   prestiti_aperti()    in ogni prestito anche telegram_id, per aprire la chat
// e, facoltative, nella risposta di socio_da_telegram: la spunta admin_tessere
// e tesserato (senza la tessera dell'anno non si prenota).

import express from 'express';
import { DateTime } from 'luxon';
import * as odoo from '../odoo.js';
import { ZONA, GRUPPI, nomeSede } from '../config.js';
import { eventiDiTutte } from '../calendario.js';
import { telegram, mandaFile, ErroreTelegram, nomeTelegram, ruoloDi } from '../telegram.js';
import { conUtente, soloAdminTessere, dimenticaSocio } from '../sessione.js';
import { Cache, mappaConLimite, senzaDoppioni } from '../util.js';

export const router = express.Router();

router.post('/prenota/api/tessera', (req, res) => conUtente(req, res, async (utente) => {
  res.json({ tessera: await odoo.miniapp('tessera', utente.id) });
}));

// Una ricevuta in PDF, in chat a chi l'ha chiesta.
const pdfInChat = (chatId, didascalia, r) => mandaFile('sendDocument',
  { chat_id: String(chatId), caption: didascalia },
  'document', Buffer.from(r.pdf, 'base64'), 'application/pdf', r.nome_file);

// Se ne possono chiedere tante insieme (un anno intero): o un PDF unico, una
// ricevuta per pagina, o un file per ricevuta, una per messaggio,
// nell'ordine scelto. Il tetto sui file separati evita di inondare la chat.
const RICEVUTE_PER_VOLTA = 30;
const RICEVUTE_IN_UN_PDF = 200;
const TESTO_CHAT_CHIUSA = 'Non riesco a mandartele in chat: apri la chat con il bot e premi Avvia.';

router.post('/prenota/api/tessera/ricevuta', (req, res) => conUtente(req, res, async (utente) => {
  const ids = [...new Set((req.body?.ricevutaIds || [req.body?.ricevutaId]).map(Number).filter(Boolean))];
  if (!ids.length) return res.status(400).json({ errore: 'Quali ricevute?' });
  if (req.body?.unico && ids.length > 1) {
    if (ids.length > RICEVUTE_IN_UN_PDF) {
      return res.status(400).json({ errore: `Al massimo ${RICEVUTE_IN_UN_PDF} ricevute in un file.` });
    }
    // Odoo rende il report di tutte insieme: un PDF, una ricevuta per pagina.
    const r = await odoo.miniapp('ricevute_pdf', utente.id, ids);
    try {
      await pdfInChat(utente.id, `${ids.length} ricevute`, r);
    } catch (err) {
      if (!(err instanceof ErroreTelegram)) throw err;
      console.error('ricevute: sendDocument:', err.message);
      return res.status(502).json({ errore: TESTO_CHAT_CHIUSA });
    }
    return res.json({ ok: true, mandate: ids.length, file: 1 });
  }
  if (ids.length > RICEVUTE_PER_VOLTA) {
    return res.status(400).json({ errore: `Al massimo ${RICEVUTE_PER_VOLTA} file separati per volta: per più ricevute scegli il PDF unico.` });
  }
  let mandate = 0;
  for (const id of ids) {
    const r = await odoo.miniapp('ricevuta_pdf', utente.id, id);
    try {
      await pdfInChat(utente.id, `Ricevuta ${r.numero}`, r);
    } catch (err) {
      if (!(err instanceof ErroreTelegram) && !mandate) throw err;
      console.error('ricevuta: sendDocument:', err.message);
      return res.status(502).json({ errore: mandate
        ? `Te ne ho mandate ${mandate}, poi Telegram si è fermato: riprova con le altre.`
        : TESTO_CHAT_CHIUSA });
    }
    mandate += 1;
  }
  res.json({ ok: true, mandate });
}));

const VOCI_QUOTA = {
  tesseramento: 'Tesseramento',
  contributo_mensile: 'Mensilità',
  obolo_giornaliero: 'Obolo',
  contributo_evento: 'Contributo evento',
};
const METODI_QUOTA = { contanti: 'in contanti', paypal: 'con PayPal', bonifico: 'con bonifico', stripe: 'con Stripe' };
const IMPORTO_EVENTO_MAX = 50;
const euroTesto = (n) => `${Number(n).toLocaleString('it-IT', { minimumFractionDigits: n % 1 ? 2 : 0 })} €`;
const nomeMese = (k) => DateTime.fromISO(`${k}-01`).setLocale('it').toFormat('LLLL yyyy');

// L'anno chiesto, o quello in corso. Piu' indietro di cosi' non serve.
function annoQuote(valore) {
  const adesso = DateTime.now().setZone(ZONA).year;
  const anno = Number(valore) || adesso;
  return anno >= 2000 && anno <= adesso + 1 ? anno : adesso;
}

router.post('/prenota/api/tessere/elenco', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloAdminTessere(utente, res)) return;
  const anno = annoQuote(req.body?.anno);
  const soci = await odoo.miniapp('quote_soci', anno);
  // Il numero di Telegram resta qui: alla pagina basta sapere se c'e', e
  // se la persona sta nel direttivo o nello staff (la stellina). Poche
  // domande a Telegram per volta: l'elenco e' di tutto il corpo associativo.
  res.json({
    anno,
    soci: await mappaConLimite(soci, 5, async ({ telegram_id: tg, ...s }) =>
      ({ ...s, telegram: Boolean(tg), ruolo: tg ? await ruoloDi(tg) : null })),
  });
}));

// Gli eventi in calendario in un giorno, in tutte le sedi: i nomi che l'app
// propone quando si segna un contributo evento. Si tengono cinque minuti.
const EVENTI_VALIDI_PER_MS = 5 * 60 * 1000;
const eventiVisti = new Cache(100);
router.post('/prenota/api/eventi-del-giorno', (req, res) => conUtente(req, res, async () => {
  const giorno = DateTime.fromISO(String(req.body?.data || ''), { zone: ZONA });
  if (!giorno.isValid) return res.status(400).json({ errore: 'Che giorno?' });
  const chiave = giorno.toISODate();
  const visto = eventiVisti.cerca(chiave, EVENTI_VALIDI_PER_MS);
  if (visto) return res.json({ eventi: visto.valore });
  const letti = await eventiDiTutte({
    timeMin: giorno.startOf('day').toISO(), timeMax: giorno.endOf('day').toISO(), maxResults: 50,
  });
  const eventi = letti.filter(({ ev }) => ev.summary).map(({ ev, sede }) => ({
    titolo: ev.summary.trim(),
    ora: ev.start?.dateTime ? DateTime.fromISO(ev.start.dateTime).setZone(ZONA).toFormat('HH:mm') : '',
    sede: nomeSede(sede),
  }))
    .sort((a, b) => a.ora.localeCompare(b.ora))
    .filter((e, i, tutti) => tutti.findIndex((x) => x.titolo === e.titolo) === i);
  eventiVisti.metti(chiave, eventi);
  res.json({ eventi });
}));

// La cronologia: tutti i pagamenti fra due date, di tutte le persone. Un
// anno al massimo per volta, che e' gia' tanto da scorrere.
router.post('/prenota/api/tessere/pagamenti', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloAdminTessere(utente, res)) return;
  const da = DateTime.fromISO(String(req.body?.da || ''), { zone: ZONA });
  const a = DateTime.fromISO(String(req.body?.a || ''), { zone: ZONA });
  if (!da.isValid || !a.isValid || a < da) return res.status(400).json({ errore: 'Che periodo?' });
  if (a.diff(da, 'days').days > 366) return res.status(400).json({ errore: 'Al massimo un anno per volta.' });
  res.json({ pagamenti: await odoo.miniapp('pagamenti', da.toISODate(), a.toISODate()) });
}));

router.post('/prenota/api/tessere/socio', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloAdminTessere(utente, res)) return;
  const partnerId = Number(req.body?.partnerId);
  if (!partnerId) return res.status(400).json({ errore: 'Quale persona?' });
  const { telegram_id: tg, ...tessera } =
    await odoo.miniapp('tessera_socio', partnerId, annoQuote(req.body?.anno));
  res.json({ tessera: { ...tessera, telegram: Boolean(tg) } });
}));

// Cosa e' stato pagato, come e quando: lo stesso per un pagamento solo e
// per tanti insieme. Le mensilita' le dice ogni riga, perche' chi ha gia'
// pagato un mese non lo ripaga. Restituisce { errore } o { valori, data }.
function leggiPagamento(b) {
  const codice = String(b.codice || '');
  if (!VOCI_QUOTA[codice]) return { errore: 'Cosa ha pagato?' };
  const metodo = String(b.metodo || '');
  if (!METODI_QUOTA[metodo]) return { errore: 'Come ha pagato?' };
  const oggi = DateTime.now().setZone(ZONA).startOf('day');
  const data = DateTime.fromISO(String(b.data || ''), { zone: ZONA });
  if (!data.isValid || data > oggi.endOf('day')) return { errore: 'Quando ha pagato?' };
  const valori = { codice, metodo, data: data.toISODate(), mesi: [], importo: false };
  if (codice === 'contributo_evento') {
    const importo = Number(b.importo);
    if (!(importo > 0 && importo <= IMPORTO_EVENTO_MAX)) return { errore: 'Quanto ha dato?' };
    valori.importo = Math.round(importo * 100) / 100;
    // Il nome dell'evento, se c'e': va sulla ricevuta.
    valori.evento = String(b.evento || '').trim().slice(0, 120) || false;
  }
  return { valori, data };
}

function mesiDi(lista) {
  const mesi = [...new Set((Array.isArray(lista) ? lista : []).map(String))]
    .filter((m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m)).sort();
  return mesi.length && mesi.length <= 12 ? mesi : null;
}

const cosaPagata = (valori, data) => valori.codice === 'contributo_mensile'
  ? `${VOCI_QUOTA[valori.codice]} di ${valori.mesi.map(nomeMese).join(', ')}`
  : `${VOCI_QUOTA[valori.codice]}${valori.evento ? ` “${valori.evento}”` : ''} del ${data.setLocale('it').toFormat('d MMMM yyyy')}`;

// Lo stesso pagamento segnato due volte in pochi minuti dalla stessa
// persona (doppio tocco, rete che ritrasmette) e' uno solo: la seconda
// volta si risponde con le ricevute della prima, senza registrarlo di nuovo
// ne' riscrivere a chi ha pagato.
const PAGAMENTO_RIPETUTO_ENTRO_MS = 5 * 60 * 1000;
const pagamentiRecenti = senzaDoppioni(PAGAMENTO_RIPETUTO_ENTRO_MS);

const chiavePagamento = (utente, partnerId, valori) => JSON.stringify([
  utente.id, partnerId, valori.codice, valori.metodo, valori.data,
  valori.mesi, valori.importo, valori.evento || false,
]);

// Registra in Odoo e scrive a chi ha pagato, se ha Telegram collegato.
// Per chi non ha ancora la tessera dell'anno, Odoo fa della prima
// mensilita' anche il tesseramento. { ripetuta: true } se era un doppione.
async function registraUno(utente, partnerId, valori, data) {
  const { valore, ripetuta } = await pagamentiRecenti(chiavePagamento(utente, partnerId, valori), async () => {
    const esito = await odoo.miniapp('registra_pagamento', partnerId, valori, nomeTelegram(utente));
    const ricevute = esito.ricevute || [];
    const totale = ricevute.reduce((n, r) => n + Number(r.importo || 0), 0);
    const cosa = cosaPagata(valori, data);
    if (esito.telegram_id) {
      dimenticaSocio(esito.telegram_id);
      telegram('sendMessage', {
        chat_id: esito.telegram_id,
        text: `Il direttivo ha registrato il tuo pagamento: ${cosa}, ${euroTesto(totale)}. ` +
              'Trovi la ricevuta nella Tessera, dentro l’app.',
      }).catch((err) => console.error('quote: avviso del pagamento non mandato:', err.message));
    }
    return { nome: esito.nome, ricevute, totale, cosa };
  });
  if (ripetuta) console.error(`quote: pagamento ripetuto per ${partnerId} da ${utente.id}, non registrato due volte`);
  return { ...valore, ripetuta };
}

function avvisaDirettivo(testo) {
  const chatDirettivo = GRUPPI.get('direttivo');
  if (!chatDirettivo) return;
  telegram('sendMessage', { chat_id: chatDirettivo, text: testo })
    .catch((err) => console.error('quote: direttivo non avvisato:', err.message));
}

// Un pagamento fatto in sede: la voce, come, quando e, per le mensilita',
// quali mesi. Al direttivo arriva una riga nel gruppo, cosi' se due persone
// segnano la stessa cosa se ne accorge qualcuno.
router.post('/prenota/api/tessere/registra', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloAdminTessere(utente, res)) return;
  const b = req.body || {};
  const partnerId = Number(b.partnerId);
  if (!partnerId) return res.status(400).json({ errore: 'Quale persona?' });
  const { errore, valori, data } = leggiPagamento(b);
  if (errore) return res.status(400).json({ errore });
  if (valori.codice === 'contributo_mensile') {
    valori.mesi = mesiDi(b.mesi);
    if (!valori.mesi) return res.status(400).json({ errore: 'Quali mesi?' });
  }
  const fatto = await registraUno(utente, partnerId, valori, data);
  if (!fatto.ripetuta) {
    avvisaDirettivo(`${nomeTelegram(utente)} ha registrato per ${fatto.nome}: ${fatto.cosa}, ` +
                    `${euroTesto(fatto.totale)} ${METODI_QUOTA[valori.metodo]}.`);
  }
  res.json({ ricevute: fatto.ricevute, totale: fatto.totale });
}));

// Lo stesso pagamento per tante persone insieme: l'obolo di una serata, le
// mensilita' raccolte a un'apertura. Si va una persona alla volta; chi non
// va a buon fine resta nell'elenco con il motivo, gli altri sono registrati.
// Al direttivo una riga sola, con tutti i nomi (registrati adesso: chi era
// gia' stato registrato da un invio identico di poco prima non si ripete).
const PAGAMENTI_PER_VOLTA = 60;
router.post('/prenota/api/tessere/registra-tanti', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloAdminTessere(utente, res)) return;
  const b = req.body || {};
  const { errore, valori, data } = leggiPagamento(b);
  if (errore) return res.status(400).json({ errore });
  const righe = (Array.isArray(b.righe) ? b.righe : [])
    .map((r) => ({ partnerId: Number(r?.partnerId), mesi: r?.mesi }))
    .filter((r, i, tutte) => r.partnerId && tutte.findIndex((x) => x.partnerId === r.partnerId) === i);
  if (!righe.length) return res.status(400).json({ errore: 'Per chi?' });
  if (righe.length > PAGAMENTI_PER_VOLTA) {
    return res.status(400).json({ errore: `Al massimo ${PAGAMENTI_PER_VOLTA} persone per volta.` });
  }
  const esiti = [];
  const nuovi = [];
  for (const r of righe) {
    const suoi = { ...valori };
    if (valori.codice === 'contributo_mensile') {
      suoi.mesi = mesiDi(r.mesi);
      if (!suoi.mesi) { esiti.push({ partnerId: r.partnerId, ok: false, errore: 'Quali mesi?' }); continue; }
    }
    try {
      const fatto = await registraUno(utente, r.partnerId, suoi, data);
      esiti.push({ partnerId: r.partnerId, ok: true, nome: fatto.nome, totale: fatto.totale });
      if (!fatto.ripetuta) nuovi.push(fatto);
    } catch (err) {
      if (!(err instanceof odoo.ErroreOdoo && err.perUtente)) console.error('quote: pagamento non registrato:', err.message);
      esiti.push({ partnerId: r.partnerId, ok: false,
        errore: err.perUtente ? err.message : 'Non registrato: riprova.' });
    }
  }
  if (nuovi.length) {
    const totale = nuovi.reduce((n, e) => n + e.totale, 0);
    const voce = valori.codice === 'contributo_mensile' ? VOCI_QUOTA[valori.codice] : cosaPagata(valori, data);
    avvisaDirettivo(`${nomeTelegram(utente)} ha registrato ${voce} per ${nuovi.length} ` +
      `${nuovi.length === 1 ? 'persona' : 'persone'}, ${euroTesto(totale)} ${METODI_QUOTA[valori.metodo]}: ` +
      nuovi.map((e) => e.nome).join(', ') + '.');
  }
  res.json({ esiti });
}));

// Un promemoria in chat a chi ha Telegram collegato: cosa risulta da pagare
// lo dice il server, dalla scheda, non chi preme. Uno al giorno per sociə,
// anche se lo premono in due.
const promemoriaQuote = new Cache(5000);
router.post('/prenota/api/tessere/ricorda', (req, res) => conUtente(req, res, async (utente) => {
  if (!await soloAdminTessere(utente, res)) return;
  const partnerId = Number(req.body?.partnerId);
  if (!partnerId) return res.status(400).json({ errore: 'Quale persona?' });
  const oggi = DateTime.now().setZone(ZONA);
  if (promemoriaQuote.cerca(partnerId)?.valore === oggi.toISODate()) {
    return res.status(409).json({ errore: 'Un promemoria è già partito oggi.' });
  }
  const t = await odoo.miniapp('tessera_socio', partnerId, oggi.year);
  if (!t.telegram_id) return res.status(409).json({ errore: 'Non ha Telegram collegato.' });
  const manca = [];
  if (!t.tesserato) manca.push(`il tesseramento ${oggi.year}`);
  const questoMese = oggi.toFormat('yyyy-MM');
  if (!(t.mensilita || []).includes(questoMese)) manca.push(`la mensilità di ${oggi.setLocale('it').toFormat('LLLL')}`);
  if (!manca.length) return res.status(409).json({ errore: 'È in regola: non c’è niente da ricordare.' });
  try {
    await telegram('sendMessage', {
      chat_id: t.telegram_id,
      text: `Ciao! Un promemoria dal direttivo del Crocevia dei Mondi: risulta ancora da pagare ` +
            `${manca.join(' e ')}. Puoi pagare in sede, alla prossima apertura.`,
    });
  } catch (err) {
    console.error('quote: promemoria non mandato:', err.message);
    return res.status(502).json({ errore: 'Telegram non l’ha consegnato: forse ha bloccato il bot.' });
  }
  promemoriaQuote.metti(partnerId, oggi.toISODate());
  res.json({ ok: true, manca });
}));
