// L'apertura dell'app (chi sei, cosa puoi fare), la registrazione al corpo
// associativo, la richiesta di tesseramento e gli errori della pagina.

import express from 'express';
import { DateTime } from 'luxon';
import * as prenotazioni from '../prenotazioni.js';
import * as odoo from '../odoo.js';
import * as soci from '../soci.js';
import { GRUPPI, CALENDARI, CATEGORIE, SEDI_INDIRIZZI, nomeSede } from '../config.js';
import { telegram, nomeTelegram, escHtml, eStaff, eDirettivo } from '../telegram.js';
import { conUtente, socioDi, dimenticaSocio, mancaGruppo, troppeChiamate } from '../sessione.js';
import { registraErrore } from '../erroriPagina.js';
import { inFila } from '../util.js';

export const router = express.Router();

router.post('/prenota/api/stato', (req, res) => conUtente(req, res, async (utente) => {
  // Qui si arriva anche da non soci: e' la rotta che dice all'app se
  // mostrare la registrazione. Il resto dello stato si da' solo ai soci.
  utente.socio = await socioDi(utente.id, { fresco: true });
  if (!utente.socio) {
    const fino = soci.rifiutatoFinoA(utente.id);
    return res.json({
      utente,
      socio: false,
      registrazione: {
        inAttesa: Boolean(soci.richiestaDi(utente.id)),
        rifiutatoFinoA: fino ? fino.setLocale('it').toFormat('d MMMM') : null,
        informativa: await odoo.miniapp('informativa'),
        // Il tesseramento dall'app e' ancora in prova: solo col link debug.
        iscrizione: utente.debug ? await odoo.miniapp('stato_iscrizione', utente.id) : null,
      },
    });
  }

  const [staff, direttivo] = await Promise.all([eStaff(utente.id), eDirettivo(utente.id)]);
  res.json({
    utente,
    socio: utente.socio,
    bloccato: prenotazioni.eBloccato(utente.id),
    staff,
    // Decide se l'app mostra "In vetrina". Il controllo vero si rifa' alla
    // prenotazione: chi esce dal gruppo con l'app aperta non ci mette niente.
    direttivo,
    // Il tasto delle quote dellɜ sociɜ, nella Tessera.
    tessere: direttivo || Boolean(utente.socio.admin_tessere),
    sedi: CALENDARI.map((c) => ({
      slug: c.sede,
      nome: nomeSede(c.sede),
      indirizzo: SEDI_INDIRIZZI.get(c.sede) || '',
    })),
    categorie: CATEGORIE,
    limiti: {
      oraMinima: prenotazioni.ORA_MINIMA,
      oraMassima: prenotazioni.ORA_MASSIMA,
      maxContemporanei: prenotazioni.MAX_CONTEMPORANEI,
      giorniAvanti: prenotazioni.GIORNI_AVANTI,
    },
  });
}, { soloSoci: false }));

// ---------- registrazione ----------
// Nome e cognome li dice la persona, che e' sociə lo conferma il direttivo
// dal suo gruppo: chi entra nel corpo associativo e' una decisione sua, non
// dello staff di una sede.
const PAROLA_MAX = 60;

const nomeScheda = (c) => `${c.nome}${c.numero_socio ? ' (n. ' + c.numero_socio + ')' : ''}`;

// Chi si iscrive e cosa dice di essere. La domanda sotto (testoCandidati)
// resta fuori: quando qualcuno risponde, al suo posto va l'esito.
function testoRegistrazione(utente, nome, cognome) {
  return `<code>${escHtml(`${nomeTelegram(utente)}, id ${utente.id}`)}</code> si sta iscrivendo,\n` +
         `dice di essere ${escHtml(`${nome} ${cognome}`)}.`;
}

export function testoCandidati(candidati, nome, cognome) {
  if (!candidati.length) return 'Su Odoo non c’è nessuna scheda con questo nome: è una persona nuova?';
  const stesso = (c) => c.nome.trim().toLowerCase() === `${nome} ${cognome}`.trim().toLowerCase();
  if (candidati.length === 1) {
    return stesso(candidati[0])
      ? 'Su Odoo c’è un utente omonimo, collego gli account?'
      : `Su Odoo c’è un utente con un nome simile, ${escHtml(nomeScheda(candidati[0]))}: collego gli account?`;
  }
  return 'Su Odoo ci sono utenti con un nome simile:\n' +
         candidati.map((c) => `- ${escHtml(nomeScheda(c))}`).join('\n') +
         '\nCollego gli account a uno di questi?';
}

