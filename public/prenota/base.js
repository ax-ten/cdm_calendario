// Le basi, caricate per prime: Telegram, tema, stato, el/esc/html, giri e
// dati freschi, chiama (le richieste al server), toast e conferme.

// Gli errori della pagina vanno al server, che li dice al direttivo: un
// pulsante che non risponde non deve restare un segreto di chi lo preme.
// Ognuno una volta sola per apertura dell'app.
(() => {
  const mandati = new Set();
  const manda = (messaggio, dove) => {
    const chiave = `${messaggio}|${dove}`;
    if (!messaggio || mandati.has(chiave) || mandati.size > 10) return;
    mandati.add(chiave);
    fetch('/prenota/api/errore-pagina', {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaggio: String(messaggio).slice(0, 300), dove }),
    }).catch(() => {});
  };
  window.addEventListener('error', (e) => {
    // Script di altri (quello di Telegram) danno solo "Script error.": non
    // dicono niente, e non sono nostri.
    if (!e.filename || !e.filename.includes('/prenota/')) return;
    manda(e.message, `${(e.filename || '').split('/').pop() || 'pagina'} riga ${e.lineno}:${e.colno}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    manda(r?.message || String(r), (r?.stack || '').split('\n')[1]?.trim().slice(0, 120) || '');
  });
})();

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

// ---- tema chiaro o scuro
// I colori li da' Telegram (o, fuori, il telefono); gli stati (verde, giallo,
// rosso) e le stelline invece sono nostri, e vanno scuriti sul chiaro. Si
// guarda lo sfondo vero, non tg.colorScheme: e' lo sfondo che decide cosa si
// legge, anche con un tema fatto a mano. Si riguarda quando Telegram cambia
// tema o il telefono passa da chiaro a scuro.
function aggiornaTema() {
  const m = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g);
  if (!m) return;
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const luce = 0.2126 * lin(+m[0]) + 0.7152 * lin(+m[1]) + 0.0722 * lin(+m[2]);
  document.documentElement.classList.toggle('tema-chiaro', luce > 0.4);
}
aggiornaTema();
tg?.onEvent?.('themeChanged', aggiornaTema);
window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', aggiornaTema);

// Le cose ancora in prova (la tessera, il tesseramento dall'app) si vedono
// solo aprendo l'app dal link t.me/<bot>/<app>?startapp=debug. Il server
// lo controlla da se', sull'initData firmato.
const DEBUG = String(tg?.initDataUnsafe?.start_param || '').toLowerCase() === 'debug';

const MESI = ['gennaio','febbraio','marzo','aprile','maggio','giugno',
              'luglio','agosto','settembre','ottobre','novembre','dicembre'];
const GIORNI = ['lun','mar','mer','gio','ven','sab','dom'];

const stato = {
  limiti: null,
  sede: null,
  categoria: null,
  giorno: null,          // "YYYY-MM-DD"
  daOra: 18, aOra: 21,
  mese: null,            // {anno, mese}
  occupazione: {},       // per sede+mese, dal server
  serie: null,           // le serie gia' in vetrina, lette alla prima spunta
  esempi: {},            // slug categoria -> testo grigio del campo del nome
  ricorrenza: 'settimanale',
  prenotabile: false,
};

const CADENZE = {
  settimanale: 'ogni settimana',
  quindicinale: 'ogni due settimane',
  mensile: 'una volta al mese',
  giornoFisso: 'ogni mese, sempre lo stesso giorno',
};

// "il 17", ma "l'1", "l'8", "l'11".
const articoloGiorno = (n) => [1, 8, 11].includes(n) ? `l’${n}` : `il ${n}`;

// Prima di scegliere una categoria non si sa che esempio dare, quindi si
// danno i due estremi.
// Corto: sta intero nel campo anche a 320px.
const ESEMPIO_GENERICO = 'Es. Campagna di D&D, torneo di Mario Kart';

const el = (id) => document.getElementById(id);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

// Titoli, nomi e note li scrivono le persone (o chi amministra Odoo):
// finiscono nella pagina come testo, mai come HTML.
const esc = (t) => String(t ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// html`...`: come una stringa fra apici inversi, ma quello che ci finisce
// dentro con ${} e' testo, gia' passato da esc(). Un pezzo di HTML nostro
// (un'icona, un altro html`...`) si mette con raw(), o e' gia' sicuro.
// Le liste si mettono intere: i pezzi si uniscono da soli.
class PezzoHtml {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
const raw = (s) => new PezzoHtml(String(s ?? ''));
const dentroHtml = (v) => v instanceof PezzoHtml ? v.s
  : Array.isArray(v) ? v.map(dentroHtml).join('')
  : v === null || v === undefined || v === false ? '' : esc(v);
const html = (pezzi, ...valori) =>
  new PezzoHtml(pezzi.reduce((tutto, p, i) => tutto + dentroHtml(valori[i - 1]) + p));

// Un pezzo di pagina rifatto da capo perde il fuoco e quello che si stava
// scrivendo. Qui si ricorda chi aveva il fuoco (per id, o per il suo primo
// attributo data-) e cosa c'era nei campi di testo con un id; rifatto il
// pezzo, i campi rimasti vuoti si riempiono e il fuoco torna dov'era.
function chiaveNodo(n) {
  if (n.id) return `#${CSS.escape(n.id)}`;
  const a = [...n.attributes].find(x => x.name.startsWith('data-'));
  return a ? `[${a.name}="${CSS.escape(a.value)}"]` : null;
}

function ridisegnaTenendo(dove, ridisegna) {
  const attivo = dove.contains(document.activeElement) ? document.activeElement : null;
  const chiave = attivo && chiaveNodo(attivo);
  const scritti = [...dove.querySelectorAll('input[id]:not([type="date"]):not([type="checkbox"]), textarea[id]')]
    .map(c => ({ id: c.id, valore: c.value, sel: c === attivo ? [c.selectionStart, c.selectionEnd] : null }));
  ridisegna();
  for (const { id, valore } of scritti) {
    const c = dove.querySelector(`#${CSS.escape(id)}`);
    if (c && !c.value && valore) c.value = valore;
  }
  const n = chiave && dove.querySelector(chiave);
  if (!n) return null;
  n.focus({ preventScroll: true });
  const sel = scritti.find(x => x.sel && `#${CSS.escape(x.id)}` === chiave)?.sel;
  if (sel) try { n.setSelectionRange(sel[0], sel[1]); } catch {}
  return n;
}

// ---- risposte vecchie
// Ogni caricamento ha il suo numero di giro: quando la risposta arriva, se
// nel frattempo ne e' partito un altro (o si e' cambiata pagina) non vale
// piu' e non si disegna. Senza, una risposta lenta per una persona poteva
// finire sulla scheda di un'altra.
const giri = {};
const nuovoGiro = (k) => (giri[k] = (giri[k] || 0) + 1);
const giroValido = (k, n) => giri[k] === n;

// ---- dati freschi
// Tornando su una scheda appena vista non si richiede tutto al server:
// per un po' i dati valgono. Qualsiasi modifica (prenotare, pagare,
// prendere un libro...) li fa scadere tutti.
const FRESCO_MS = 45 * 1000;
const fresco = {};
const eFresco = (k) => Date.now() - (fresco[k] || 0) < FRESCO_MS;
const segnaFresco = (k) => { fresco[k] = Date.now(); };
const scadiTutto = () => { for (const k of Object.keys(fresco)) delete fresco[k]; };
// Le chiamate che leggono e basta: tutte le altre cambiano qualcosa.
const SOLO_LETTURA = new Set(['stato', 'mese', 'mie', 'serie', 'tessera', 'inventario/opzioni',
  'inventario/catalogo', 'inventario/admin/soci', 'inventario/admin/prestiti', 'inventario/admin/bene',
  'inventario/isbn', 'inventario/miei', 'tessere/elenco', 'tessere/socio', 'tessere/pagamenti',
  'staff/prenotazioni', 'staff/serie', 'eventi-del-giorno']);

async function chiama(percorso, dati = {}) {
  let risposta;
  try {
    risposta = await fetch(`/prenota/api/${percorso}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...dati, initData: tg?.initData || '' }),
    });
  } catch {
    throw new Error('Non riesco a raggiungere il server: controlla la connessione e riprova.');
  }
  const esito = await risposta.json().catch(() => ({}));
  if (!risposta.ok) throw new Error(esito.errore || 'Qualcosa non ha funzionato, riprova.');
  if (!SOLO_LETTURA.has(percorso)) scadiTutto();
  return esito;
}

function oraTesto(h) {
  return `${String(Math.floor(h)).padStart(2,'0')}:${h % 1 ? '30' : '00'}`;
}

// ------------------------------------------------------------------ toast
// Due tempi: quando comincia a sparire, e quando e' sparito. Un toast nuovo
// li ferma tutti e due: senza, uno arrivato in quel quarto di secondo veniva
// nascosto dal vecchio.
let toastVia, toastNascosto;
function toast(testo, ok = true) {
  const t = el('toast');
  t.textContent = testo;
  t.classList.toggle('guasto', !ok);
  clearTimeout(toastVia);
  clearTimeout(toastNascosto);
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add('visibile'));
  toastVia = setTimeout(() => {
    t.classList.remove('visibile');
    toastNascosto = setTimeout(() => { t.hidden = true; }, 250);
  }, ok ? 4000 : 6000);
}

// Il toast con "Annulla": dieci secondi per ripensarci, con la barra che si
// accorcia. Se si preme, fa `azione`.
const DURATA_ANNULLA_MS = 10 * 1000;
let annullaVia, annullaParte, annullaNascosto;
function toastAnnulla(testo, azione) {
  const t = el('toast-annulla');
  const barra = t.querySelector('.tempo');
  clearTimeout(annullaParte);
  clearTimeout(annullaNascosto);
  el('toast-annulla-testo').textContent = testo;
  barra.style.transition = 'none';
  barra.style.width = '100%';
  t.hidden = false;
  // Un attimo dopo, non al prossimo fotogramma: se la pagina e' in secondo
  // piano i fotogrammi tardano, e la barra partiva in ritardo.
  void barra.offsetWidth;
  annullaParte = setTimeout(() => {
    barra.style.transition = `width ${DURATA_ANNULLA_MS}ms linear`;
    barra.style.width = '0%';
    t.classList.add('visibile');
  }, 20);
  const chiudi = () => {
    clearTimeout(annullaVia);
    clearTimeout(annullaParte);
    t.classList.remove('visibile');
    clearTimeout(annullaNascosto);
    annullaNascosto = setTimeout(() => { t.hidden = true; }, 250);
  };
  clearTimeout(annullaVia);
  annullaVia = setTimeout(chiudi, DURATA_ANNULLA_MS);
  el('toast-annulla-bottone').onclick = () => { chiudi(); azione(); };
}

// Un elenco che non si e' caricato: il perche', e "Riprova" che rifa' la
// stessa richiesta. Senza, restava solo la frase, e per riprovare bisognava
// cambiare pagina e tornare.
function erroreCarico(dove, err, riprova) {
  dove.className = 'vuoto';
  dove.innerHTML = html`<p class="vuoto-testo">${err.message}</p>
    <button type="button" class="bottone secondario" data-riprova>Riprova</button>`;
  dove.querySelector('[data-riprova]').onclick = riprova;
}

function lamenta(testo) {
  if (tg?.showAlert) tg.showAlert(testo);
  else toast(testo, false);
}

// Una conferma con il pulsante rosso (destructive, in Telegram) che dice
// l'azione, accanto ad Annulla, che lascia perdere. Fuori da Telegram, o con
// un Telegram vecchio, la conferma del browser.
function confermaGrave(domanda, testo, etichetta) {
  return new Promise(ok => {
    try {
      if (tg?.showPopup && tg.isVersionAtLeast?.('6.2')) {
        const titolo = domanda.length > 64 ? domanda.slice(0, 63) + '…' : domanda;
        tg.showPopup({ title: titolo, message: testo || domanda,
          buttons: [{ type: 'cancel' }, { id: 'si', type: 'destructive', text: etichetta }] }, id => ok(id === 'si'));
        return;
      }
    } catch { /* si ripiega sotto */ }
    ok(window.confirm(testo ? `${domanda}\n${testo}` : domanda));
  });
}

// Con `titolo` la conferma ha un titolo, che Telegram scrive in grassetto:
// e' l'unico grassetto che i suoi popup permettono. Il titolo sta in 64
// caratteri. Se il popup non parte (Telegram vecchio, testo troppo lungo) si
// ripiega sul confirm del browser, invece di lasciare il tocco senza effetto.
// Una domanda con due risposte, piu' Annulla: restituisce l'id scelto o
// null. Il popup di Telegram ha al massimo tre pulsanti.
function scegli(titolo, testo, scelte) {
  return new Promise(ok => {
    try {
      if (tg?.showPopup && tg.isVersionAtLeast?.('6.2')) {
        tg.showPopup({ title: titolo.slice(0, 64), message: testo,
          buttons: [...scelte.map(([id, t]) => ({ id, type: 'default', text: t })), { type: 'cancel' }] },
          id => ok(scelte.some(([x]) => x === id) ? id : null));
        return;
      }
    } catch { /* si ripiega sotto */ }
    ok(window.confirm(`${titolo}\n${testo}\n\nOK: ${scelte[0][1]}`) ? scelte[0][0] : null);
  });
}

function conferma(testo, titolo = '') {
  return new Promise(ok => {
    try {
      if (titolo && tg?.showPopup && tg.isVersionAtLeast?.('6.2')) {
        const corto = titolo.length > 64 ? titolo.slice(0, 63) + '…' : titolo;
        tg.showPopup({ title: corto, message: testo,
          buttons: [{ id: 'si', type: 'default', text: 'Conferma' }, { type: 'cancel' }] },
          id => ok(id === 'si'));
      } else if (tg?.showConfirm) {
        tg.showConfirm(titolo ? `${titolo}\n${testo}` : testo, ok);
      } else {
        ok(window.confirm(titolo ? `${titolo}\n${testo}` : testo));
      }
    } catch {
      ok(window.confirm(titolo ? `${titolo}\n${testo}` : testo));
    }
  });
}
