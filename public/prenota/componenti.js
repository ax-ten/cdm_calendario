// I pezzi usati da tutte le pagine: il pulsante d'azione e quelli tondi,
// lo spazio in fondo, le righe da scorrere, il menu della riga, il foglio
// dal basso e il suggerimento (con le note in CloudStorage).

// Il pulsante d'azione, una capsula sopra il menu. Quello di Telegram non
// va: lo disegna Telegram sotto la pagina, cioe' sotto il nostro menu.
// Spento e' grigio, e dice perche'. Cosa fa dipende dalla scheda.
let azionePrincipale = null;
tg?.MainButton?.hide();
el('azione').onclick = () => {
  const b = el('azione');
  if (b.classList.contains('spento')) return toast(cosaManca(), false);
  if (!b.disabled) azionePrincipale?.();
};

function pulsantePrincipale(testo, attivo) {
  const b = el('azione');
  b.classList.remove('spento', 'grave');
  b.classList.remove('freccia');
  b.removeAttribute('aria-label');
  b.textContent = testo;
  b.disabled = !attivo;
  b.hidden = false;
}

// Il pulsante d'azione tondo, in basso a destra: la freccia per andare
// avanti, o il + per crearne una nuova. Icone di Lucide (arrow-right, plus).
const ICONE = {
  freccia: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
  piu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
};

// `scritta` e' la parola accanto al pulsante, come quelle della biblioteca:
// si vede solo con la classe con-etichetta.
function pulsanteTondo(icona, etichetta, attivo = true, scritta = '') {
  const b = el('azione');
  b.classList.remove('spento', 'con-etichetta', 'grave');
  b.classList.add('freccia');
  b.setAttribute('aria-label', etichetta);
  b.innerHTML = ICONE[icona] +
    (scritta ? `<span class="etichetta-tondo" aria-hidden="true">${scritta}</span>` : '');
  b.disabled = !attivo;
  b.hidden = false;
}


// ---- quanto occupa il fondo
// Menu, pulsante d'azione, pulsanti tondi e barra dei passi galleggiano
// sopra la pagina. In fondo serve uno spazio alto quanto loro, misurato:
// cambia da pagina a pagina (un tondo o due, la barra larga, la tastiera
// aperta). Si misura dallo stile (bottom e altezza), non dal riquadro sullo
// schermo, che durante l'animazione d'entrata e' rimpicciolito.
const GALLEGGIANTI = 'nav.tab, #azione, #azione-a-nome, .tondo, .avanzamento';
function aggiornaFondo() {
  let alto = 0;
  for (const n of document.querySelectorAll(GALLEGGIANTI)) {
    if (n.hidden || !n.getClientRects().length) continue;
    const s = getComputedStyle(n);
    if (s.position !== 'fixed') continue;
    alto = Math.max(alto, (parseFloat(s.bottom) || 0) + n.offsetHeight);
  }
  document.documentElement.style.setProperty('--ingombro-fondo', `${Math.ceil(alto)}px`);
  aggiornaEtichette();
}

// La scritta accanto a un pulsante tondo ("Crea", "Registro prestiti"...)
// c'e' solo se c'e' posto: se il contenuto della pagina, senza scorrere,
// arriverebbe fin sotto il pulsante, o se c'e' la barra d'azione larga, se
// ne va. Il contenuto si misura dove sta nella pagina, non dove e' adesso
// sullo schermo: scorrendo la scritta non va e viene.
function aggiornaEtichette() {
  const pannello = [...document.querySelectorAll('.pannello')].find(p => !p.hidden);
  let fine = 0;
  for (const n of pannello ? pannello.children : []) {
    if (!n.getClientRects().length || getComputedStyle(n).position === 'fixed') continue;
    fine = Math.max(fine, n.getBoundingClientRect().bottom + scrollY);
  }
  const azione = el('azione');
  // Nella schermata d'errore iniziale il pulsante non c'e'.
  if (!azione) return;
  const barra = !azione.hidden && !azione.classList.contains('freccia');
  for (const b of document.querySelectorAll('.tondo, #azione.freccia')) {
    if (b.hidden || !b.querySelector('.etichetta-tondo') || !b.getClientRects().length) continue;
    const s = getComputedStyle(b);
    const cima = innerHeight - (parseFloat(s.bottom) || 0) - b.offsetHeight;
    b.classList.toggle('etichetta-coperta', (barra && b !== azione) || fine > cima - 6);
  }
}

