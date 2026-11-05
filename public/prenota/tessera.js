// La propria tessera: mensilita', ricevute e pagare.

// ---------------------------------------------------------------- tessera
// La propria tessera: l'anno, le mensilita' pagate e le ricevute. I mesi
// senza ricevuta sono solo spenti: non si paga nei mesi in cui non si
// partecipa, quindi non c'e' un "in ritardo".
const MESI_BREVI = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const euro = (n) => `${Number(n).toLocaleString('it-IT', { minimumFractionDigits: n % 1 ? 2 : 0 })} €`;
// Le date si scrivono come nel resto dell'app: "4 novembre 2026", con
// l'anno (le ricevute sono di anni diversi).
const dataCompleta = (iso) => {
  if (!iso) return '';
  const [a, m, g] = String(iso).slice(0, 10).split('-').map(Number);
  return `${g} ${MESI[m - 1]} ${a}`;
};
// Un nome per ogni voce, lo stesso dappertutto (il server, nelle ricevute,
// scrive "Contributo evento"; qui e' "Evento", come nei pulsanti).
const NOMI_VOCE = { obolo_giornaliero: 'Obolo', contributo_mensile: 'Mensilità', contributo_evento: 'Evento' };
const nomeVoce = (codice, tipo) => NOMI_VOCE[codice] || tipo || '';
const meseTesto = (m) => `${MESI[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

async function caricaTessera() {
  const giro = nuovoGiro('tessera');
  const dove = el('tessera');
  dove.className = 'vuoto';
  dove.textContent = 'Carico…';
  try {
    const { tessera } = await chiama('tessera');
    if (!giroValido('tessera', giro)) return;
    segnaFresco('tessera');
    tess.dati = tessera;
    tess.voce = null;
    dove.className = '';
    dove.innerHTML = disegnaTessera(tessera);
    collegaTessera(dove);
  } catch (err) {
    if (giroValido('tessera', giro)) erroreCarico(dove, err, caricaTessera);
  }
}

// Le ricevute stanno in una pagina loro, "Ricevute": nella tessera
// resta solo quanto si e' speso quest'anno.
function disegnaRicevute(t) {
  // Per anno, dal piu' recente. Le ricevute arrivano gia' in ordine di data.
  // Ogni anno e' un gruppo a tendina: aperto il piu' recente, chiusi gli
  // altri. Il quadratino dell'anno sceglie tutte le sue ricevute.
  const perAnno = new Map();
  for (const r of t.ricevute) {
    const anno = String(r.data).slice(0, 4);
    perAnno.set(anno, [...(perAnno.get(anno) || []), r]);
  }
  const chevron = '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  return perAnno.size ? [...perAnno].map(([anno, lista], i) => {
    const totale = lista.reduce((n, r) => n + Number(r.importo || 0), 0);
    return `
    <div class="ricevute-anno" data-gruppo="${esc(anno)}">
      <div class="testa-anno">
        <span class="scegli-anno" role="checkbox" aria-checked="false" tabindex="0" data-anno-tutte="${esc(anno)}" aria-label="Tutte le ricevute del ${esc(anno)}"><span class="spunta" aria-hidden="true"></span></span>
        <button type="button" class="apri-anno" data-apri-anno="${esc(anno)}" aria-expanded="${i === 0}">
          <b>${esc(anno)}</b><span>${lista.length} ${lista.length === 1 ? 'ricevuta' : 'ricevute'} · ${euro(totale)}</span>${chevron}
        </button>
      </div>
      <div class="ricevute-dentro" data-dentro="${esc(anno)}"${i === 0 ? '' : ' hidden'}>
      ${lista.map(r => `
        <div class="riga ricevuta" role="checkbox" aria-checked="false" tabindex="0" data-ricevuta="${esc(r.id)}" data-anno="${esc(anno)}">
          <span class="spunta" aria-hidden="true"></span>
          <div class="ricevuta-testo">
            <div><b>${esc(nomeVoce(r.codice, r.tipo))}</b>${r.evento ? ' · ' + esc(r.evento) : ''} · ${euro(r.importo)}</div>
            <div class="quando">${esc(r.numero)} · ${esc(dataCompleta(r.data))}${r.mese ? ' · ' + esc(meseTesto(r.mese)) : ''}</div>
          </div>
        </div>`).join('')}
      </div>
    </div>`;
  }).join('') : '<p class="vuoto">Ancora nessuna ricevuta.</p>';
}

// In cima alla pagina delle ricevute, quanto si e' speso quest'anno.
function disegnaSpese(t) {
  // La quota annuale non e' una spesa dell'anno come le altre: resta fuori.
  const spese = t.spese.filter(s => s.codice !== 'tesseramento');
  const totale = spese.reduce((n, s) => n + s.totale, 0);
  return `<h2>I tuoi contributi ${esc(t.anno)}</h2>` + (spese.length ? `
    <div class="spese">
      <div class="spese-totale">${euro(totale)}</div>
      ${spese.map(s => `<div class="spesa"><span>${esc(nomeVoce(s.codice, s.tipo))}${s.quante > 1 ? ' × ' + s.quante : ''}</span><b>${euro(s.totale)}</b></div>`).join('')}
    </div>` : '<p class="nota-pagamento">Ancora niente quest’anno.</p>');
}

function apriRicevute() {
  mostra('ricevute');
  const dove = el('lista-ricevute');
  // Prima di scegliere si sa a cosa serve la spunta.
  dove.innerHTML = disegnaSpese(tess.dati) + '<h2>Ricevute</h2>' +
    (tess.dati.ricevute.length ? '<p class="nota-pagamento nota-ricevute">Seleziona le ricevute che ti servono: te le mando in chat, in un PDF unico o una per file.</p>' : '') +
    disegnaRicevute(tess.dati);
  collegaRicevute(dove);
  window.scrollTo(0, 0);
}

function disegnaTessera(t) {
  const pagati = new Set(t.mensilita.map(m => Number(m.slice(5))));
  const adesso = new Date().getMonth() + 1;
  const voci = [
    ['obolo_giornaliero', 'Obolo', euro(t.importi.obolo_giornaliero)],
    // Senza tessera la prima mensilita' e' il tesseramento: si chiama Tessera.
    ['contributo_mensile', t.tesserato ? 'Mensilità' : 'Tessera', euro(t.importi.contributo_mensile)],
    ['contributo_evento', 'Evento', ''],
  ];
  return `
    <div class="tessera-carta${t.tesserato ? '' : ' da-rinnovare'}">
      <div class="tessera-testa"><span>Crocevia dei Mondi</span><span>${esc(t.anno)}</span></div>
      <div class="tessera-piede">
        <div class="tessera-nome">${stellina(stato.ruolo)}${esc(t.nome)}</div>
        <div class="tessera-dati">${[t.numero_socio && t.tesserato ? `Tessera n. ${esc(t.numero_socio)}` : '', t.categoria ? esc(t.categoria) : ''].filter(Boolean).join(' · ')}</div>
      </div>
    </div>
    ${t.tesserato ? '' : '<p class="tessera-avviso">Tesseramento da rinnovare</p>'}
    <div class="titolo-con-link">
      <h2>Contribuisci</h2>
      <button type="button" class="link" id="vai-ricevute">Le mie ricevute ›</button>
    </div>
    <div class="voci">${voci.map(([k, nome, prezzo]) => {
      // Senza la tessera dell'anno si paga solo la mensilita': la prima fa
      // anche da tesseramento. Obolo ed evento restano visibili, spenti.
      const spenta = !t.tesserato && k !== 'contributo_mensile';
      return `<button type="button" class="voce${nome.length > 10 ? ' lunga' : ''}" data-voce="${k}" aria-pressed="false"${spenta ? ' disabled' : ''}><b>${nome}</b>${prezzo ? `<span>${prezzo}</span>` : ''}${ICONE_VOCI[k]}</button>`;
    }).join('')}</div>
    ${t.tesserato ? '' : '<p class="nota-pagamento nota-voci">Per partecipare alle nostre attività ed eventi serve la tessera. Tesserandoti copri anche gli ingressi alle attività del mese corrente.</p>'}
    <div id="dettaglio-pagamento"></div>
    <!-- In fondo: scegliendo una voce se ne va senza spostare il resto.
         Senza la tessera dell'anno non c'e'. -->
    <div id="mesi-pagati-tessera"${t.tesserato ? '' : ' hidden'}>
    <p class="etichetta-mesi">Mensilità pagate nel ${esc(t.anno)}</p>
    <div class="mensilita">${MESI_BREVI.map((m, i) =>
      `<span class="${pagati.has(i + 1) ? 'pagato' : ''}${i + 1 === adesso ? ' adesso' : ''}" title="${MESI[i]}${pagati.has(i + 1) ? ': pagato' : ''}">${m}</span>`).join('')}</div>
    </div>`;
}

// ---------------------------------------------------------------- pagare
// Si sceglie cosa pagare con pochi tocchi: la voce, poi il giorno (oggi,
// ieri, o un altro dal calendario) o i mesi. Il pagamento dall'app arrivera'
// piu' avanti: per ora al posto del pulsante c'e' il conto, con i modi di pagare.
// Phosphor (MIT): coin, calendar-check, ticket. Stanno in un angolo del
// riquadro, sopra lo sfondo, per riconoscere la voce a colpo d'occhio.
const icona = (d) => `<svg class="voce-icona" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
const ICONE_VOCI = {
  obolo_giornaliero: icona('M207.58,63.84C186.85,53.48,159.33,48,128,48S69.15,53.48,48.42,63.84,16,88.78,16,104v48c0,15.22,11.82,29.85,32.42,40.16S96.67,208,128,208s58.85-5.48,79.58-15.84S240,167.22,240,152V104C240,88.78,228.18,74.15,207.58,63.84ZM128,64c62.64,0,96,23.23,96,40s-33.36,40-96,40-96-23.23-96-40S65.36,64,128,64Zm-8,95.86v32c-19-.62-35-3.42-48-7.49V153.05A203.43,203.43,0,0,0,120,159.86Zm16,0a203.43,203.43,0,0,0,48-6.81v31.31c-13,4.07-29,6.87-48,7.49ZM32,152V133.53a82.88,82.88,0,0,0,16.42,10.63c2.43,1.21,5,2.35,7.58,3.43V178C40.17,170.16,32,160.29,32,152Zm168,26V147.59c2.61-1.08,5.15-2.22,7.58-3.43A82.88,82.88,0,0,0,224,133.53V152C224,160.29,215.83,170.16,200,178Z'),
  contributo_mensile: icona('M208,32H184V24a8,8,0,0,0-16,0v8H88V24a8,8,0,0,0-16,0v8H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM72,48v8a8,8,0,0,0,16,0V48h80v8a8,8,0,0,0,16,0V48h24V80H48V48ZM208,208H48V96H208V208Zm-38.34-85.66a8,8,0,0,1,0,11.32l-48,48a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L116,164.69l42.34-42.35A8,8,0,0,1,169.66,122.34Z'),
  contributo_evento: icona('M232,104a8,8,0,0,0,8-8V64a16,16,0,0,0-16-16H32A16,16,0,0,0,16,64V96a8,8,0,0,0,8,8,24,24,0,0,1,0,48,8,8,0,0,0-8,8v32a16,16,0,0,0,16,16H224a16,16,0,0,0,16-16V160a8,8,0,0,0-8-8,24,24,0,0,1,0-48ZM32,167.2a40,40,0,0,0,0-78.4V64H88V192H32Zm192,0V192H104V64H224V88.8a40,40,0,0,0,0,78.4Z'),
};

