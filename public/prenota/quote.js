// Il direttivo: quote dei soci, cronologia dei pagamenti, incassi.

// ------------------------------------------------- quote dei soci (direttivo)
// Non tutte le quote passano dall'app: chi paga in sede va segnato a mano.
// L'elenco dice chi ha rinnovato il tesseramento e quali mensilita' ha
// pagato ciascunə; toccando unə sociə si apre la sua scheda, da dove si
// registra un pagamento, si annulla una ricevuta sbagliata o gli si manda
// un promemoria in chat. Le mensilita' non sono "in ritardo" (si pagano nei
// mesi in cui si partecipa): il filtro del mese dice solo chi non l'ha
// ancora pagato, poi decide chi guarda.
const quo = {
  anno: new Date().getFullYear(), filtro: 'mese', testo: '', soci: null,
  ordine: 'nome', ancheSenza: false, voceScheda: 'tutte', mesePagato: '',
  vista: 'persone', periodo: 'mese', da: '', a: '', voceFiltro: 'tutte', pagamenti: null, chiavePagamenti: '',
  socio: null, voce: null, giorno: null, data: '', mesi: new Set(), importo: EVENTO_BASE, metodo: null,
};
const METODI = [['contanti', 'Contanti'], ['paypal', 'PayPal'], ['bonifico', 'Bonifico'], ['stripe', 'Carta']];
const METODI_TESTO = { contanti: 'in contanti', paypal: 'con PayPal', bonifico: 'con bonifico', stripe: 'con carta' };
const metodoNome = (k) => METODI.find(([x]) => x === k)?.[1] || k || '';
const IMPORTO_EVENTO_MAX = 50;

const annoCorrente = () => new Date().getFullYear();
const meseKey = (anno, i) => `${anno}-${String(i + 1).padStart(2, '0')}`;

function collegaQuote() {
  el('vista-quote').querySelectorAll('[data-vista]').forEach(b => {
    b.onclick = () => { quo.vista = b.dataset.vista; caricaQuote(); };
  });
  el('pagamenti-da').onchange = el('pagamenti-a').onchange = () => {
    quo.da = el('pagamenti-da').value;
    quo.a = el('pagamenti-a').value;
    caricaPagamenti();
  };
  el('ordine-quote').onchange = () => { quo.ordine = el('ordine-quote').value; disegnaQuote(); };
  el('mese-pagato').onchange = () => { quo.mesePagato = el('mese-pagato').value; disegnaQuote(); };
  el('anche-senza-tessera').onchange = () => { quo.ancheSenza = el('anche-senza-tessera').checked; disegnaQuote(); };
  el('anno-prima').onclick = () => cambiaAnnoQuote(-1);
  el('anno-dopo').onclick = () => cambiaAnnoQuote(1);
  // Si ridisegna quando ci si ferma un attimo, non a ogni lettera.
  let attesa;
  el('cerca-quote').addEventListener('input', () => {
    clearTimeout(attesa);
    attesa = setTimeout(() => {
      quo.testo = el('cerca-quote').value.trim().toLowerCase();
      disegnaQuote();
    }, 200);
  });
}

function cambiaAnnoQuote(delta) {
  quo.anno = Math.min(annoCorrente(), quo.anno + delta);
  // Il mese corrente ha senso solo nell'anno corrente.
  quo.soci = null;
  caricaQuote();
}

async function caricaQuote() {
  // L'anno vale per la vista delle persone; i pagamenti hanno il loro periodo.
  el('vista-quote').querySelectorAll('[data-vista]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.vista === quo.vista)));
  el('vista-persone').hidden = quo.vista !== 'persone';
  el('vista-pagamenti').hidden = quo.vista !== 'pagamenti';
  el('anno-quote-nav').style.visibility = quo.vista === 'persone' ? '' : 'hidden';
  if (quo.vista === 'pagamenti') return caricaPagamenti();
  el('anno-quote').textContent = quo.anno;
  el('anno-dopo').disabled = quo.anno >= annoCorrente();
  const dove = el('elenco-quote');
  if (!quo.soci) {
    // Cambiando anno in fretta arrivano piu' risposte: conta l'ultima.
    const giro = nuovoGiro('quote');
    const anno = quo.anno;
    dove.className = 'vuoto';
    dove.textContent = 'Carico…';
    try {
      const { soci } = await chiama('tessere/elenco', { anno });
      if (!giroValido('quote', giro) || anno !== quo.anno) return;
      quo.soci = soci.sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'it'));
      quo.annoSoci = anno;
    } catch (err) {
      if (giroValido('quote', giro)) erroreCarico(dove, err, caricaQuote);
      return;
    }
  }
  disegnaQuote();
}

// Si vede chi ha la tessera dell'anno; chi non ce l'ha solo con la spunta
// sotto. Il menu del mese mostra chi ha pagato quel mese.
// La stellina accanto al nome: oro per il direttivo, azzurra per lo staff.
const RUOLI = { direttivo: 'Direttivo', staff: 'Staff' };
// Sta a sinistra del nome.
const stellina = (ruolo) => RUOLI[ruolo]
  ? `<span class="stellina ${ruolo}" title="${RUOLI[ruolo]}" aria-label="${RUOLI[ruolo]}">★</span> ` : '';

// Quali mesi, per il tooltip del conto: "gennaio, marzo, novembre".
const mesiPagatiTesto = (mensilita, anno) => {
  const quali = MESI.filter((_, i) => mensilita.includes(meseKey(anno, i)));
  return quali.length ? `Pagati: ${quali.join(', ')}` : 'Nessuna mensilità pagata';
};

const ORDINI_QUOTE = {
  nome: (a, b) => String(a.nome).localeCompare(String(b.nome), 'it'),
  // Dal pagamento piu' recente; chi non ha mai pagato in fondo.
  ultimo: (a, b) => String(b.ultimo_pagamento || '').localeCompare(String(a.ultimo_pagamento || ''))
    || ORDINI_QUOTE.nome(a, b),
  numero: (a, b) => (Number(a.numero_socio) || Infinity) - (Number(b.numero_socio) || Infinity)
    || ORDINI_QUOTE.nome(a, b),
};