// Si rimisura quando qualcosa compare o sparisce (un elenco disegnato, un
// pannello aperto, un pulsante nascosto) e quando cambia la finestra: una
// volta per fotogramma al massimo. Non si guardano le classi delle righe:
// durante uno swipe cambiano a ogni movimento, e non spostano niente.
let fondoChiesto = 0;
function chiediFondo() {
  if (!fondoChiesto) fondoChiesto = requestAnimationFrame(() => { fondoChiesto = 0; aggiornaFondo(); });
}

// Lo spazio sopra cui finisce il contenuto utile: sopra quello che galleggia.
function fondoLibero() {
  const alto = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ingombro-fondo')) || 140;
  return innerHeight - alto;
}

function nascondiAzione() {
  el('azione').hidden = true;
  el('azione').classList.remove('grave');
  el('azione-a-nome').hidden = true;
  document.body.classList.remove('due-azioni');
}

// Mentre si aspetta il server il pulsante gira e non si preme due volte.
function attesaAzione(si) {
  const b = el('azione');
  b.setAttribute('aria-busy', String(si));
  if (si) { b.dataset.prima = String(b.disabled); b.disabled = true; }
  else { b.disabled = b.dataset.prima === 'true'; }
}

// ------------------------------------------------------- righe da scorrere
// Le azioni di una riga stanno dietro la riga, da uno o da due lati: verso
// sinistra quelle che tolgono (annulla, elimina), verso destra quelle che
// aggiungono (apro io). Trascinando un po' si aprono i pulsanti; oltre meta'
// riga parte l'azione segnata data-pieno, che si allarga fino a prendere
// tutta la riga. Sotto la riga si vede sempre il colore del pulsante sul
// bordo, anche oltre i pulsanti.
// Il tocco sulla riga fa quello che chiede chi disegna l'elenco (aprire i
// dettagli), o se no apre i pulsanti: chi il gesto non lo conosce non resta
// senza azioni. Col mouse si trascina col tasto sinistro; il destro apre.
// I pulsanti si spostano, non si rifanno: i loro onclick restano quelli
// messi da chi ha disegnato l'elenco, quindi questa si chiama dopo.
const SCORRI_SOGLIA = 8;
const SCORRI_PIENO = 0.6;
let scorriAperta = null;

// Da tastiera il menu della riga si apre con Maiusc+F10 o col tasto menu.
// Lo stesso tasto, in certi browser, manda anche l'evento del tasto destro:
// quello che arriva subito dopo il tasto si ignora, se no si apre e richiude.
let menuDaTastiera = 0;
const tastoMenu = (e) => (e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu';

function scorrevoli(dove, selettore = '.riga', { tocco = null, menu = null, aiuto = null } = {}) {
  dove.querySelectorAll(selettore).forEach(riga => {
    if (riga.parentElement?.classList.contains('scorri')) return;
    const destra = riga.querySelector(':scope > .azioni:not([hidden]):not(.in-vista):not(.sinistra)');
    const sinistra = riga.querySelector(':scope > .azioni.sinistra');
    const lati = {};
    for (const [lato, azioni] of [['destra', destra], ['sinistra', sinistra]]) {
      if (!azioni?.querySelector('button')) continue;
      const strato = document.createElement('div');
      strato.className = `scorri-azioni ${lato}`;
      strato.append(azioni);
      // La scritta sta in una scatola larga quanto il pulsante normale:
      // quando il pulsante si allarga non va a capo in un altro modo.
      azioni.querySelectorAll('button').forEach(b => {
        const scritta = document.createElement('span');
        scritta.className = 'scritta-azione';
        scritta.append(...b.childNodes);
        b.append(scritta);
      });
      lati[lato] = strato;
    }
    if (!lati.destra && !lati.sinistra) {
      if (tocco) collegaSoloTocco(riga, tocco, menu);
      return;
    }
    const scatola = document.createElement('div');
    scatola.className = 'scorri';
    riga.replaceWith(scatola);
    scatola.append(...Object.values(lati), riga);
    riga.tabIndex = 0;
    descriviRiga(riga, aiuto || (tocco ? 'Tocca per i dettagli.' : 'Tocca per le azioni.'));
    collegaScorri(scatola, riga, lati, tocco, menu);
  });
  suggerisciScorri(dove);
}

// Per il lettore di schermo: una riga senza altri controlli dentro e' un
// pulsante, e dice se ha le azioni aperte; con dentro altri pulsanti (la
// chat, "Apro io") e' un gruppo, perche' un pulsante dentro un pulsante non
// si puo' usare. Le schede dei beni sono gia' pulsanti.
function descriviRiga(riga, aiuto) {
  if (!riga.hasAttribute('role')) {
    const altri = [...riga.querySelectorAll('button, a, input, select, textarea')].some(n => !n.closest('[hidden]'));
    riga.setAttribute('role', altri ? 'group' : 'button');
  }
  if (riga.getAttribute('role') === 'button') riga.setAttribute('aria-expanded', 'false');
  riga.setAttribute('aria-label', `${riga.textContent.trim().replace(/\s+/g, ' ')}. ${aiuto}`);
}

function segnaAperta(riga, si) {
  if (riga.getAttribute('role') === 'button') riga.setAttribute('aria-expanded', String(si));
}

function collegaSoloTocco(riga, tocco, menu = null) {
  riga.tabIndex = 0;
  riga.classList.add('toccabile');
  riga.onclick = (e) => { if (!e.target.closest('button, input, a, label, select, textarea')) tocco(riga); };
  riga.onkeydown = (e) => {
    if (e.target !== riga) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tocco(riga); }
    else if (tastoMenu(e)) { e.preventDefault(); menuDaTastiera = performance.now(); (menu || tocco)(riga); }
  };
}

