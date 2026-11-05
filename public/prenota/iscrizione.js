// Chi entra la prima volta: registrazione e richiesta di tesseramento.

// ---------------------------------------------------------- registrazione
const reg = (id) => el(`reg-${id}`);

function mostraRegistrazione(info) {
  document.querySelector('nav.tab').hidden = true;
  el('pannello-prenota').hidden = true;
  el('pannello-mie').hidden = true;
  el('pannello-inventario').hidden = true;
  el('pannello-registrazione').hidden = false;

  if (DEBUG && info.iscrizione?.richiesta) return attesaTesseramento(info.iscrizione);
  if (DEBUG && info.iscrizione) {
    el('vai-iscrizione').hidden = false;
    el('apri-iscrizione').onclick = () => mostraIscrizione(info);
  }
  if (info.inAttesa) return esitoRegistrazione(
    'Richiesta inviata al direttivo. Quando risponde ti scrivo qui in chat, poi riapri l’app.');
  if (info.rifiutatoFinoA) return esitoRegistrazione(
    `Il direttivo non ha confermato la tua iscrizione. Se è un errore parlane in sede, ` +
    `oppure riprova dal ${info.rifiutatoFinoA}.`);

  if (info.informativa) {
    el('informativa').replaceChildren(pulisciHtml(info.informativa));
  } else {
    el('informativa').textContent = 'Il testo completo lo trovi in sede.';
  }

  for (const id of ['nome', 'cognome']) reg(id).addEventListener('input', aggiornaRegistrazione);
  for (const id of ['socio', 'privacy']) reg(id).addEventListener('change', aggiornaRegistrazione);
  document.body.classList.add('senza-menu');
  azionePrincipale = registrati;
  aggiornaRegistrazione();
}

// Il testo dell'informativa lo scrive chi amministra Odoo, ma passa da una
// pagina che gira dentro Telegram. Togliere quello che e' pericoloso non
// basta (c'e' sempre un modo nuovo: java&#9;script:, <base>, <form>...):
// si tiene solo quello che serve a un testo, e tutto il resto diventa
// testo semplice. Il documento di DOMParser non esegue niente e non carica
// niente; i nodi buoni si rifanno da capo in questa pagina.
const TAG_INFORMATIVA = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'A']);
// Di questi non resta neanche il testo: non e' testo da leggere.
const TAG_SENZA_TESTO = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'TITLE', 'HEAD', 'IFRAME',
  'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEXTAREA', 'SELECT']);

function pulisciHtml(testo) {
  const sorgente = new DOMParser().parseFromString(String(testo), 'text/html');
  const fuori = document.createDocumentFragment();
  const copia = (da, a) => {
    for (const n of da.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) { a.append(n.data); continue; }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = n.tagName.toUpperCase();
      if (TAG_SENZA_TESTO.has(tag)) continue;
      if (!TAG_INFORMATIVA.has(tag)) { copia(n, a); continue; }
      const nuovo = document.createElement(tag.toLowerCase());
      if (tag === 'A') {
        // Solo link veri: https, http, mailto. L'indirizzo lo legge URL,
        // che toglie tabulazioni e a capo come fa il browser.
        let indirizzo = null;
        try { indirizzo = new URL(n.getAttribute('href') || '', 'https://invalido.invalid/'); } catch {}
        if (indirizzo && ['https:', 'http:', 'mailto:'].includes(indirizzo.protocol)
            && indirizzo.hostname !== 'invalido.invalid') {
          nuovo.href = indirizzo.href;
          nuovo.target = '_blank';
          nuovo.rel = 'noopener noreferrer';
        }
      }
      copia(n, nuovo);
      a.append(nuovo);
    }
  };
  copia(sorgente.body, fuori);
  return fuori;
}

function registrazioneCompleta() {
  return Boolean(reg('nome').value.trim() && reg('cognome').value.trim() &&
                 reg('socio').checked &&
                 reg('privacy').checked);
}

// Finche' manca qualcosa il pulsante e' grigio.
function aggiornaRegistrazione() {
  pulsantePrincipale('Invia richiesta', registrazioneCompleta());
}