function disegnaQuote() {
  const dove = el('elenco-quote');
  if (!quo.soci) return;
  const base = quo.soci.filter(s => quo.ancheSenza || s.tesserato);
  // I mesi cambiano solo con l'anno: il menu si rifa' solo allora.
  if (el('mese-pagato').dataset.anno !== String(quo.anno)) {
    el('mese-pagato').innerHTML = `<option value="">Tutti i mesi</option>` + MESI.map((m, i) =>
      `<option value="${meseKey(quo.anno, i)}">${m.replace(/^./, c => c.toUpperCase())}</option>`).join('');
    el('mese-pagato').dataset.anno = String(quo.anno);
  }
  if (quo.mesePagato && !quo.mesePagato.startsWith(String(quo.anno))) quo.mesePagato = '';
  el('mese-pagato').value = quo.mesePagato;
  el('ordine-quote').value = quo.ordine;
  el('ordine-quote').closest('.ordina').classList.toggle('attivo', quo.ordine !== 'nome');
  el('anche-senza-tessera').checked = quo.ancheSenza;

  const t = quo.testo;
  const lista = base.filter(s => !quo.mesePagato || s.mensilita.includes(quo.mesePagato)).filter(s => !t ||
    String(s.nome).toLowerCase().includes(t) || String(s.numero_socio || '').toLowerCase() === t)
    .sort(ORDINI_QUOTE[quo.ordine] || ORDINI_QUOTE.nome);
  if (!lista.length) {
    dove.className = 'vuoto';
    dove.textContent = t ? 'Nessun risultato.'
      : quo.mesePagato ? 'Nessun pagamento per questo mese.' : 'L’elenco è vuoto.';
    return;
  }
  const adesso = quo.anno === annoCorrente() ? new Date().getMonth() : -1;
  dove.className = '';
  dove.innerHTML = lista.map(s => `
    <div class="riga socio-quota${s.tesserato ? '' : ' senza-tessera'}" role="button" tabindex="0" data-socio="${esc(s.id)}">
      <span class="numero-tessera" title="${s.tesserato && s.numero_socio ? 'Tessera n. ' + esc(s.numero_socio) : 'Senza tessera ' + quo.anno}">${s.tesserato && s.numero_socio ? esc(s.numero_socio) : ''}</span>
      ${stellina(s.ruolo)}<span class="socio-nome">${esc(s.nome)}${s.tesserato ? '' : `<small>senza tessera ${quo.anno}</small>`}</span>
      <span class="mesi-conto${adesso >= 0 && s.mensilita.includes(meseKey(quo.anno, adesso)) ? ' ok' : ''}" title="${esc(mesiPagatiTesto(s.mensilita, quo.anno))}"
        aria-label="Mensilità pagate: ${esc(s.mensilita.length)} su 12"><b>${esc(s.mensilita.length)}</b>/12</span>
    </div>`).join('');
  dove.querySelectorAll('[data-socio]').forEach(r => {
    const apri = () => apriQuota(Number(r.dataset.socio));
    r.onclick = apri;
    r.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apri(); } };
  });
}

// ---- il nome dell'evento, per il contributo evento
// Si scrive, o si tocca fra gli eventi in calendario quel giorno (tutte le
// sedi): scrivendo, la lista si stringe a quelli che corrispondono.
const eventiGiorno = new Map();
function nomiEventiDelGiorno(data) {
  if (!eventiGiorno.has(data)) {
    eventiGiorno.set(data, chiama('eventi-del-giorno', { data }).then(r => r.eventi || [])
      .catch(() => { eventiGiorno.delete(data); return []; }));
  }
  return eventiGiorno.get(data);
}

function campoEventoHtml(id, valore) {
  return `<p class="domanda">Quale evento?</p>
    <input type="text" id="evento-${id}" class="campo-evento" maxlength="120" autocomplete="off"
           placeholder="Il nome dell’evento" value="${esc(valore || '')}">
    <div class="scelte eventi-giorno" id="eventi-${id}"></div>`;
}

async function collegaCampoEvento(id, data, salva) {
  const campo = el(`evento-${id}`);
  const dove = el(`eventi-${id}`);
  if (!campo || !data) return;
  let eventi = [];
  const disegna = () => {
    const scritto = campo.value.trim();
    const t = scritto.toLowerCase();
    const esatto = eventi.some(e => e.titolo === scritto);
    const lista = esatto || !t ? eventi : eventi.filter(e => e.titolo.toLowerCase().includes(t));
    dove.innerHTML = lista.map(e => `<button type="button" data-evento-nome="${esc(e.titolo)}" aria-pressed="${e.titolo === scritto}">${esc(e.titolo)}${e.ora ? ` <small>${esc(e.ora)}</small>` : ''}</button>`).join('');
    dove.querySelectorAll('[data-evento-nome]').forEach(b => {
      b.onclick = () => { campo.value = b.dataset.eventoNome; salva(campo.value); disegna(); };
    });
  };
  campo.oninput = () => { salva(campo.value.trim()); disegna(); };
  eventi = await nomiEventiDelGiorno(data);
  if (campo.isConnected) disegna();
}

// ---- la cronologia: i pagamenti di tutte le persone in un periodo
// Si sceglie il periodo (oggi, il mese, l'anno, o due
// date), poi volendo una voce sola: cosi' si vedono anche i singoli oboli di
// una serata. In cima il totale e quanti per voce; sotto, giorno per giorno.
// Toccare un pagamento apre la scheda della persona.
// Su una riga sola: oggi, il mese in corso e l'anno in corso per nome, o un
// periodo scelto con due date.
const PERIODI = () => [['oggi', 'Oggi'], ['mese', MESI[new Date().getMonth()].replace(/^./, c => c.toUpperCase())],
  ['anno', String(new Date().getFullYear())], ['scegli', 'Altro…']];
const VOCI_CRONOLOGIA = [['tutte', 'Tutte'], ['obolo_giornaliero', 'Oboli'], ['contributo_mensile', 'Mensilità'], ['contributo_evento', 'Eventi']];