// Con una sola scheda simile il pulsante dice solo cosa fa; con piu' di una
// deve dire anche quale.
export function tastieraRegistrazione(id, candidati) {
  return [
    ...candidati.map((c) => [{
      text: candidati.length === 1 ? 'Collega ad utente Odoo' : `Collega ad utente Odoo: ${nomeScheda(c)}`,
      callback_data: `socio:${id}:${c.id}`,
    }]),
    [
      { text: 'Persona nuova', callback_data: `socio:${id}:nuovo` },
      { text: 'Non è nel libro soci', callback_data: `socio:${id}:no` },
    ],
  ];
}

// Un doppio tocco su "Invia richiesta" faceva due schede provvisorie in
// Odoo e due messaggi al direttivo: le registrazioni della stessa persona
// vanno una per volta, e la seconda trova gia' la richiesta della prima.
router.post('/prenota/api/registrati', (req, res) => conUtente(req, res, (utente) =>
  inFila(`registrati:${utente.id}`, () => registrati(req, res, utente)), { soloSoci: false }));

async function registrati(req, res, utente) {
  const nome = String(req.body?.nome || '').trim();
  const cognome = String(req.body?.cognome || '').trim();
  if (!nome || !cognome || nome.length > PAROLA_MAX || cognome.length > PAROLA_MAX) {
    return res.status(400).json({ errore: 'Servono nome e cognome.' });
  }
  if (req.body?.socio !== true) {
    return res.status(400).json({ errore: 'L’app è riservata al corpo associativo.' });
  }
  if (req.body?.privacy !== true) {
    return res.status(400).json({ errore: 'Serve accettare l’informativa.' });
  }
  if (soci.richiestaDi(utente.id)) return res.json({ ok: true, inAttesa: true });
  if (await socioDi(utente.id, { fresco: true })) {
    return res.status(409).json({ errore: 'La registrazione è già fatta.' });
  }
  // Chi lo staff ha sospeso con /blocca non manda richieste: e' lo stesso
  // comando delle prenotazioni.
  if (prenotazioni.eBloccato(utente.id)) {
    return res.status(403).json({ errore: 'Lo staff ha sospeso il tuo accesso: parlane in sede.' });
  }
  // Un account Telegram fa una richiesta per volta, ma cento account finti
  // ne fanno cento, e finiscono tutte nel gruppo direttivo. Oltre il tetto
  // si aspetta che il direttivo smaltisca.
  if (soci.quanteInAttesa() >= soci.MAX_IN_ATTESA) {
    console.error('registrazione: troppe richieste in attesa, nuove respinte');
    return res.status(503).json({ errore: 'Troppe richieste in attesa: riprova fra qualche ora.' });
  }
  const fino = soci.rifiutatoFinoA(utente.id);
  if (fino) {
    return res.status(403).json({
      errore: `Il direttivo non ha confermato la tua iscrizione: puoi riprovare dal ` +
              `${fino.setLocale('it').toFormat('d MMMM')}, o parlarne in sede`,
    });
  }
  const chatDirettivo = GRUPPI.get('direttivo');
  if (!chatDirettivo) return mancaGruppo(res, 'direttivo', 'il direttivo');

  // L'esito arriva in chat privata, e i promemoria dei prestiti pure: se il
  // bot non puo' scrivere a questa persona, lo si dice adesso e non quando
  // il direttivo ha gia' risposto.
  try {
    await telegram('sendChatAction', { chat_id: utente.id, action: 'typing' });
  } catch {
    return res.status(409).json({
      errore: 'Apri la chat privata con il bot, premi Avvia, poi riapri l’app da lì.',
    });
  }

  // Si entra subito: nasce una scheda provvisoria e l'app si usa da adesso.
  // Il direttivo decide dopo; se dice di no, l'accesso si chiude.
  const privacy = DateTime.now().toUTC().toFormat('yyyy-LL-dd HH:mm:ss');
  const candidati = await odoo.miniapp('candidati', nome, cognome);
  const provvisorio = await odoo.miniapp('registra_provvisorio', utente.id, nome, cognome, privacy);
  const testo = testoRegistrazione(utente, nome, cognome);
  // `html`: il testo va mandato con parse_mode HTML. Le richieste salvate
  // prima non ce l'hanno, e restano testo semplice.
  const id = soci.salva({ utente, nome, cognome, testo, html: true, privacy, provvisorio: provvisorio.id });

  const tastiera = tastieraRegistrazione(id, candidati);

  let messaggio;
  try {
    messaggio = await telegram('sendMessage', {
      chat_id: chatDirettivo, text: `${testo}\n\n${testoCandidati(candidati, nome, cognome)}`,
      parse_mode: 'HTML', reply_markup: { inline_keyboard: tastiera },
    });
  } catch (err) {
    // Senza il messaggio nessuno deciderebbe mai: la scheda provvisoria si
    // toglie, e si riprova da capo.
    console.error('registrazione: gruppo direttivo:', err.message);
    soci.chiudi(id);
    await odoo.miniapp('rifiuta_provvisorio', provvisorio.id, 'sistema (direttivo non avvisato)')
      .catch((e) => console.error('registrazione: provvisoria non tolta:', e.message));
    return res.status(500).json({ errore: 'Non sono riuscito ad avvisare il direttivo: riprova.' });
  }
  soci.aggiorna(id, { messaggi: [{ chat: chatDirettivo, id: messaggio.message_id }] });
  dimenticaSocio(utente.id);
  res.json({ ok: true, socio: provvisorio });
}

