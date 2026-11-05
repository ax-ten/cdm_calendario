// L'avvio: mostra (le pagine), indietro, avvia e gli ascoltatori globali.
// Va caricato per ultimo: in fondo chiama avvia().

// ------------------------------------------------------------------ avvio
const PANNELLI = ['prenota', 'mie', 'inventario', 'aggiungi', 'prestiti', 'tessera', 'ricevute', 'gestione', 'serie', 'quote', 'quota', 'incassi'];

// I caricamenti di ogni pagina: lasciandola, le risposte in viaggio non
// valgono piu'.
const GIRI_PAGINA = { mie: ['mie'], gestione: ['gestione'], serie: ['serie'], prestiti: ['prestiti'],
  tessera: ['tessera'], quote: ['quote', 'pagamenti'], quota: ['quota'], incassi: ['incassi'] };

function mostra(quale) {
  chiudiMenuRiga();
  chiudiFoglio();
  fermaScanner();
  if (scorriAperta) apriScorri(scorriAperta, false);
  for (const [pagina, chiavi] of Object.entries(GIRI_PAGINA)) {
    if (pagina !== quale) chiavi.forEach(nuovoGiro);
  }
  if (quale !== 'prenota') stato.spostando = null;
  for (const p of PANNELLI) el(`pannello-${p}`).hidden = p !== quale;
  // "Presta a un’altra persona…" e' del bene scelto in biblioteca: cambiando scheda
  // se ne va, e il pulsante grande torna da solo a tutta larghezza.
  el('azione-a-nome').hidden = true;
  document.body.classList.remove('due-azioni');
  const scheda = quale === 'aggiungi' || quale === 'prestiti' ? 'inventario'
    : ['mie', 'gestione', 'serie'].includes(quale) ? 'prenota'
    : ['ricevute', 'quote', 'quota', 'incassi'].includes(quale) ? 'tessera' : quale;
  for (const t of ['prenota', 'inventario', 'tessera']) {
    el(`tab-${t}`).setAttribute('aria-selected', String(t === scheda));
  }
  // La freccia di Telegram, in alto, c'e' quando c'e' un posto dove tornare.
  const siTorna = ['aggiungi', 'prestiti', 'prenota', 'ricevute', 'gestione', 'serie', 'quote', 'quota', 'incassi'].includes(quale);
  if (siTorna) tg?.BackButton?.show(); else tg?.BackButton?.hide();
  document.body.classList.toggle('in-passi', quale === 'prenota' || quale === 'aggiungi');
  azionePrincipale = quale === 'prenota' ? azionePrenota
    : quale === 'mie' ? nuovaPrenotazione
    : quale === 'inventario' ? prendiScelto : null;
  if (quale === 'prenota') { nascondiAzione(); abilita(stato.prenotabile); }
  else if (quale === 'mie') {
    pulsanteTondo('piu', 'Nuova attività', !stato.bloccato && !stato.senzaTessera, 'Crea');
    // "Crea" c'e' finche' c'e' posto: se ne va solo quando l'elenco
    // arriverebbe sotto la scritta (lo misura aggiornaEtichette).
    el('azione').classList.add('con-etichetta');
  }
  else nascondiAzione();
  if (quale === 'mie') {
    // Appena vista e senza modifiche nel frattempo: l'elenco e' ancora quello.
    if (!eFresco('mie') || el('elenco-mie').className === 'vuoto') caricaMie();
    controllaChiavi();
  }
  if (quale === 'inventario') apriInventario();
  if (quale === 'tessera') {
    if (eFresco('tessera') && tess.dati && el('tessera').querySelector('#dettaglio-pagamento')) disegnaPagamento();
    else caricaTessera();
  }
  if (quale === 'gestione') caricaGestione();
  if (quale === 'quote') {
    caricaQuote();
    azionePrincipale = apriIncassi;
    pulsanteTondo('piu', 'Segna pagamenti', true, 'Segna pagamenti');
    el('azione').classList.add('con-etichetta');
  }
}