// Il pulsante accanto alla riga (il primo che si scopre): e' lui che si
// allarga oltre i pulsanti, ed e' il suo colore che sta sotto gli angoli
// tondi della riga, cosi' non resta nessun ritaglio.
function accanto(strato, lato) {
  const bottoni = [...strato.querySelectorAll('button')].filter(b => !b.hidden);
  return lato === 'destra' ? bottoni[0] : bottoni[bottoni.length - 1];
}

function coloreLato(scatola, lato) {
  const strato = scatola.querySelector(`:scope > .scorri-azioni.${lato}`);
  const b = strato && accanto(strato, lato);
  return b ? getComputedStyle(b).backgroundColor : '';
}

// Il colore del pulsante accanto si allunga un poco sotto la riga (lo
// strato ha un ::before): copre gli angoli tondi dal lato che si apre, e
// solo quelli. Uno sfondo dietro tutta la riga si vedrebbe come un filo
// colorato anche lungo gli angoli dell'altro lato.
function mostraLato(scatola, lato, colore = null) {
  if (lato) {
    scatola.dataset.lato = lato;
    const strato = scatola.querySelector(`:scope > .scorri-azioni.${lato}`);
    if (strato) strato.style.setProperty('--colore-accanto', colore ?? coloreLato(scatola, lato));
  } else {
    delete scatola.dataset.lato;
  }
}

// lato: 'destra' (pulsanti a destra, la riga va a sinistra), 'sinistra', o
// false per chiudere. true vale 'destra'.
function apriScorri(scatola, lato) {
  if (lato === true) lato = scatola.querySelector(':scope > .scorri-azioni.destra') ? 'destra' : 'sinistra';
  if (!lato) chiudiPieno(scatola);
  const riga = scatola.querySelector(':scope > :not(.scorri-azioni)');
  const strato = lato && scatola.querySelector(`:scope > .scorri-azioni.${lato}`);
  if (lato && !strato) lato = false;
  scatola.classList.remove('trascina');
  const larga = strato ? strato.offsetWidth : 0;
  riga.style.transform = lato === 'destra' ? `translateX(${-larga}px)` : lato === 'sinistra' ? `translateX(${larga}px)` : '';
  segnaAperta(riga, Boolean(lato));
  if (lato) mostraLato(scatola, lato);
  else {
    // Il colore se ne va quando la riga e' tornata, non prima.
    setTimeout(() => { if (!scatola._lato) mostraLato(scatola, null); }, 300);
  }
  scatola._lato = lato || null;
  if (lato && scorriAperta && scorriAperta !== scatola) apriScorri(scorriAperta, false);
  scorriAperta = lato ? scatola : (scorriAperta === scatola ? null : scorriAperta);
}

function chiudiScorri(dentro) {
  const scatola = dentro?.closest?.('.scorri');
  if (scatola) apriScorri(scatola, false);
}

function chiudiPieno(scatola) {
  scatola.querySelectorAll(':scope > .scorri-azioni').forEach(s => {
    s.classList.remove('oltre', 'piena');
    s.style.width = '';
    s.querySelectorAll('.cresce').forEach(b => b.classList.remove('cresce'));
    s.querySelectorAll('.scritta-azione').forEach(t => { t.style.transform = ''; });
  });
}