function estremiPeriodo() {
  const oggi = new Date();
  const iso = isoLocale(oggi);
  if (quo.periodo === 'oggi') return [iso, iso];
  if (quo.periodo === 'mese') return [`${iso.slice(0, 7)}-01`, iso];
  if (quo.periodo === 'anno') return [`${iso.slice(0, 4)}-01-01`, iso];
  return [quo.da, quo.a];
}

async function caricaPagamenti() {
  el('periodo-pagamenti').innerHTML = PERIODI().map(([k, nome]) =>
    `<button type="button" data-periodo="${k}" aria-pressed="${k === quo.periodo}">${nome}</button>`).join('');
  el('periodo-pagamenti').querySelectorAll('[data-periodo]').forEach(b => {
    b.onclick = () => {
      quo.periodo = b.dataset.periodo;
      // "Dal... al..." parte dal mese in corso: si cambia una data sola.
      if (quo.periodo === 'scegli' && !quo.da) {
        const oggi = isoLocale(new Date());
        Object.assign(quo, { da: `${oggi.slice(0, 7)}-01`, a: oggi });
      }
      caricaPagamenti();
    };
  });
  el('date-pagamenti').hidden = quo.periodo !== 'scegli';
  const [da, a] = estremiPeriodo();
  el('pagamenti-da').value = da;
  el('pagamenti-a').value = a;
  el('pagamenti-da').max = el('pagamenti-a').max = isoLocale(new Date());
  const dove = el('elenco-pagamenti');
  if (!da || !a || a < da) {
    dove.className = 'vuoto';
    dove.textContent = 'Scegli due date, la prima prima della seconda.';
    el('voce-pagamenti').innerHTML = '';
    return;
  }
  const chiave = `${da}|${a}`;
  if (!quo.pagamenti || quo.chiavePagamenti !== chiave) {
    // Cambiando periodo in fretta: conta l'ultimo.
    const giro = nuovoGiro('pagamenti');
    dove.className = 'vuoto';
    dove.textContent = 'Carico…';
    try {
      const { pagamenti } = await chiama('tessere/pagamenti', { da, a });
      if (!giroValido('pagamenti', giro)) return;
      quo.pagamenti = pagamenti;
      quo.chiavePagamenti = chiave;
    } catch (err) {
      if (giroValido('pagamenti', giro)) erroreCarico(dove, err, caricaPagamenti);
      return;
    }
  }
  disegnaPagamenti();
}