async function avvia() {
  let info;
  try {
    info = await chiama('stato');
  } catch (err) {
    const avviso = document.createElement('div');
    erroreCarico(avviso, err, () => location.reload());
    document.body.replaceChildren(avviso);
    return;
  }
  if (!info.socio) return mostraRegistrazione(info.registrazione);

  stato.limiti = info.limiti;
  stato.sediInfo = info.sedi;
  stato.categorieInfo = info.categorie || [];
  stato.daOra = 18;
  stato.aOra = 21;

  el('sedi').innerHTML = html`${info.sedi.map(s => html`
    <button data-slug="${s.slug}" aria-pressed="false">
      <span>${s.nome}</span>
      ${s.indirizzo ? html`<small>${s.indirizzo}</small>` : ''}
    </button>`)}`;
  el('sedi').querySelectorAll('button').forEach(b => {
    b.onclick = async () => {
      stato.sede = b.dataset.slug;
      el('sedi').querySelectorAll('button')
        .forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      await caricaMese();
      if (stato.giorno) await scegliGiorno(stato.giorno);
      else aggiornaEsito();
      if (stato.passo === 1) vaiAPasso(2);
    };
  });

  // La vetrina e' del direttivo: agli altri il campo non si mostra affatto,
  // invece di mostrarlo spento senza spiegare perche'.
  el('campo-vetrina').hidden = !info.direttivo;

  // Colore e icona non passano dall'HTML: il colore va nello stile solo se
  // e' davvero un colore, l'icona solo se e' un indirizzo http(s) o della
  // nostra pagina, e se non si carica si nasconde.
  el('categorie').innerHTML = html`${(info.categorie || []).map(c => html`
    <button class="categoria" data-slug="${c.slug}" aria-pressed="false">
      <span class="tinta"></span>
      <img alt="">
      <span class="nome">${c.nome}</span>
    </button>`)}`;
  el('categorie').querySelectorAll('.categoria').forEach((b, i) => {
    const c = info.categorie[i];
    if (c.colore && CSS.supports('color', String(c.colore))) b.style.setProperty('--tinta', String(c.colore));
    const img = b.querySelector('img');
    // Senza icona l'immagine non occupa posto: restava un quadrato vuoto
    // fra la striscia di colore e il nome.
    const senza = () => { img.style.visibility = 'hidden'; img.style.display = 'none'; };
    img.addEventListener('error', senza);
    let src = null;
    try { src = c.icona ? new URL(String(c.icona), location.href) : null; } catch {}
    if (src && ['https:', 'http:'].includes(src.protocol) || src?.protocol === location.protocol) img.src = src.href;
    else senza();
  });
  // Che nome ci vada non e' la stessa domanda per una campagna di ruolo e per
  // una serata di giochi da tavolo: l'esempio nel campo cambia con la
  // categoria, e i testi stanno in categorie.txt insieme al resto.
  stato.esempi = Object.fromEntries(
    (info.categorie || []).filter(c => c.esempio).map(c => [c.slug, c.esempio]));

  el('categorie').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      stato.categoria = b.dataset.slug;
      el('categorie').querySelectorAll('button')
        .forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      el('titolo').placeholder = stato.esempi[stato.categoria] || ESEMPIO_GENERICO;
      aggiornaEsito();
    };
  });

  const oggi = new Date();
  stato.mese = { anno: oggi.getFullYear(), mese: oggi.getMonth() + 1 };
  el('mese-prima').onclick = () => cambiaMese(-1);
  el('mese-dopo').onclick = () => cambiaMese(1);
  disegnaCalendario();

  disegnaFascia();
  trascina(el('maniglia-inizio'), 'inizio');
  trascina(el('maniglia-fine'), 'fine');

  el('note').addEventListener('input', contaDescrizione);
  el('titolo').addEventListener('input', aggiornaEsito);
  el('titolo').addEventListener('input', aggiornaSerie);
  el('titolo').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); el('titolo').blur(); avanti(); }
  });
  el('vetrina').addEventListener('change', async () => {
    // L'elenco si chiede solo a chi accende la spunta: per tutti gli altri
    // sarebbe un giro su Google che non serve a niente.
    if (el('vetrina').checked) await caricaSerie();
    sincronizzaVetrina();
  });

  el('fissa').addEventListener('change', aggiornaCadenza);
  el('cadenze').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      stato.ricorrenza = b.dataset.ricorrenza;
      aggiornaCadenza();
    };
  });

  el('tab-prenota').onclick = () => mostra('mie');
  el('passo-indietro').onclick = indietro;
  el('tab-inventario').onclick = () => mostra('inventario');
  el('tab-tessera').hidden = !DEBUG;
  el('tab-tessera').onclick = () => mostra('tessera');
  // Le quote di tuttɜ le vede il direttivo, o chi ha la spunta in Odoo.
  el('apri-quote').hidden = !info.tessere;
  // Ogni volta l'elenco si rilegge: nel frattempo qualcunə puo' aver pagato.
  el('apri-quote').onclick = () => { quo.soci = null; mostra('quote'); };
  el('chiudi-quote').onclick = () => mostra('tessera');
  el('chiudi-quota').onclick = () => mostra('quote');
  el('chiudi-incassi').onclick = () => mostra('quote');
  collegaQuote();
  tg?.BackButton?.onClick(indietro);

  stato.bloccato = Boolean(info.bloccato);
  stato.ruolo = info.direttivo ? 'direttivo' : info.staff ? 'staff' : null;
  // Odoo dice tesserato sulla scheda; se non lo dice, non si blocca nessuno.
  stato.senzaTessera = info.socio?.tesserato === false;
  // Le prenotazioni di tutti le vede lo staff: gruppi staff o direttivo.
  el('apri-gestione').hidden = !(info.staff || info.direttivo);
  el('apri-gestione').onclick = () => mostra('gestione');
  el('chiudi-gestione').onclick = () => mostra('mie');
  el('chiudi-serie').onclick = () => mostra('gestione');
  if (info.bloccato) {
    el('pannello-prenota').querySelectorAll('input, textarea, button')
      .forEach(n => n.disabled = true);
  }
  aggiornaEsito();
  vaiAPasso(1);
  mostra(paginaIniziale());
}