// Il trascinamento. Tutto quello che va misurato (larghezze, il pulsante
// accanto, i colori) si misura quando il dito si appoggia; mentre si muove
// si fanno solo conti, e la pagina si tocca una volta per fotogramma, e
// solo dove cambia qualcosa. Prima ogni movimento misurava e riscriveva
// tutto, e il telefono ricalcolava la pagina a ogni pixel.
function collegaScorri(scatola, riga, lati, tocco, menu) {
  let inizio = null;
  let trascinato = false;
  let fotogramma = 0;
  // Com'e' adesso la pagina, per cambiare solo quello che cambia.
  let visto = null;
  const vuoto = (lato = null) => ({ strato: null, lato, oltre: false, piena: false, cresce: null, larghezza: '', scala: '' });

  const azzera = () => {
    const s = visto.strato;
    if (s) {
      s.classList.remove('oltre', 'piena');
      s.style.width = '';
    }
    if (visto.cresce) {
      visto.cresce.classList.remove('cresce');
      const t = visto.cresce.querySelector('.scritta-azione');
      if (t) t.style.transform = '';
    }
    visto = vuoto(visto.lato);
  };

  const applica = () => {
    fotogramma = 0;
    const v = inizio?.vuoi;
    if (!v) return;
    riga.style.transform = `translateX(${v.x}px)`;
    const strato = v.lato ? lati[v.lato] : null;
    if (visto.strato !== strato) azzera();
    if (strato) {
      if (visto.oltre !== v.oltre) strato.classList.toggle('oltre', v.oltre);
      if (visto.piena !== v.piena) strato.classList.toggle('piena', v.piena);
      if (visto.larghezza !== v.larghezza) strato.style.width = v.larghezza;
      if (visto.cresce !== v.cresce) {
        if (visto.cresce) {
          visto.cresce.classList.remove('cresce');
          const t = visto.cresce.querySelector('.scritta-azione');
          if (t) t.style.transform = '';
        }
        v.cresce?.classList.add('cresce');
      }
      if (v.cresce && (visto.cresce !== v.cresce || visto.scala !== v.scala)) {
        const t = v.cresce.querySelector('.scritta-azione');
        if (t) t.style.transform = v.scala;
      }
    }
    if (visto.lato !== v.lato) mostraLato(scatola, v.lato, v.lato ? inizio.lati[v.lato].colore : null);
    visto = { strato, lato: v.lato, oltre: v.oltre, piena: v.piena, cresce: v.cresce, larghezza: v.larghezza, scala: v.scala };
  };

  riga.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest('button, input, a, label, select, textarea')) return;
    const misure = {};
    for (const [lato, strato] of Object.entries(lati)) {
      const vicino = accanto(strato, lato);
      misure[lato] = { larga: strato.offsetWidth, pieno: strato.querySelector('[data-pieno]'), vicino,
                       colore: vicino ? getComputedStyle(vicino).backgroundColor : '' };
    }
    const larga = (lato) => misure[lato]?.larga || 0;
    const base = scatola._lato === 'destra' ? -larga('destra') : scatola._lato === 'sinistra' ? larga('sinistra') : 0;
    inizio = { x: e.clientX, y: e.clientY, base, lati: misure, tutta: riga.offsetWidth, verso: null,
               t: e.timeStamp, id: e.pointerId, ultimo: 0, vuoi: null };
    trascinato = false;
  });
  riga.addEventListener('pointermove', (e) => {
    if (!inizio || e.pointerId !== inizio.id) return;
    const dx = e.clientX - inizio.x;
    const dy = e.clientY - inizio.y;
    if (!inizio.verso) {
      if (Math.abs(dx) < SCORRI_SOGLIA && Math.abs(dy) < SCORRI_SOGLIA) return;
      inizio.verso = Math.abs(dx) > Math.abs(dy) ? 'orizzontale' : 'verticale';
      if (inizio.verso === 'verticale') { inizio = null; return; }
      riga.setPointerCapture?.(e.pointerId);
      scatola.classList.add('trascina');
      if (scorriAperta && scorriAperta !== scatola) apriScorri(scorriAperta, false);
      // Una volta sola per gesto: si parte puliti (anche da uno swipe
      // completo rimasto aperto).
      chiudiPieno(scatola);
      visto = vuoto(scatola.dataset.lato || null);
    }
    trascinato = true;
    let x = inizio.base + dx;
    const lato = x < 0 ? 'destra' : x > 0 ? 'sinistra' : null;
    const info = lato ? inizio.lati[lato] : null;
    const larga = info ? info.larga : 0;
    // Un lato senza pulsanti fa solo un po' di resistenza. Con i pulsanti si
    // va avanti libero fino al limite (oltre la soglia dello swipe completo),
    // dove la scritta e' stirata al massimo; da li' in poi la riga fa da
    // elastico e torna quando si lascia.
    const limite = Math.max(larga, inizio.tutta * SCORRI_PIENO) + 50;
    if (lato && !info) x = x / 4;
    else if (lato && Math.abs(x) > limite) x = Math.sign(x) * (limite + (Math.abs(x) - limite) / 4);
    x = Math.max(-inizio.tutta, Math.min(inizio.tutta, x));
    inizio.ultimo = x;
    // Oltre i pulsanti lo strato segue la riga: si allarga l'azione piena
    // se c'e', se no quella accanto. A meta' riga resta solo la piena.
    const oltre = Boolean(info) && Math.abs(x) > larga;
    const cresce = oltre ? (info.pieno || info.vicino || null) : null;
    // La scritta si allarga con lo swipe: le lettere si stirano in
    // larghezza, le righe restano quelle. Al limite e' un quarto piu' larga,
    // e li' si ferma, come la riga.
    const quanto = oltre ? Math.min(1, Math.max(0, (Math.abs(x) - larga) / (limite - larga))) : 0;
    inizio.vuoi = {
      x, lato: info ? lato : null, oltre,
      piena: oltre && Boolean(info.pieno) && Math.abs(x) > inizio.tutta * SCORRI_PIENO,
      cresce, larghezza: oltre ? `${Math.abs(x)}px` : '', scala: cresce ? `scaleX(${1 + 0.25 * quanto})` : '',
    };
    if (!fotogramma) fotogramma = requestAnimationFrame(applica);
  });
  const fine = (e) => {
    if (!inizio || e.pointerId !== inizio.id) return;
    // L'ultimo movimento, se il fotogramma non e' ancora passato.
    if (fotogramma) { cancelAnimationFrame(fotogramma); applica(); }
    const x = inizio.ultimo;
    const lato = x < 0 ? 'destra' : x > 0 ? 'sinistra' : null;
    const strato = lato && lati[lato];
    // Chi ascolta il click della riga (la scelta di un bene) sa che era
    // uno swipe e non un tocco.
    if (trascinato) { riga.dataset.appenaScorsa = '1'; setTimeout(() => delete riga.dataset.appenaScorsa, 0); }
    if (trascinato && strato && visto?.strato === strato && visto.piena) {
      // Swipe completo: la riga resta aperta del tutto, con l'azione piena
      // in vista, e l'azione parte (chiede conferma da se'). Se va a buon
      // fine la riga se ne va; se no si richiude con un tocco, sulla riga o
      // fuori.
      const pieno = strato.querySelector('[data-pieno]');
      const tutta = inizio.tutta;
      scatola.classList.remove('trascina');
      strato.style.width = `${tutta}px`;
      riga.style.transform = `translateX(${lato === 'destra' ? -tutta : tutta}px)`;
      if (scorriAperta && scorriAperta !== scatola) apriScorri(scorriAperta, false);
      scatola._lato = lato;
      scorriAperta = scatola;
      segnaAperta(riga, true);
      mostraLato(scatola, lato, inizio.lati[lato].colore);
      inizio = null;
      setTimeout(() => pieno?.click(), 200);
      return;
    }
    if (trascinato) chiudiPieno(scatola);
    if (trascinato) {
      const veloce = Math.abs(e.clientX - inizio.x) / Math.max(1, e.timeStamp - inizio.t) > 0.5;
      const apri = strato && (veloce || Math.abs(x) > inizio.lati[lato].larga / 2) ? lato : false;
      apriScorri(scatola, apri);
      if (apri) scorriImparato();
    }
    inizio = null;
  };
  riga.addEventListener('pointerup', fine);
  riga.addEventListener('pointercancel', () => {
    if (!inizio) return;
    if (fotogramma) { cancelAnimationFrame(fotogramma); fotogramma = 0; }
    inizio = null;
    chiudiPieno(scatola);
    apriScorri(scatola, scatola._lato || false);
  });
  const tocca = () => {
    if (scatola._lato) return apriScorri(scatola, false);
    if (tocco) return tocco(riga);
    apriScorri(scatola, true);
  };
  // Il menu (o, dove non c'e', i pulsanti) da tasto destro, pressione
  // lunga e tastiera.
  const apriMenu = () => {
    if (menu) { if (scatola._lato) apriScorri(scatola, false); return menu(riga); }
    const apri = !scatola._lato;
    apriScorri(scatola, apri);
    if (apri) scorriImparato();
    return null;
  };
  riga.addEventListener('click', (e) => {
    if (trascinato) { trascinato = false; return; }
    if (e.target.closest('button, input, a, label, select, textarea')) return;
    tocca();
  });
  // Da computer: il tasto destro apre del tutto i pulsanti (o li richiude),
  // al posto del menu del browser. Sul telefono lo stesso evento arriva
  // con la pressione lunga, e fa la stessa cosa.
  riga.addEventListener('contextmenu', (e) => {
    if (e.target.closest('input, textarea, select, a')) return;
    e.preventDefault();
    if (trascinato) return;
    if (performance.now() - menuDaTastiera < 600) return;
    inizio = null;
    // Dove c'e' un menu delle azioni, il tasto destro (o la pressione lunga)
    // apre quello, come il tocco.
    apriMenu();
  });
  // Da tastiera: Invio o spazio come il tocco; Maiusc+F10 (o il tasto menu)
  // apre il menu delle azioni; Esc richiude i pulsanti.
  riga.addEventListener('keydown', (e) => {
    if (e.target !== riga) return;
    if (e.key === 'Escape' && scatola._lato) { e.preventDefault(); apriScorri(scatola, false); return; }
    if (tastoMenu(e)) {
      e.preventDefault();
      menuDaTastiera = performance.now();
      apriMenu();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      tocca();
    } else return;
    if (scatola._lato) scatola.querySelector(`:scope > .scorri-azioni.${scatola._lato} button:not(:disabled)`)?.focus();
  });
}