// L'evento parte da 5 €: si puo' scendere fino a 3.
const EVENTO_BASE = 5;
const tess = { dati: null, voce: null, giorno: null, data: '', mesi: new Set(), evento: EVENTO_BASE };
const PAGAMENTO_ATTIVO = false;
// Dove pagare a distanza. Ancora da riempire: finche' sono vuoti non si vede
// niente (non si inventa un IBAN o un link). Basta scriverli qui.
const PAGA_PAYPAL_URL = '';
const PAGA_CARTA_URL = '';
const PAGA_IBAN = '';
function dovePagare() {
  const link = (url, nome) => /^https:\/\//.test(url)
    ? html`<a class="link" href="${url}" target="_blank" rel="noopener">${nome} ›</a>` : '';
  const pezzi = [link(PAGA_PAYPAL_URL, 'Paga con PayPal'), link(PAGA_CARTA_URL, 'Paga con carta'),
    PAGA_IBAN ? html`<span>Bonifico: IBAN <b>${PAGA_IBAN}</b></span>` : ''].filter(Boolean);
  return pezzi.length ? String(html`<span class="dove-pagare">${pezzi}</span>`) : '';
}
const isoLocale = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function collegaTessera(dove) {
  el('vai-ricevute').onclick = apriRicevute;
  el('chiudi-ricevute').onclick = () => mostra('tessera');
  dove.querySelectorAll('[data-voce]').forEach(b => {
    b.onclick = () => {
      const v = b.dataset.voce;
      Object.assign(tess, { voce: tess.voce === v ? null : v, giorno: null, data: '',
                            mesi: new Set(), evento: EVENTO_BASE, nomeEvento: '' });
      preseleziona();
      disegnaPagamento();
      if (tess.voce) mostraDettaglio();
    };
  });
  disegnaPagamento();
}