// Chi non e' sociə chiede il tesseramento dall'app. La quota si paga in
// sede; il direttivo, quando l'ha vista, sceglie con che metodo e la
// scheda nasce con la sua ricevuta. Finche' e' in prova, solo col link debug.
const TESTO_MAX = 120;
router.post('/prenota/api/iscrizione', (req, res) => conUtente(req, res, async (utente) => {
  if (!utente.debug) return res.status(404).json({ errore: 'Non c’è.' });
  if (await socioDi(utente.id, { fresco: true })) {
    return res.status(409).json({ errore: 'Hai già la tessera.' });
  }
  if (prenotazioni.eBloccato(utente.id)) {
    return res.status(403).json({ errore: 'Lo staff ha sospeso il tuo accesso: parlane in sede.' });
  }
  const chatDirettivo = GRUPPI.get('direttivo');
  if (!chatDirettivo) return mancaGruppo(res, 'direttivo', 'il direttivo');
  if (req.body?.privacy !== true) return res.status(400).json({ errore: 'Serve accettare l’informativa.' });
  const v = req.body?.valori || {};
  const valori = Object.fromEntries(
    ['nome', 'cognome', 'data_nascita', 'luogo_nascita', 'codice_fiscale', 'email', 'telefono',
     'indirizzo', 'cap', 'citta', 'provincia'].map((k) => [k, String(v[k] || '').trim().slice(0, TESTO_MAX)]));
  valori.messaggio = String(v.messaggio || '').trim().slice(0, 1000);
  // L'esito arriva in chat: se il bot non puo' scrivere, lo si dice adesso.
  try {
    await telegram('sendChatAction', { chat_id: utente.id, action: 'typing' });
  } catch {
    return res.status(409).json({ errore: 'Apri la chat privata con il bot, premi Avvia, poi riapri l’app da lì.' });
  }
  const gia = (await odoo.miniapp('stato_iscrizione', utente.id)).richiesta;
  const richiesta = await odoo.miniapp('richiedi_iscrizione', utente.id, valori);
  if (gia) return res.json({ richiesta });
  const nascita = DateTime.fromISO(valori.data_nascita).setLocale('it').toFormat('d MMMM yyyy');
  try {
    await telegram('sendMessage', {
      chat_id: chatDirettivo,
      parse_mode: 'HTML',
      text: `<code>${escHtml(`${nomeTelegram(utente)}, id ${utente.id}`)}</code> chiede di tesserarsi,\n` +
            `dice di essere ${escHtml(`${valori.nome} ${valori.cognome}`)}, ` +
            `nascita: ${escHtml(valori.luogo_nascita)}, ${nascita}.\n` +
            'I dati completi sono nella richiesta di iscrizione in Odoo.\n\n' +
            'Quando ha pagato la quota in sede, segna come:',
      reply_markup: { inline_keyboard: [
        [{ text: 'Contanti', callback_data: `iscr:${richiesta.id}:contanti` },
         { text: 'Satispay', callback_data: `iscr:${richiesta.id}:satispay` },
         { text: 'Bonifico', callback_data: `iscr:${richiesta.id}:bonifico` }],
        [{ text: 'Rifiuta', callback_data: `iscr:${richiesta.id}:no` }],
      ] },
    });
  } catch (err) {
    console.error('iscrizione: direttivo non avvisato:', err.message);
  }
  res.json({ richiesta });
}, { soloSoci: false }));

// ---------- errori della pagina ----------
// Dietro nginx req.ip e' sempre 127.0.0.1: l'indirizzo vero sta in
// X-Real-IP, che si crede solo se la richiesta arriva da nginx.
const indirizzo = (req) =>
  (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip) && req.get('x-real-ip')) || req.ip;

router.post('/prenota/api/errore-pagina', (req, res) => {
  const ip = indirizzo(req);
  if (troppeChiamate(`ip:${ip}`)) return res.status(429).end();
  const messaggio = String(req.body?.messaggio || '').slice(0, 300);
  if (!messaggio) return res.status(400).end();
  const dove = String(req.body?.dove || '').slice(0, 120);
  console.error('pagina:', messaggio, dove);
  registraErrore(messaggio, dove, ip);
  res.status(204).end();
});