// Il menu di una riga: una lista che si apre appena sotto la riga toccata,
// con tutte le azioni che ci sono, anche quelle che non stanno nello swipe
// (una per lato). Icone in colonna a sinistra; prima le altre, in fondo,
// separate e in rosso, quelle che tolgono. Se sotto non c'e' spazio, la
// pagina scorre quanto basta e poi il menu si apre. Si chiude toccando
// fuori, scorrendo, con Esc o con Indietro; una voce fa quello che farebbe
// il pulsante della riga.
const svgIcona = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONE_MENU = {   // lucide
  annulla: svgIcona('<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>'),
  elimina: svgIcona('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
  salta: svgIcona('<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>'),
  ricorrente: svgIcona('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
  estendi: svgIcona('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="M12 14v4"/><path d="M10 16h4"/>'),
  restituito: svgIcona('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
  chat: svgIcona('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'),
  chiavi: svgIcona('<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>'),
  modifica: svgIcona('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>'),
};
let menuAperto = null;

function chiudiMenuRiga() {
  if (!menuAperto) return;
  const { lista, velo, riga } = menuAperto;
  // Chi era nel menu (da tastiera) torna sulla riga.
  const dentro = lista.contains(document.activeElement);
  velo.remove();
  lista.remove();
  riga.classList.remove('con-menu');
  menuAperto = null;
  removeEventListener('scroll', chiudiMenuRiga);
  if (dentro && riga.isConnected) riga.focus({ preventScroll: true });
}

async function menuDellaRiga(riga) {
  if (menuAperto) { const stessa = menuAperto.riga === riga; chiudiMenuRiga(); if (stessa) return; }
  const scatola = riga.closest('.scorri') || riga;
  const bottoni = [...scatola.querySelectorAll('.scorri-azioni button, .solo-menu button')];
  if (!bottoni.length) return;
  const altre = bottoni.filter(b => !b.classList.contains('grave'));
  const gravi = bottoni.filter(b => b.classList.contains('grave'));
  const ordinati = [...altre, ...gravi];
  const voce = (b, i) => html`<button type="button" role="menuitem" tabindex="-1" class="voce-menu${b.classList.contains('grave') ? ' grave' : ''}" data-voce-menu="${i}">
      <span class="icona-menu">${raw(ICONE_MENU[b.dataset.icona] || '')}</span>
      <span>${b.dataset.menu || b.querySelector('.scritta-azione')?.textContent || b.textContent.trim()}</span></button>`;
  const lista = document.createElement('div');
  lista.className = 'menu-riga';
  lista.setAttribute('role', 'menu');
  lista.setAttribute('aria-label', 'Azioni');
  lista.innerHTML = altre.map((b, i) => voce(b, i)).join('') +
    (altre.length && gravi.length ? '<div class="separa-menu" role="separator"></div>' : '') +
    gravi.map((b, i) => voce(b, altre.length + i)).join('');
  lista.style.visibility = 'hidden';
  document.body.append(lista);
  const velo = document.createElement('div');
  velo.className = 'velo-menu';
  velo.addEventListener('pointerdown', (e) => { e.preventDefault(); chiudiMenuRiga(); });
  // Il menu e' "aperto" da subito, anche mentre la pagina scorre per fargli
  // posto: un secondo tocco in quel momento lo chiude, invece di aprirne un
  // altro che restava orfano.
  const questo = { lista, velo, riga };
  menuAperto = questo;
  // Quanto spazio serve sotto la riga, sopra quello che galleggia in fondo.
  const fondo = fondoLibero() - 12;
  const manca = riga.getBoundingClientRect().bottom + 6 + lista.offsetHeight - fondo;
  if (manca > 0) {
    scorriDi(manca, 280);
    await new Promise(r => setTimeout(r, 300));
    if (menuAperto !== questo) return;   // chiuso nel frattempo
  }
  const r = riga.getBoundingClientRect();
  const larga = Math.min(260, r.width);
  lista.style.top = `${r.bottom + 6 + scrollY}px`;
  lista.style.left = `${r.right - larga}px`;
  lista.style.width = `${larga}px`;
  lista.style.visibility = '';
  document.body.append(velo);
  riga.classList.add('con-menu');
  setTimeout(() => { if (menuAperto === questo) addEventListener('scroll', chiudiMenuRiga, { once: true }); }, 50);
  const voci = [...lista.querySelectorAll('[data-voce-menu]')];
  voci.forEach(v => {
    v.onclick = () => { chiudiMenuRiga(); ordinati[Number(v.dataset.voceMenu)].click(); };
  });
  // Da tastiera, come i menu del sistema: frecce, Inizio e Fine per
  // muoversi; Esc o Tab chiudono e si torna sulla riga.
  lista.addEventListener('keydown', (e) => {
    const qui = voci.indexOf(document.activeElement);
    const vai = (i) => voci[(i + voci.length) % voci.length]?.focus();
    if (e.key === 'ArrowDown') { e.preventDefault(); vai(qui + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); vai(qui < 0 ? -1 : qui - 1); }
    else if (e.key === 'Home') { e.preventDefault(); vai(0); }
    else if (e.key === 'End') { e.preventDefault(); vai(-1); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); chiudiMenuRiga(); }
  });
  voci[0]?.focus({ preventScroll: true });
}

// Un tocco fuori dalla riga aperta la richiude.
document.addEventListener('pointerdown', (e) => {
  if (scorriAperta && !scorriAperta.contains(e.target)) apriScorri(scorriAperta, false);
});

// ---- il foglio dal basso: dettagli e domande con piu' di due risposte
// Uno solo per volta; si chiude toccando fuori, con Indietro o col tasto
// di Telegram.
// Mentre un foglio e' aperto la tastiera resta dentro (Tab gira fra i suoi
// controlli), Esc lo chiude, e chiuso il fuoco torna dov'era prima.
const FOCUSABILI = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trattieniFuoco(velo, scatola, chiudi) {
  const prima = document.activeElement;
  const tasto = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); chiudi(); return; }
    if (e.key !== 'Tab') return;
    const dentro = [...scatola.querySelectorAll(FOCUSABILI)].filter(n => !n.closest('[hidden]'));
    if (!dentro.length) { e.preventDefault(); scatola.focus(); return; }
    const primo = dentro[0], ultimo = dentro[dentro.length - 1];
    if (e.shiftKey && (document.activeElement === primo || !scatola.contains(document.activeElement))) {
      e.preventDefault(); ultimo.focus();
    } else if (!e.shiftKey && (document.activeElement === ultimo || !scatola.contains(document.activeElement))) {
      e.preventDefault(); primo.focus();
    }
  };
  velo.addEventListener('keydown', tasto);
  return () => {
    velo.removeEventListener('keydown', tasto);
    if (prima?.isConnected && typeof prima.focus === 'function') prima.focus({ preventScroll: true });
  };
}