// Si puo' aprire l'app direttamente su una pagina: dal link
// t.me/<bot>/<app>?startapp=biblioteca (arriva come start_param), o dal
// pulsante di un messaggio con l'indirizzo .../prenota/?pagina=biblioteca.
// "biblioteca_libri", "biblioteca_gdt", "biblioteca_gdr", "biblioteca_altro"
// e "biblioteca_tutto" aprono anche gia' su quella categoria.
function paginaIniziale() {
  if (DEBUG) return 'tessera';
  const chiesta = String(tg?.initDataUnsafe?.start_param ||
    new URLSearchParams(location.search).get('pagina') || '').toLowerCase();
  const [pagina, ...resto] = chiesta.split(/[_-]/);
  if (pagina !== 'biblioteca') return 'mie';
  // Dopo "biblioteca" un tipo (libri, gdt, gdr, altro, tutto) e/o una sede
  // (barletta, trani): biblioteca_trani apre gia' filtrata su Trani.
  const tipi = { libri: 'libri', gdt: 'giochi', giochi: 'giochi', gdr: 'gdr', altro: 'altro', tutto: 'tutto' };
  for (const parola of resto) {
    if (tipi[parola]) inv.tipoIniziale = tipi[parola];
    else if (parola) inv.sedeIniziale = parola;
  }
  return 'inventario';
}

function cambiaMese(passo) {
  let { anno, mese } = stato.mese;
  mese += passo;
  if (mese < 1) { mese = 12; anno--; }
  if (mese > 12) { mese = 1; anno++; }
  stato.mese = { anno, mese };
  if (stato.sede) caricaMese();
  else disegnaCalendario();
}

// La tastiera si apre quando si scrive in un campo di testo, e solo sul
// telefono: al computer il menu resta dov'e'. Passando da un campo all'altro
// la tastiera non si chiude, quindi si aspetta un attimo prima di dirlo.
const CAMPI_TESTO = 'input[type="text"], input[type="search"], input[type="number"], input[type="email"], ' +
  'input[type="tel"], input[type="date"], input:not([type]), textarea';
if (window.matchMedia?.('(pointer: coarse)').matches) {
  let chiusa;
  document.addEventListener('focusin', (e) => {
    if (!e.target.matches?.(CAMPI_TESTO)) return;
    clearTimeout(chiusa);
    document.body.classList.add('tastiera');
  });
  document.addEventListener('focusout', (e) => {
    if (!e.target.matches?.(CAMPI_TESTO)) return;
    chiusa = setTimeout(() => {
      if (!document.activeElement?.matches?.(CAMPI_TESTO)) document.body.classList.remove('tastiera');
    }, 100);
  });
}

// Lo spazio in fondo e le scritte dei tondi si rimisurano da soli: quando si
// disegna o si nasconde qualcosa, quando i pulsanti in fondo cambiano, e
// quando cambia la finestra (anche la tastiera che si apre).
new MutationObserver(chiediFondo).observe(document.body,
  { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
new MutationObserver(chiediFondo).observe(document.body, { attributes: true, attributeFilter: ['class'] });
for (const n of document.querySelectorAll(GALLEGGIANTI)) {
  new MutationObserver(chiediFondo).observe(n, { attributes: true, attributeFilter: ['class', 'style'] });
}
addEventListener('resize', chiediFondo);

avvia();