// Aperte le scelte di una voce, la pagina scende fin dove si vedono tutte,
// sopra il pulsante Procedi e il menu. Ease in-out fatto a mano: lo scroll
// "smooth" del browser ha una sua curva, diversa da telefono a telefono.
function mostraDettaglio() {
  const d = el('dettaglio-pagamento');
  // Il bordo utile e' sopra quello che galleggia in fondo.
  const fine = fondoLibero() - 16;
  const manca = d.getBoundingClientRect().bottom - fine;
  if (manca > 0) scorriDi(manca);
}

function scorriDi(dy, durata = 450) {
  const da = scrollY;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return scrollTo(0, da + dy);
  const inizio = performance.now();
  const curva = (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const passo = (ora) => {
    const t = Math.min(1, (ora - inizio) / durata);
    scrollTo(0, da + dy * curva(t));
    if (t < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

function meseCorrente() {
  return isoLocale(new Date()).slice(0, 7);
}

// I giorni con l'obolo gia' pagato: non si ripropongono.
function oboliPagati() {
  return new Set(tess.dati.ricevute.filter(r => r.codice === 'obolo_giornaliero').map(r => r.data));
}

// La scelta piu' probabile e' gia' fatta: oggi per obolo ed evento, questo
// mese per la mensilita'. Nel caso normale bastano due tocchi.
function preseleziona() {
  const oggi = isoLocale(new Date());
  if (tess.voce === 'obolo_giornaliero' && !oboliPagati().has(oggi)) {
    tess.giorno = 'oggi'; tess.data = oggi;
  }
  if (tess.voce === 'contributo_evento') {
    tess.giorno = 'oggi'; tess.data = oggi;
  }
  // Per la mensilita' nessun mese e' scelto da solo: si sceglie nella griglia.
}

function totalePagamento() {
  const i = tess.dati.importi;
  switch (tess.voce) {
    case 'obolo_giornaliero': return tess.giorno ? i.obolo_giornaliero : 0;
    case 'contributo_evento': return tess.giorno ? tess.evento : 0;
    case 'contributo_mensile': return tess.mesi.size * i.contributo_mensile;
    default: return 0;
  }
}

function disegnaPagamento() {
  const t = tess.dati;
  const v = tess.voce;
  el('tessera').querySelectorAll('[data-voce]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.voce === v)));
  const d = el('dettaglio-pagamento');
  // Con una voce scelta la griglia dei mesi pagati non serve: si nasconde
  // (sta in fondo, quindi niente si sposta). Senza tessera non c'e'.
  el('mesi-pagati-tessera').hidden = Boolean(v) || !t.tesserato;
  el('tessera').classList.toggle('con-pagamento', Boolean(v));
  // Il tondo sale sopra il pulsante Procedi, quando c'e'.
  el('apri-quote').classList.toggle('secondo', PAGAMENTO_ATTIVO && Boolean(v));
  if (!v) { d.innerHTML = ''; nascondiAzione(); return; }
  let html = '';
  if (v === 'obolo_giornaliero' || v === 'contributo_evento') {
    const oggi = new Date();
    const ieri = new Date(oggi); ieri.setDate(oggi.getDate() - 1);
    // "Gia' pagato" vale per l'obolo: di eventi in un giorno ce ne possono essere due.
    const pagati = v === 'obolo_giornaliero' ? oboliPagati() : new Set();
    const giorno = (d, nome, etichetta) => {
      const pagato = pagati.has(isoLocale(d));
      return `<button type="button" data-giorno="${isoLocale(d)}" data-nome="${nome}" aria-pressed="${tess.giorno === nome}" ${pagato ? 'disabled' : ''}>${etichetta}${pagato ? ' · già pagato' : ''}</button>`;
    };
    html += `<p class="domanda">Per che giorno?</p>
      <div class="scelte">
        ${giorno(oggi, 'oggi', 'Oggi')}
        ${giorno(ieri, 'ieri', 'Ieri')}
        <label class="scelta-data" aria-pressed="${tess.giorno === 'data'}">${tess.giorno === 'data' ? esc(dataTesto(tess.data)) : 'Altro giorno'}
          <input type="date" id="data-pagamento" max="${isoLocale(oggi)}" value="${esc(tess.data)}"></label>
      </div>`;
  }
  if (v === 'contributo_evento') {
    html += campoEventoHtml('tessera', tess.nomeEvento);
    html += `<p class="domanda">Quanto?</p>
      <div class="contatore"><button type="button" data-evento="-1" aria-label="Meno">−</button><b>${euro(tess.evento)}</b><button type="button" data-evento="1" aria-label="Più">+</button></div>`;
  }
  if (v === 'contributo_mensile') {
    // Una griglia sola: quella dei mesi pagati, sopra, se ne va e qui i
    // mesi gia' pagati hanno la spunta verde. Niente scorciatoie sopra la
    // griglia: sembravano filtri, e non lo erano.
    html += `<p class="domanda">Quali mesi?</p>`;
    {
      html += `<div class="mensilita scegli">${MESI_BREVI.map((m, i) => {
        const k = `${t.anno}-${String(i + 1).padStart(2, '0')}`;
        const pagato = t.mensilita.includes(k);
        const classi = [pagato ? 'pagato' : '', k === meseCorrente() ? 'adesso' : ''].join(' ').trim();
        return `<button type="button" data-mese="${esc(k)}" aria-pressed="${tess.mesi.has(k)}" ${pagato ? 'disabled' : ''} class="${classi}" title="${MESI[i]}${pagato ? ': già pagato' : ''}">${m}</button>`;
      }).join('')}</div>`;
    }
  }
  // Finche' dall'app non si paga, al posto di un "Procedi" spento c'e' il
  // conto: quanto fa quello che si e' scelto, e come si puo' pagare. Chi
  // rinnova o e' gia' sociə puo' pagare anche a distanza: non gli si dice
  // che "deve" andare in sede. I canali sono quelli di METODI.
  const totale = totalePagamento();
  if (!PAGAMENTO_ATTIVO) {
    const manca = v === 'contributo_mensile' ? 'Scegli i mesi' : 'Scegli il giorno';
    html += `<div class="conto-pagamento" role="status">
      <b>${totale ? `Totale: ${esc(euro(totale))}` : esc(manca)}</b>
      <span>Puoi pagare in sede in contanti, oppure con PayPal, carta o bonifico.</span>
      ${dovePagare()}
    </div>`;
  }
  ridisegnaTenendo(d, () => { d.innerHTML = html; });

  d.querySelectorAll('[data-giorno]').forEach(b => {
    b.onclick = () => { tess.giorno = b.dataset.nome; tess.data = b.dataset.giorno; disegnaPagamento(); };
  });
  const campoData = d.querySelector('#data-pagamento');
  if (campoData) campoData.onchange = () => {
    if (!campoData.value) return;
    if (v === 'obolo_giornaliero' && oboliPagati().has(campoData.value)) {
      return toast(`L’obolo del ${dataTesto(campoData.value)} è già pagato.`, false);
    }
    tess.giorno = 'data'; tess.data = campoData.value; disegnaPagamento();
  };

  d.querySelectorAll('[data-evento]').forEach(b => {
    b.onclick = () => { tess.evento = Math.min(EVENTO_BASE, Math.max(3, tess.evento + Number(b.dataset.evento))); disegnaPagamento(); };
  });
  if (v === 'contributo_evento') collegaCampoEvento('tessera', tess.data, (nome) => { tess.nomeEvento = nome; });
  d.querySelectorAll('[data-mese]').forEach(b => {
    b.onclick = () => {
      tess.mesi.has(b.dataset.mese) ? tess.mesi.delete(b.dataset.mese) : tess.mesi.add(b.dataset.mese);
      disegnaPagamento();
    };
  });

  azionePrincipale = null;
  // "Procedi": il pagamento vero comincia dopo, non a questo tocco.
  if (PAGAMENTO_ATTIVO) pulsantePrincipale(totale ? `Procedi · ${euro(totale)}` : 'Procedi', totale > 0);
  else nascondiAzione();
}

// Le ricevute si scelgono toccandole, anche un anno intero dalla sua
// intestazione; scelte, il pulsante in basso le manda tutte in chat.
const ricevuteScelte = new Set();

function collegaRicevute(dove) {
  ricevuteScelte.clear();
  const tocco = (nodo, fai) => {
    nodo.onclick = fai;
    nodo.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fai(); } };
  };
  dove.querySelectorAll('[data-ricevuta]').forEach(riga => tocco(riga, () => {
    const id = Number(riga.dataset.ricevuta);
    ricevuteScelte.has(id) ? ricevuteScelte.delete(id) : ricevuteScelte.add(id);
    aggiornaRicevute(dove);
  }));
  dove.querySelectorAll('[data-anno-tutte]').forEach(testa => tocco(testa, () => {
    const ids = [...dove.querySelectorAll(`[data-ricevuta][data-anno="${CSS.escape(testa.dataset.annoTutte)}"]`)]
      .map(r => Number(r.dataset.ricevuta));
    const tutte = ids.every(id => ricevuteScelte.has(id));
    ids.forEach(id => tutte ? ricevuteScelte.delete(id) : ricevuteScelte.add(id));
    aggiornaRicevute(dove);
  }));
  dove.querySelectorAll('[data-apri-anno]').forEach(b => {
    b.onclick = () => {
      const aperto = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(aperto));
      dove.querySelector(`[data-dentro="${CSS.escape(b.dataset.apriAnno)}"]`).hidden = !aperto;
    };
  });
  aggiornaRicevute(dove);
}

function aggiornaRicevute(dove) {
  dove.querySelectorAll('[data-ricevuta]').forEach(r =>
    r.setAttribute('aria-checked', String(ricevuteScelte.has(Number(r.dataset.ricevuta)))));
  dove.querySelectorAll('[data-anno-tutte]').forEach(testa => {
    const righe = [...dove.querySelectorAll(`[data-ricevuta][data-anno="${CSS.escape(testa.dataset.annoTutte)}"]`)];
    const scelte = righe.filter(r => ricevuteScelte.has(Number(r.dataset.ricevuta))).length;
    testa.setAttribute('aria-checked', !scelte ? 'false' : scelte === righe.length ? 'true' : 'mixed');
  });
  if (!ricevuteScelte.size) return nascondiAzione();
  azionePrincipale = mandaRicevute;
  pulsantePrincipale(`Mostra in chat (${ricevuteScelte.size})`, true);
}

// Con piu' ricevute si sceglie: un PDF solo (una per pagina, dalla piu'
// vecchia) o un file per ricevuta.
async function mandaRicevute() {
  const ordine = new Map(tess.dati.ricevute.map(r => [r.id, r.data]));
  const ids = [...ricevuteScelte].sort((a, b) => String(ordine.get(a)).localeCompare(String(ordine.get(b))) || a - b);
  let unico = false;
  if (ids.length > 1) {
    const scelta = await scegli(`${ids.length} ricevute in chat`, 'Come le vuoi?',
      [['unico', 'Un PDF unico'], ['separati', 'File separati']]);
    if (!scelta) return;
    unico = scelta === 'unico';
  }
  attesaAzione(true);
  try {
    await chiama('tessera/ricevuta', { ricevutaIds: ids, unico });
    toast(ids.length === 1 ? 'Te l’ho mandata in chat.'
      : unico ? `Te le ho mandate in chat in un PDF: ${ids.length}.` : `Te le ho mandate in chat: ${ids.length}.`);
    ricevuteScelte.clear();
    aggiornaRicevute(el('lista-ricevute'));
  } catch (err) {
    lamenta(err.message);
  } finally {
    attesaAzione(false);
  }
}