let rilasciaFoglio = null;
function apriFoglio(contenuto) {
  const velo = el('foglio');
  const scatola = velo.querySelector('.foglio');
  el('foglio-corpo').innerHTML = contenuto;
  // Il titolo del foglio e' il suo nome per il lettore di schermo.
  const titolo = el('foglio-corpo').querySelector('h1, h2');
  if (titolo) { titolo.id = 'foglio-titolo'; scatola.setAttribute('aria-labelledby', 'foglio-titolo'); }
  else scatola.removeAttribute('aria-labelledby');
  scatola.tabIndex = -1;
  const giaAperto = !velo.hidden;
  velo.hidden = false;
  tg?.BackButton?.show();
  if (!giaAperto) { rilasciaFoglio?.(); rilasciaFoglio = trattieniFuoco(velo, scatola, chiudiFoglio); }
  // Il fuoco entra nel foglio (non nel campo: sul telefono aprirebbe la
  // tastiera sopra le domande).
  if (!giaAperto || !scatola.contains(document.activeElement)) scatola.focus({ preventScroll: true });
  return el('foglio-corpo');
}

function chiudiFoglio() {
  if (el('foglio').hidden) return;
  el('foglio').hidden = true;
  el('foglio-corpo').innerHTML = '';
  const rilascia = rilasciaFoglio;
  rilasciaFoglio = null;
  rilascia?.();
}
el('foglio').addEventListener('click', (e) => { if (e.target === el('foglio')) chiudiFoglio(); });