function disegnaPagamenti() {
  const tutti = quo.pagamenti;
  el('voce-pagamenti').innerHTML = VOCI_CRONOLOGIA.map(([k, nome]) => {
    const n = k === 'tutte' ? null : tutti.filter(p => p.codice === k).length;
    return `<button type="button" data-voce-cronologia="${k}" aria-pressed="${k === quo.voceFiltro}">${nome}${n === null ? '' : conta(n)}</button>`;
  }).join('');
  el('voce-pagamenti').querySelectorAll('[data-voce-cronologia]').forEach(b => {
    b.onclick = () => { quo.voceFiltro = b.dataset.voceCronologia; disegnaPagamenti(); };
  });
  const lista = quo.voceFiltro === 'tutte' ? tutti : tutti.filter(p => p.codice === quo.voceFiltro);
  const dove = el('elenco-pagamenti');
  if (!lista.length) {
    dove.className = 'vuoto';
    dove.textContent = 'Nessun pagamento in questo periodo.';
    return;
  }
  const perGiorno = new Map();
  for (const p of lista) perGiorno.set(p.data, [...(perGiorno.get(p.data) || []), p]);
  const oggi = isoLocale(new Date());
  const ieri = isoLocale(new Date(Date.now() - 864e5));
  const nomeGiorno = (g) => g === oggi ? 'Oggi' : g === ieri ? 'Ieri'
    : new Date(`${g}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  dove.className = '';
  dove.innerHTML = [...perGiorno].map(([g, righe]) => `
    <h2 class="giorno-gestione">${esc(nomeGiorno(g))} <span class="totale-giorno">${euro(righe.reduce((n, p) => n + Number(p.importo || 0), 0))}</span></h2>
    ${righe.map(p => `
      <div class="riga pagamento riga-pagamento" role="button" tabindex="0" data-socio-pagamento="${esc(p.partner_id)}">
        <div class="pag-testo">
          <b>${esc(p.socio)}</b>
          <div class="quando">${esc(nomeVoce(p.codice, p.tipo))}${p.mese ? ' ' + esc(meseTesto(p.mese)) : ''}${p.evento ? ' · ' + esc(p.evento) : ''} · ${esc(p.numero)}</div>
        </div>
        <div class="pag-importo"><b>${euro(p.importo)}</b><span>${esc(metodoNome(p.metodo))}</span></div>
      </div>`).join('')}`).join('');
  dove.querySelectorAll('[data-socio-pagamento]').forEach(r => {
    const apri = () => apriQuota(Number(r.dataset.socioPagamento));
    r.onclick = apri;
    r.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apri(); } };
  });
}

// La scheda di una persona. Se mentre arriva se ne apre un'altra (o si
// torna indietro), la risposta non vale piu': senza, la scheda di A poteva
// arrivare dopo quella di B, e "Registra" pagava su A.
async function apriQuota(partnerId) {
  mostra('quota');
  const giro = nuovoGiro('quota');
  window.scrollTo(0, 0);
  Object.assign(quo, { socio: null, voce: null, giorno: null, data: '', mesi: new Set(), importo: EVENTO_BASE, metodo: null });
  const dove = el('scheda-quota');
  dove.className = 'vuoto';
  dove.textContent = 'Carico…';
  try {
    const { tessera } = await chiama('tessere/socio', { partnerId, anno: quo.anno });
    if (!giroValido('quota', giro)) return;
    quo.socio = { ...tessera, id: tessera.id || partnerId };
  } catch (err) {
    if (giroValido('quota', giro)) erroreCarico(dove, err, () => apriQuota(partnerId));
    return;
  }
  disegnaQuota();
}

function disegnaQuota() {
  const t = quo.socio;
  const dove = el('scheda-quota');
  const adesso = t.anno === annoCorrente() ? new Date().getMonth() : -1;
  const importi = t.importi || {};
  const voci = [
    ['contributo_mensile', t.tesserato ? 'Mensilità' : 'Tessera', importi.contributo_mensile ? euro(importi.contributo_mensile) : ''],
    ['obolo_giornaliero', 'Obolo', importi.obolo_giornaliero ? euro(importi.obolo_giornaliero) : ''],
    ['contributo_evento', 'Evento', ''],
  ];
  const ricevute = (t.ricevute || []).filter(r => String(r.data).startsWith(String(t.anno)));
  dove.className = 'con-pagamento';
  dove.innerHTML = `
    <h1 class="nome-quota">${stellina(quo.soci?.find(s => s.id === t.id)?.ruolo)}${esc(t.nome)}</h1>
    <p class="quando-quota">${[t.numero_socio && t.tesserato ? `Tessera n. ${esc(t.numero_socio)}` : `Senza tessera ${esc(t.anno)}`, t.categoria ? esc(t.categoria) : ''].filter(Boolean).join(' · ')}</p>
    ${t.tesserato ? '' : `<p class="tessera-avviso">Tessera ${esc(t.anno)} da rinnovare: la prima mensilità vale anche come tesseramento.</p>`}
    <div id="mesi-pagati-quota">
    <p class="etichetta-mesi">Mensilità pagate nel ${esc(t.anno)}</p>
    <div class="mensilita">${MESI_BREVI.map((m, i) => {
      const pagato = t.mensilita.includes(meseKey(t.anno, i));
      return `<span class="${pagato ? 'pagato' : ''}${i === adesso ? ' adesso' : ''}" title="${MESI[i]}${pagato ? ': pagato' : ''}">${m}</span>`;
    }).join('')}</div>
    </div>
    ${t.telegram && t.anno === annoCorrente()
      ? '<p class="ricorda-quota"><button type="button" class="link" id="ricorda-quota">Manda un promemoria in chat ›</button></p>' : ''}
    <section class="blocco-segna" aria-labelledby="titolo-segna">
      <h2 id="titolo-segna">Segna un pagamento</h2>
      <div class="voci">${voci.map(([k, nome, prezzo]) =>
        `<button type="button" class="voce${nome.length > 10 ? ' lunga' : ''}" data-voce-quota="${k}" aria-pressed="false"><b>${nome}</b>${prezzo ? `<span>${prezzo}</span>` : ''}${ICONE_VOCI[k]}</button>`).join('')}</div>
      <div id="dettaglio-quota"></div>
    </section>
    <h2>Pagamenti ${esc(t.anno)}</h2>
    ${ricevute.length ? `<div class="filtro-riga"><span class="filtro-nome">Voce</span><div class="tipi" id="voce-scheda" role="group" aria-label="Voce"></div></div>` : ''}
    <div id="pagamenti-scheda">${ricevute.length ? '' : '<p class="nota-pagamento">Nessuna ricevuta quest’anno.</p>'}</div>`;

  dove.querySelectorAll('[data-voce-quota]').forEach(b => {
    b.onclick = () => {
      const v = b.dataset.voceQuota;
      const oggi = isoLocale(new Date());
      Object.assign(quo, { voce: quo.voce === v ? null : v, giorno: 'oggi', data: oggi,
                           mesi: new Set(), importo: EVENTO_BASE, nomeEvento: '' });
      // Per la mensilita' il mese piu' probabile e' questo, se manca.
      const questo = meseCorrente();
      if (quo.voce === 'contributo_mensile' && t.anno === annoCorrente() && !t.mensilita.includes(questo)) {
        quo.mesi.add(questo);
      }
      disegnaPagamentoQuota();
      if (quo.voce) mostraDettaglioQuota();
    };
  });
  if (ricevute.length) disegnaPagamentiScheda(ricevute);
  const ricorda = el('ricorda-quota');
  if (ricorda) ricorda.onclick = () => ricordaQuota(ricorda);
  disegnaPagamentoQuota();
}

// I pagamenti di una persona, filtrabili per voce: tutte, mensilita',
// oboli, eventi. Annullare o correggere una ricevuta si fa in Odoo.
function disegnaPagamentiScheda(ricevute) {
  if (!VOCI_CRONOLOGIA.some(([k]) => k === quo.voceScheda)) quo.voceScheda = 'tutte';
  el('voce-scheda').innerHTML = VOCI_CRONOLOGIA.map(([k, nome]) => {
    const n = k === 'tutte' ? null : ricevute.filter(r => r.codice === k).length;
    return `<button type="button" data-voce-scheda="${k}" aria-pressed="${k === quo.voceScheda}">${nome}${n === null ? '' : conta(n)}</button>`;
  }).join('');
  el('voce-scheda').querySelectorAll('[data-voce-scheda]').forEach(b => {
    b.onclick = () => { quo.voceScheda = b.dataset.voceScheda; disegnaPagamentiScheda(ricevute); };
  });
  const lista = quo.voceScheda === 'tutte' ? ricevute : ricevute.filter(r => r.codice === quo.voceScheda);
  const dove = el('pagamenti-scheda');
  dove.innerHTML = lista.length ? lista.map(r => `
      <div class="riga riga-pagamento">
        <div class="pag-testo">
          <b>${r.evento ? esc(r.evento) : `${esc(nomeVoce(r.codice, r.tipo))}${r.mese ? ' ' + esc(meseTesto(r.mese)) : ''}`}</b>
          <div class="quando">${r.evento ? esc(nomeVoce(r.codice, r.tipo)) + ' · ' : ''}${esc(dataCompleta(r.data))} · ${esc(r.numero)}</div>
        </div>
        <div class="pag-importo"><b>${euro(r.importo)}</b><span>${esc(metodoNome(r.metodo))}</span></div>
      </div>`).join('') : '<p class="nota-pagamento">Niente di questo tipo quest’anno.</p>';
}

function mostraDettaglioQuota() {
  const d = el('dettaglio-quota');
  const fine = fondoLibero() - 16;
  const manca = d.getBoundingClientRect().bottom - fine;
  if (manca > 0) scorriDi(manca);
}

function totaleQuota() {
  const i = quo.socio.importi || {};
  switch (quo.voce) {
    case 'contributo_mensile': return quo.mesi.size * (Number(i.contributo_mensile) || 0);
    case 'obolo_giornaliero': return Number(i.obolo_giornaliero) || 0;
    case 'contributo_evento': return quo.importo;
    default: return 0;
  }
}

function disegnaPagamentoQuota() {
  const t = quo.socio;
  const v = quo.voce;
  el('scheda-quota').querySelectorAll('[data-voce-quota]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.voceQuota === v)));
  const d = el('dettaglio-quota');
  el('mesi-pagati-quota').hidden = v === 'contributo_mensile';
  if (!v) { d.innerHTML = ''; nascondiAzione(); return; }
  const oggi = new Date();
  const ieri = new Date(oggi); ieri.setDate(oggi.getDate() - 1);
  let html = '';
  if (v === 'contributo_mensile') {
    const mancano = MESI_BREVI.map((_, i) => meseKey(t.anno, i)).filter(k => !t.mensilita.includes(k));
    const tutti = mancano.length && mancano.every(k => quo.mesi.has(k));
    html += `<p class="domanda">Quali mesi?</p>
      <div class="mensilita scegli">${MESI_BREVI.map((m, i) => {
        const k = meseKey(t.anno, i);
        const pagato = t.mensilita.includes(k);
        const classi = [pagato ? 'pagato' : '', k === meseCorrente() ? 'adesso' : ''].join(' ').trim();
        return `<button type="button" data-mese-quota="${esc(k)}" aria-pressed="${quo.mesi.has(k)}" ${pagato ? 'disabled' : ''} class="${classi}" title="${MESI[i]}${pagato ? ': già pagato' : ''}">${m}</button>`;
      }).join('')}</div>
      ${mancano.length > 1 ? `<div class="scelte"><button type="button" data-tutti-mesi aria-pressed="${tutti}">Tutti quelli che mancano</button></div>` : ''}`;
  }
  if (v === 'contributo_evento') {
    html += `<p class="domanda">Quanto?</p>
      <div class="contatore"><button type="button" data-importo="-1" aria-label="Meno">−</button><b>${euro(quo.importo)}</b><button type="button" data-importo="1" aria-label="Più">+</button></div>`;
  }
  if (!t.tesserato && v !== 'contributo_mensile') {
    html += `<p class="nota-pagamento attento">Non ha ancora la tessera ${esc(t.anno)}: ricordaglielo.</p>`;
  }
  if (!t.tesserato && v === 'contributo_mensile') {
    html += `<p class="nota-pagamento">Il primo mese scelto è il tesseramento ${esc(t.anno)}: copre gli ingressi di tutto quel mese.</p>`;
  }
  html += `<p class="domanda">${v === 'obolo_giornaliero' || v === 'contributo_evento' ? 'Per che giorno?' : 'Quando ha pagato?'}</p>`;
  html += `
    <div class="scelte">
      <button type="button" data-giorno-quota="${isoLocale(oggi)}" data-nome="oggi" aria-pressed="${quo.giorno === 'oggi'}">Oggi</button>
      <button type="button" data-giorno-quota="${isoLocale(ieri)}" data-nome="ieri" aria-pressed="${quo.giorno === 'ieri'}">Ieri</button>
      <label class="scelta-data" aria-pressed="${quo.giorno === 'data'}">${quo.giorno === 'data' ? esc(dataTesto(quo.data)) : 'Altro giorno'}
        <input type="date" id="data-quota" max="${isoLocale(oggi)}" value="${esc(quo.data)}"></label>
    </div>
    ${v === 'contributo_evento' ? campoEventoHtml('quota', quo.nomeEvento) : ''}
    <p class="domanda">Come ha pagato?</p>
    <div class="scelte">${METODI.map(([k, nome]) =>
      `<button type="button" data-metodo="${k}" aria-pressed="${quo.metodo === k}">${nome}</button>`).join('')}</div>`;
  ridisegnaTenendo(d, () => { d.innerHTML = html; });

  d.querySelectorAll('[data-mese-quota]').forEach(b => {
    b.onclick = () => {
      const k = b.dataset.meseQuota;
      quo.mesi.has(k) ? quo.mesi.delete(k) : quo.mesi.add(k);
      disegnaPagamentoQuota();
    };
  });
  const tutti = d.querySelector('[data-tutti-mesi]');
  if (tutti) tutti.onclick = () => {
    const mancano = MESI_BREVI.map((_, i) => meseKey(t.anno, i)).filter(k => !t.mensilita.includes(k));
    quo.mesi = mancano.every(k => quo.mesi.has(k)) ? new Set() : new Set(mancano);
    disegnaPagamentoQuota();
  };
  d.querySelectorAll('[data-importo]').forEach(b => {
    b.onclick = () => {
      quo.importo = Math.min(IMPORTO_EVENTO_MAX, Math.max(1, quo.importo + Number(b.dataset.importo)));
      disegnaPagamentoQuota();
    };
  });
  d.querySelectorAll('[data-giorno-quota]').forEach(b => {
    b.onclick = () => { quo.giorno = b.dataset.nome; quo.data = b.dataset.giornoQuota; disegnaPagamentoQuota(); };
  });
  const campoData = d.querySelector('#data-quota');
  if (campoData) campoData.onchange = () => {
    if (!campoData.value) return;
    quo.giorno = 'data'; quo.data = campoData.value; disegnaPagamentoQuota();
  };
  d.querySelectorAll('[data-metodo]').forEach(b => {
    b.onclick = () => { quo.metodo = b.dataset.metodo; disegnaPagamentoQuota(); };
  });
  if (v === 'contributo_evento') collegaCampoEvento('quota', quo.data, (nome) => { quo.nomeEvento = nome; });

  const totale = totaleQuota();
  const pronto = totale > 0 && quo.data && quo.metodo && (v !== 'contributo_mensile' || quo.mesi.size);
  azionePrincipale = registraQuota;
  pulsantePrincipale(!quo.metodo ? 'Scegli come ha pagato'
    : totale ? `Registra ${euro(totale)}` : 'Registra', Boolean(pronto));
}

function descriviQuota() {
  const metodo = METODI_TESTO[quo.metodo];
  const cosa = quo.voce === 'contributo_mensile'
    ? `Mensilità di ${[...quo.mesi].sort().map(k => MESI[Number(k.slice(5)) - 1]).join(', ')}`
    : `${quo.voce === 'obolo_giornaliero' ? 'Obolo' : `Evento${quo.nomeEvento ? ` “${quo.nomeEvento}”` : ''}`} del ${dataTesto(quo.data)}`;
  return `${cosa}: ${euro(totaleQuota())}, ${metodo}${quo.voce === 'contributo_mensile' ? `, il ${dataTesto(quo.data)}` : ''}.`;
}

async function registraQuota() {
  const t = quo.socio;
  const nome = String(t.nome || '').trim().split(/\s+/)[0];
  if (!await conferma(descriviQuota(), `Registro il pagamento di ${nome}?`)) return;
  attesaAzione(true);
  try {
    const esito = await chiama('tessere/registra', {
      partnerId: t.id, codice: quo.voce, metodo: quo.metodo, data: quo.data,
      mesi: [...quo.mesi], importo: quo.importo, evento: quo.nomeEvento || '',
    });
    const numero = esito?.ricevute?.[0]?.numero;
    toast(numero ? `Registrato: ricevuta ${numero}.` : 'Pagamento registrato.');
    quo.soci = null;
    quo.pagamenti = null;
    attesaAzione(false);
    nascondiAzione();
    apriQuota(t.id);
  } catch (err) {
    attesaAzione(false);
    lamenta(err.message);
  }
}

async function ricordaQuota(bottone) {
  bottone.disabled = true;
  try {
    const { manca } = await chiama('tessere/ricorda', { partnerId: quo.socio.id });
    toast(`Promemoria mandato: ${manca.join(' e ')}.`);
  } catch (err) {
    lamenta(err.message);
  } finally {
    bottone.disabled = false;
  }
}

// ------------------------------------------------- pagamenti di tante persone
// A una serata pagano in tanti la stessa cosa: si sceglie la voce, il giorno
// e come, poi si scrivono i nomi uno dopo l'altro. I suggerimenti vengono
// dall'elenco delle quote dell'anno, quindi arrivano subito e dicono anche
// chi ha la tessera. Senza tessera l'obolo e l'evento si segnano lo stesso,
// con un promemoria accanto al nome; per la mensilita' la prima vale anche
// come tesseramento. Chi ha gia' pagato tutti i mesi scelti resta in elenco,
// spento, e non si paga di nuovo.
const inc = {
  soci: null, voce: 'obolo_giornaliero', giorno: 'oggi', data: '', metodo: null,
  mesi: new Set(), importo: EVENTO_BASE, scelti: [], errori: new Map(), lista: [], evidenziato: -1,
};
const VOCI_INCASSO = [['obolo_giornaliero', 'Obolo'], ['contributo_mensile', 'Mensilità'], ['contributo_evento', 'Evento']];

async function apriIncassi() {
  mostra('incassi');
  window.scrollTo(0, 0);
  const oggi = isoLocale(new Date());
  Object.assign(inc, { giorno: 'oggi', data: oggi, metodo: null, mesi: new Set([meseCorrente()]),
                       importo: EVENTO_BASE, nomeEvento: '', scelti: [], errori: new Map() });
  const dove = el('modulo-incassi');
  const giro = nuovoGiro('incassi');
  // L'elenco delle quote, se e' gia' quello di quest'anno, va bene anche qui.
  // Se no si rilegge: quello di prima puo' essere vecchio.
  inc.soci = quo.soci && quo.annoSoci === annoCorrente() ? { soci: quo.soci } : null;
  if (!inc.soci || !tess.dati) {
    dove.className = 'vuoto';
    dove.textContent = 'Carico…';
    try {
      // I prezzi sono quelli della propria tessera: uguali per tutte le persone.
      const [tessera, elenco] = await Promise.all([
        tess.dati ? null : chiama('tessera').then(r => r.tessera),
        inc.soci ? null : chiama('tessere/elenco', { anno: annoCorrente() }),
      ]);
      if (!giroValido('incassi', giro)) return;
      if (tessera) tess.dati = tessera;
      if (elenco) inc.soci = elenco;
    } catch (err) {
      if (giroValido('incassi', giro)) erroreCarico(dove, err, apriIncassi);
      return;
    }
  }
  dove.className = '';
  disegnaIncassi();
  el('cerca-incasso')?.focus();
}

// Quanto paga una persona e cosa le manca, con la voce scelta adesso.
function pagamentoDi(s) {
  const importi = tess.dati?.importi || {};
  if (inc.voce === 'contributo_mensile') {
    const mesi = [...inc.mesi].filter(m => !s.mensilita.includes(m)).sort();
    return { mesi, totale: mesi.length * (Number(importi.contributo_mensile) || 0), gia: !mesi.length };
  }
  if (inc.voce === 'contributo_evento') return { totale: inc.importo, gia: false };
  return { totale: Number(importi.obolo_giornaliero) || 0, gia: false };
}

function disegnaIncassi() {
  const dove = el('modulo-incassi');
  const oggi = new Date();
  const ieri = new Date(oggi); ieri.setDate(oggi.getDate() - 1);
  const anno = annoCorrente();
  let html = `
    <p class="domanda">Cosa?</p>
    <div class="scelte">${VOCI_INCASSO.map(([k, nome]) =>
      `<button type="button" data-voce-incasso="${k}" aria-pressed="${inc.voce === k}">${nome}</button>`).join('')}</div>`;
  if (inc.voce === 'contributo_mensile') {
    html += `<p class="domanda">Quali mesi?</p>
      <div class="mensilita scegli">${MESI_BREVI.map((m, i) => {
        const k = meseKey(anno, i);
        return `<button type="button" data-mese-incasso="${esc(k)}" aria-pressed="${inc.mesi.has(k)}" class="${k === meseCorrente() ? 'adesso' : ''}" title="${MESI[i]}">${m}</button>`;
      }).join('')}</div>`;
  }
  if (inc.voce === 'contributo_evento') {
    html += `<p class="domanda">Quanto, a testa?</p>
      <div class="contatore"><button type="button" data-importo-incasso="-1" aria-label="Meno">−</button><b>${euro(inc.importo)}</b><button type="button" data-importo-incasso="1" aria-label="Più">+</button></div>`;
  }
  html += `<p class="domanda">${inc.voce === 'contributo_mensile' ? 'Quando hanno pagato?' : 'Per che giorno?'}</p>
    <div class="scelte">
      <button type="button" data-giorno-incasso="${isoLocale(oggi)}" data-nome="oggi" aria-pressed="${inc.giorno === 'oggi'}">Oggi</button>
      <button type="button" data-giorno-incasso="${isoLocale(ieri)}" data-nome="ieri" aria-pressed="${inc.giorno === 'ieri'}">Ieri</button>
      <label class="scelta-data" aria-pressed="${inc.giorno === 'data'}">${inc.giorno === 'data' ? esc(dataTesto(inc.data)) : 'Altro giorno'}
        <input type="date" id="data-incasso" max="${isoLocale(oggi)}" value="${esc(inc.data)}"></label>
    </div>
    ${inc.voce === 'contributo_evento' ? campoEventoHtml('incasso', inc.nomeEvento) : ''}
    <p class="domanda">Come hanno pagato?</p>
    <div class="scelte">${METODI.map(([k, nome]) =>
      `<button type="button" data-metodo-incasso="${k}" aria-pressed="${inc.metodo === k}">${nome}</button>`).join('')}</div>
    <p class="domanda">Chi?</p>
    <div class="campo-cerca-incasso">
      <input type="text" id="cerca-incasso" placeholder="Scrivi un nome o un numero di tessera" autocomplete="off"
             role="combobox" aria-autocomplete="list" aria-controls="suggerimenti-incasso" aria-expanded="false">
      <div id="suggerimenti-incasso" class="suggerimenti-soci" role="listbox" aria-label="Persone" hidden></div>
    </div>
    <div id="scelti-incasso"></div>`;
  // Il nome a meta' nel campo "Chi?" resta, e il fuoco anche.
  const tornato = ridisegnaTenendo(dove, () => { dove.innerHTML = html; });

  dove.querySelectorAll('[data-voce-incasso]').forEach(b => {
    b.onclick = () => { inc.voce = b.dataset.voceIncasso; disegnaIncassi(); };
  });
  dove.querySelectorAll('[data-mese-incasso]').forEach(b => {
    b.onclick = () => {
      const k = b.dataset.meseIncasso;
      inc.mesi.has(k) ? inc.mesi.delete(k) : inc.mesi.add(k);
      disegnaIncassi();
    };
  });
  dove.querySelectorAll('[data-importo-incasso]').forEach(b => {
    b.onclick = () => {
      inc.importo = Math.min(IMPORTO_EVENTO_MAX, Math.max(1, inc.importo + Number(b.dataset.importoIncasso)));
      disegnaIncassi();
    };
  });
  dove.querySelectorAll('[data-giorno-incasso]').forEach(b => {
    b.onclick = () => { inc.giorno = b.dataset.nome; inc.data = b.dataset.giornoIncasso; disegnaIncassi(); };
  });
  const campoData = el('data-incasso');
  campoData.onchange = () => {
    if (!campoData.value) return;
    inc.giorno = 'data'; inc.data = campoData.value; disegnaIncassi();
  };
  dove.querySelectorAll('[data-metodo-incasso]').forEach(b => {
    b.onclick = () => { inc.metodo = b.dataset.metodoIncasso; disegnaIncassi(); };
  });
  if (inc.voce === 'contributo_evento') collegaCampoEvento('incasso', inc.data, (nome) => { inc.nomeEvento = nome; });
  collegaCercaIncasso();
  disegnaSceltiIncasso();
  // Si stava scrivendo un nome: tornano anche i suggerimenti.
  if (tornato?.id === 'cerca-incasso' && tornato.value.trim()) tornato.dispatchEvent(new Event('input'));
}

function suggerimentiIncasso(testo) {
  const t = testo.trim().toLowerCase();
  if (!t) return [];
  const presi = new Set(inc.scelti);
  return inc.soci.soci
    .filter(s => !presi.has(s.id))
    .filter(s => String(s.nome).toLowerCase().includes(t) || String(s.numero_socio || '').toLowerCase() === t)
    .sort((a, b) => Number(!String(a.nome).toLowerCase().startsWith(t)) - Number(!String(b.nome).toLowerCase().startsWith(t))
      || String(a.nome).localeCompare(String(b.nome), 'it'))
    .slice(0, 8);
}

function collegaCercaIncasso() {
  const campo = el('cerca-incasso');
  const lista = el('suggerimenti-incasso');
  const anno = annoCorrente();
  const mostraLista = (voci) => {
    inc.lista = voci;
    inc.evidenziato = voci.length ? 0 : -1;
    lista.innerHTML = voci.map((s, i) => `
      <button type="button" role="option" id="incasso-${i}" data-indice="${i}" aria-selected="${i === 0}">
        <b>${esc(s.nome)}</b><span class="${s.tesserato ? '' : 'senza-tessera'}">${s.tesserato
          ? (s.numero_socio ? `#${esc(s.numero_socio)}` : 'Tessera ' + anno) : `Senza tessera ${anno}`}</span>
      </button>`).join('');
    lista.hidden = !voci.length;
    campo.setAttribute('aria-expanded', String(Boolean(voci.length)));
    if (voci.length) campo.setAttribute('aria-activedescendant', 'incasso-0');
    else campo.removeAttribute('aria-activedescendant');
    lista.querySelectorAll('[data-indice]').forEach(b => {
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.onclick = () => aggiungi(Number(b.dataset.indice));
    });
  };
  // Scelto un nome, il campo si svuota e resta pronto per il prossimo.
  const aggiungi = (i) => {
    const s = inc.lista[i];
    if (!s) return;
    inc.scelti.push(s.id);
    campo.value = '';
    mostraLista([]);
    disegnaSceltiIncasso();
    campo.focus();
  };
  const evidenzia = (i) => {
    const bottoni = [...lista.querySelectorAll('[data-indice]')];
    if (!bottoni.length) return;
    inc.evidenziato = (i + bottoni.length) % bottoni.length;
    bottoni.forEach((b, j) => b.setAttribute('aria-selected', String(j === inc.evidenziato)));
    bottoni[inc.evidenziato].scrollIntoView({ block: 'nearest' });
    campo.setAttribute('aria-activedescendant', bottoni[inc.evidenziato].id);
  };
  campo.addEventListener('input', () => mostraLista(suggerimentiIncasso(campo.value)));
  campo.addEventListener('keydown', (e) => {
    if (lista.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); evidenzia(inc.evidenziato + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); evidenzia(inc.evidenziato - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); aggiungi(Math.max(0, inc.evidenziato)); }
    else if (e.key === 'Escape') { e.preventDefault(); mostraLista([]); }
  });
}

function disegnaSceltiIncasso() {
  const dove = el('scelti-incasso');
  const anno = annoCorrente();
  const perId = new Map(inc.soci.soci.map(s => [s.id, s]));
  const scelti = inc.scelti.map(id => perId.get(id)).filter(Boolean);
  dove.innerHTML = scelti.length ? scelti.map(s => {
    const p = pagamentoDi(s);
    const errore = inc.errori.get(s.id);
    let nota = '';
    if (errore) nota = `<div class="quando ritardo">${esc(errore)}</div>`;
    else if (p.gia) nota = '<div class="quando">Ha già pagato i mesi scelti: non paga di nuovo.</div>';
    else if (!s.tesserato && inc.voce === 'contributo_mensile') nota = `<div class="quando">Per questa persona vale come tesseramento ${anno}.</div>`;
    else if (!s.tesserato) nota = `<div class="quando attento">Senza tessera ${anno}: ricordaglielo.</div>`;
    return `
      <div class="riga scelto-incasso${p.gia ? ' spento' : ''}">
        <div class="testa-prestito">
          <b>${esc(s.nome)}</b>
          <span class="importo-incasso">${p.gia ? '' : euro(p.totale)}</span>
          <button type="button" class="togli-incasso" data-togli="${esc(s.id)}" aria-label="Togli ${esc(s.nome)}">×</button>
        </div>
        ${nota}
      </div>`;
  }).join('') : '<p class="nota-pagamento">Nessun nome ancora: scrivine uno qui sopra.</p>';
  dove.querySelectorAll('[data-togli]').forEach(b => {
    b.onclick = () => {
      const id = Number(b.dataset.togli);
      inc.scelti = inc.scelti.filter(x => x !== id);
      inc.errori.delete(id);
      disegnaSceltiIncasso();
    };
  });
  aggiornaPulsanteIncassi();
}

function righeIncasso() {
  const perId = new Map(inc.soci.soci.map(s => [s.id, s]));
  return inc.scelti.map(id => perId.get(id)).filter(Boolean)
    .map(s => ({ s, p: pagamentoDi(s) })).filter(({ p }) => !p.gia && p.totale > 0);
}

function aggiornaPulsanteIncassi() {
  const righe = righeIncasso();
  const totale = righe.reduce((n, r) => n + r.p.totale, 0);
  const voceMesi = inc.voce !== 'contributo_mensile' || inc.mesi.size;
  azionePrincipale = registraIncassi;
  pulsantePrincipale(!inc.metodo ? 'Scegli come hanno pagato'
    : !righe.length ? 'Aggiungi almeno un nome'
    : `Registra ${righe.length} · ${euro(totale)}`, Boolean(inc.metodo && righe.length && voceMesi));
}

async function registraIncassi() {
  const righe = righeIncasso();
  const totale = righe.reduce((n, r) => n + r.p.totale, 0);
  const voce = VOCI_INCASSO.find(([k]) => k === inc.voce)[1];
  const metodo = METODI_TESTO[inc.metodo];
  const quando = inc.voce === 'contributo_mensile'
    ? [...inc.mesi].sort().map(k => MESI[Number(k.slice(5)) - 1]).join(', ')
    : `${inc.voce === 'contributo_evento' && inc.nomeEvento ? `“${inc.nomeEvento}” ` : ''}del ${dataTesto(inc.data)}`;
  if (!await conferma(`${voce} ${quando}: ${righe.length} ${righe.length === 1 ? 'persona' : 'persone'}, ${euro(totale)} in tutto, ${metodo}.`,
    'Registro i pagamenti?')) return;
  attesaAzione(true);
  try {
    const { esiti } = await chiama('tessere/registra-tanti', {
      codice: inc.voce, metodo: inc.metodo, data: inc.data, importo: inc.importo, evento: inc.nomeEvento || '',
      righe: righe.map(({ s, p }) => ({ partnerId: s.id, mesi: p.mesi })),
    });
    const ok = new Set(esiti.filter(e => e.ok).map(e => e.partnerId));
    inc.errori = new Map(esiti.filter(e => !e.ok).map(e => [e.partnerId, e.errore]));
    // Chi e' registrato esce dall'elenco; chi no resta, con il motivo.
    inc.scelti = inc.scelti.filter(id => !ok.has(id));
    // L'elenco vecchio resta finche' non arriva il nuovo: intanto si puo'
    // ancora togliere un nome senza che la pagina si rompa.
    quo.soci = null;
    quo.pagamenti = null;
    attesaAzione(false);
    toast(inc.errori.size
      ? `Registrati ${ok.size}, ${inc.errori.size} no: vedi i nomi rimasti.`
      : `Registrati ${ok.size} ${ok.size === 1 ? 'pagamento' : 'pagamenti'}.`, !inc.errori.size);
    // L'elenco si rilegge (chi ha pagato ora ha i mesi nuovi), i rimasti restano.
    const rimasti = inc.scelti;
    const errori = inc.errori;
    inc.soci = await chiama('tessere/elenco', { anno: annoCorrente() });
    inc.scelti = rimasti;
    inc.errori = errori;
    disegnaSceltiIncasso();
  } catch (err) {
    attesaAzione(false);
    lamenta(err.message);
  }
}