async function registrati() {
  if (!registrazioneCompleta()) return;
  attesaAzione(true);
  try {
    await chiama('registrati', {
      nome: reg('nome').value.trim(),
      cognome: reg('cognome').value.trim(),
      socio: reg('socio').checked,
      privacy: reg('privacy').checked,
    });
    // Si entra subito: la pagina riparte, e stavolta sei sociə (per ora).
    location.reload();
  } catch (err) {
    lamenta(err.message);
    attesaAzione(false);
  }
}

function esitoRegistrazione(testo) {
  el('modulo-registrazione').hidden = true;
  el('esito-registrazione').textContent = testo;
  el('esito-registrazione').hidden = false;
  nascondiAzione();
}

// ------------------------------------------------------------ tesseramento
// Chi non e' sociə: i dati per il libro soci, poi la quota in sede.
const CAMPI_ISCRIZIONE = ['nome', 'cognome', 'data_nascita', 'luogo_nascita', 'codice_fiscale',
                          'email', 'telefono', 'indirizzo', 'cap', 'citta', 'provincia', 'messaggio'];
const FACOLTATIVI = new Set(['telefono', 'provincia', 'messaggio']);
const isc = (id) => el(`isc-${id}`);
let quotaIscrizione = 0;
let iscrizioneCollegata = false;

function mostraIscrizione(info) {
  el('pannello-registrazione').hidden = true;
  el('pannello-iscrizione').hidden = false;
  quotaIscrizione = info.iscrizione.quota;
  el('quota-iscrizione').textContent = euro(quotaIscrizione);
  el('informativa-iscrizione').replaceChildren(...el('informativa').cloneNode(true).childNodes);
  el('chiudi-iscrizione').onclick = () => {
    el('pannello-iscrizione').hidden = true;
    el('pannello-registrazione').hidden = false;
    azionePrincipale = registrati;
    aggiornaRegistrazione();
  };
  // Si apre e si chiude quante volte si vuole: i campi si collegano una volta.
  if (!iscrizioneCollegata) {
    iscrizioneCollegata = true;
    for (const k of CAMPI_ISCRIZIONE) isc(k).addEventListener('input', aggiornaIscrizione);
    isc('privacy').addEventListener('change', aggiornaIscrizione);
  }
  azionePrincipale = inviaIscrizione;
  aggiornaIscrizione();
  window.scrollTo(0, 0);
}

function iscrizioneCompleta() {
  return CAMPI_ISCRIZIONE.every(k => FACOLTATIVI.has(k) || isc(k).value.trim()) &&
    /^[A-Za-z0-9]{16}$/.test(isc('codice_fiscale').value.trim()) && isc('privacy').checked;
}

function aggiornaIscrizione() {
  pulsantePrincipale('Invia la richiesta', iscrizioneCompleta());
}

async function inviaIscrizione() {
  if (!iscrizioneCompleta()) return;
  const valori = Object.fromEntries(CAMPI_ISCRIZIONE.map(k => [k, isc(k).value.trim()]));
  attesaAzione(true);
  try {
    const { richiesta } = await chiama('iscrizione', { valori, privacy: true });
    el('pannello-iscrizione').hidden = true;
    attesaTesseramento({ richiesta, quota: quotaIscrizione });
  } catch (err) {
    lamenta(err.message);
  } finally {
    attesaAzione(false);
  }
}

// In attesa del direttivo si vede solo questo: la tessera che sta per
// nascere, e come pagare.
function attesaTesseramento(iscrizione) {
  for (const p of ['registrazione', 'iscrizione']) el(`pannello-${p}`).hidden = true;
  el('pannello-tessera').hidden = false;
  document.body.classList.add('senza-menu');
  nascondiAzione();
  const r = iscrizione.richiesta;
  el('tessera').className = '';
  el('tessera').innerHTML = `
    <div class="tessera-carta da-rinnovare">
      <div class="tessera-testa"><span>Crocevia dei Mondi</span><span>${new Date().getFullYear()}</span></div>
      <div class="tessera-piede">
        <div class="tessera-nome">${esc(`${r.nome} ${r.cognome}`)}</div>
        <div class="tessera-dati">Tesseramento in attesa · ${euro(iscrizione.quota)} da pagare in sede</div>
      </div>
    </div>
    <p>Richiesta inviata al direttivo. Il primo tesseramento si fa in sede: passa alla
      prossima apertura e paga lì la quota. Quando il direttivo la registra la tessera
      si attiva, e te lo scrivo in chat.</p>`;
}