// ---- il suggerimento: la prima riga fa capolino
// Le prime volte, per ogni persona, la prima riga di un elenco si sposta un
// poco a sinistra e torna, e si intravedono le azioni dietro. Smette quando
// la persona ha scorso una riga da se'; se non lo fa mai, dopo le prime
// volte capita ancora ogni tanto, a caso. Una volta per apertura dell'app.
// Il conto sta nel CloudStorage di Telegram, che segue la persona da un
// telefono all'altro; dove non c'e', nel browser.
const SCORRI_CHIAVE = 'suggerimento_scorri';
const SCORRI_PRIME_VOLTE = 3;
const SCORRI_A_CASO = 0.2;
let scorriNota = null;
let scorriSuggerito = false;

// Una piccola memoria per persona: il CloudStorage di Telegram, che la
// segue da un telefono all'altro; dove non c'e', il browser. Se Telegram non
// risponde si va avanti senza: meglio un suggerimento o un pallino in piu'
// che un'app ferma.
const cloudOk = () => Boolean(tg?.CloudStorage && tg.isVersionAtLeast?.('6.9'));
const chiaveLocale = (k) => `${k}:${tg?.initDataUnsafe?.user?.id || ''}`;

function leggiNotaUtente(chiave) {
  return new Promise(ok => {
    try {
      if (cloudOk()) {
        const via = setTimeout(() => ok(null), 1500);
        tg.CloudStorage.getItem(chiave, (err, v) => { clearTimeout(via); ok(err ? null : v || null); });
      } else ok(localStorage.getItem(chiaveLocale(chiave)));
    } catch { ok(null); }
  });
}

function scriviNotaUtente(chiave, testo) {
  try {
    if (cloudOk()) tg.CloudStorage.setItem(chiave, testo, () => {});
    else localStorage.setItem(chiaveLocale(chiave), testo);
  } catch { /* senza memoria si ricomincia: pazienza */ }
}

function leggiNotaScorri() {
  if (scorriNota) return scorriNota;
  const vuota = { fatto: false, viste: 0 };
  scorriNota = leggiNotaUtente(SCORRI_CHIAVE).then(v => {
    try { return { ...vuota, ...JSON.parse(v || '{}') }; } catch { return vuota; }
  });
  return scorriNota;
}

async function scriviNotaScorri(campi) {
  const nota = { ...(await leggiNotaScorri()), ...campi };
  scorriNota = Promise.resolve(nota);
  scriviNotaUtente(SCORRI_CHIAVE, JSON.stringify(nota));
}

function scorriImparato() {
  leggiNotaScorri().then(n => { if (!n.fatto) scriviNotaScorri({ fatto: true }); });
}

async function suggerisciScorri(dove) {
  if (scorriSuggerito) return;
  const prima = dove.querySelector('.scorri > .riga');
  if (!prima) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const nota = await leggiNotaScorri();
  if (nota.fatto || scorriSuggerito) return;
  if (nota.viste >= SCORRI_PRIME_VOLTE && Math.random() >= SCORRI_A_CASO) { scorriSuggerito = true; return; }
  scorriSuggerito = true;
  scriviNotaScorri({ viste: nota.viste + 1 });
  // Dopo l'entrata dell'elenco, quando l'occhio ci e' gia' arrivato.
  setTimeout(() => {
    if (!prima.isConnected || scorriAperta) return;
    const scatola = prima.parentElement;
    if (!scatola.querySelector(':scope > .scorri-azioni.destra')) return;
    mostraLato(scatola, 'destra');
    prima.classList.add('capolino');
    prima.addEventListener('animationend', () => {
      prima.classList.remove('capolino');
      if (!scatola._lato) mostraLato(scatola, null);
    }, { once: true });
  }, 700);
}

// Il numero accanto al nome di un filtro: piu' piccolo e tenue, senza
// puntino in mezzo.
const conta = (n) => ` <span class="conta">${n}</span>`;
