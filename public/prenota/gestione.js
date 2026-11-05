// Prenotazioni staff: le prossime due settimane e le serie da approvare.

// ------------------------------------------------------- prenotazioni staff
// Le prenotazioni dei prossimi due settimane in tutte le sedi, per giorno,
// e in cima le attivita' periodiche da approvare. Da qui lo staff dice
// "apro io", annulla una data e decide le richieste, come dai gruppi.
// In cima, due filtri: tutte, o solo quelle che hanno bisogno di qualcuno
// che apra e non ce l'hanno ancora. Il filtro resta scelto mentre l'app e'
// aperta: dopo un "Apro io" l'elenco si rilegge e quella data esce.
const gestione = { dati: null, filtro: 'tutte', sede: null };
// La sede scelta resta fra una sessione e l'altra, per persona: chi fa lo
// staff a Trani guarda Trani. '' vuol dire tutte.
const SEDE_GESTIONE = 'sede_prenotazioni';
let sedeGestioneLetta = null;
function sedeGestione() {
  if (!sedeGestioneLetta) {
    sedeGestioneLetta = leggiNotaUtente(SEDE_GESTIONE).then(v => {
      gestione.sede = (stato.sediInfo || []).some(x => x.slug === v) ? v : '';
      return gestione.sede;
    });
  }
  return sedeGestioneLetta;
}
const dellaSede = (p) => !gestione.sede || p.sede === gestione.sede;
const richiestaDellaSede = (r) => !gestione.sede
  || r.sedeNome === (stato.sediInfo || []).find(x => x.slug === gestione.sede)?.nome;
const senzaChiApre = (p) => p.serveApertura && !p.apre;

// Le prenotazioni di tutti le chiedono in due: l'elenco e il controllo del
// pallino. Conta l'ultima richiesta partita, che e' la piu' fresca.
async function caricaGestione({ silenzioso = false } = {}) {
  const giro = nuovoGiro('gestione');
  const dove = el('elenco-gestione');
  if (!silenzioso) {
    dove.className = 'vuoto';
    dove.textContent = 'Carico…';
  }
  try {
    const [dati] = await Promise.all([chiama('staff/prenotazioni'), sedeGestione()]);
    if (!giroValido('gestione', giro)) return;
    gestione.dati = dati;
    chiaviControllate = Date.now();
  } catch (err) {
    if (!giroValido('gestione', giro)) return;
    if (silenzioso) return lamenta(err.message);
    el('filtro-gestione').hidden = true;
    erroreCarico(dove, err, () => caricaGestione());
    return;
  }
  disegnaGestione();
  dove.classList.toggle('senza-entrata', silenzioso);
}

// ---- il pallino rosso sul tasto Prenotazioni
// Dice allo staff, gia' da Attivita', quante date dei prossimi quattordici
// giorni sono senza chiavi. Se ne va quando la persona apre il filtro
// "Senza chiavi" (le ha viste), e torna se se ne scopre una nuova. Quali ha
// visto lo ricorda la memoria per persona: ogni membro dello staff ha il
// suo pallino.
const CHIAVI_VISTE = 'chiavi_viste';
const CHIAVI_OGNI_MS = 2 * 60 * 1000;
let chiaviControllate = 0;
let chiaviViste = null;

async function chiaviGiaViste() {
  if (!chiaviViste) {
    chiaviViste = leggiNotaUtente(CHIAVI_VISTE).then(v => {
      try { return new Set(JSON.parse(v || '[]')); } catch { return new Set(); }
    });
  }
  return chiaviViste;
}

// All'apertura di Attivita', per lo staff: le prenotazioni si chiedono al
// massimo ogni due minuti, e servono anche all'elenco se lo si apre subito.
async function controllaChiavi() {
  if (el('apri-gestione').hidden || Date.now() - chiaviControllate < CHIAVI_OGNI_MS) return;
  chiaviControllate = Date.now();
  const giro = nuovoGiro('gestione');
  try {
    const dati = await chiama('staff/prenotazioni');
    if (!giroValido('gestione', giro)) { chiaviControllate = 0; return; }
    gestione.dati = dati;
  } catch {
    chiaviControllate = 0;
    return;
  }
  aggiornaPallinoChiavi();
}

async function aggiornaPallinoChiavi() {
  if (!Array.isArray(gestione.dati?.prenotazioni)) return;
  await sedeGestione();
  const scoperte = primeDelleSerie(gestione.dati.prenotazioni).filter(dellaSede).filter(senzaChiApre);
  const viste = await chiaviGiaViste();
  const nuove = scoperte.some(p => !viste.has(p.id));
  const pallino = el('pallino-chiavi');
  pallino.hidden = !nuove;
  pallino.textContent = scoperte.length > 9 ? '9+' : String(scoperte.length);
  el('apri-gestione').setAttribute('aria-label', nuove
    ? `Prenotazioni, ${scoperte.length} senza chiavi` : 'Prenotazioni');
}

// Aperto il filtro, tutte quelle di adesso sono viste. Si tengono solo le
// date ancora scoperte: le altre non servono, e la memoria resta piccola.
async function segnaChiaviViste() {
  if (!Array.isArray(gestione.dati?.prenotazioni)) return;
  const ids = primeDelleSerie(gestione.dati.prenotazioni).filter(dellaSede).filter(senzaChiApre).map(p => p.id);
  chiaviViste = Promise.resolve(new Set(ids));
  scriviNotaUtente(CHIAVI_VISTE, JSON.stringify(ids));
  aggiornaPallinoChiavi();
}

function disegnaGestione() {
  const dove = el('elenco-gestione');
  const tutti = gestione.dati;
  const sedi = stato.sediInfo || [];
  el('sede-gestione').hidden = sedi.length < 2;
  el('sede-gestione').innerHTML = [['', 'Tutte'], ...sedi.map(x => [x.slug, x.nome])].map(([k, nome]) =>
    `<button type="button" data-sede-gestione="${esc(k)}" aria-pressed="${k === gestione.sede}">${esc(nome)}</button>`).join('');
  el('sede-gestione').querySelectorAll('[data-sede-gestione]').forEach(b => {
    b.onclick = () => {
      gestione.sede = b.dataset.sedeGestione;
      sedeGestioneLetta = Promise.resolve(gestione.sede);
      scriviNotaUtente(SEDE_GESTIONE, gestione.sede);
      disegnaGestione();
    };
  });
  const righe = primeDelleSerie(tutti.prenotazioni).filter(dellaSede);
  const senza = righe.filter(senzaChiApre);
  const filtri = [['tutte', 'Tutte'], ['senza-apre', 'Senza chiavi']];
  el('filtro-gestione').hidden = false;
  el('filtro-gestione').innerHTML = filtri.map(([k, nome]) =>
    `<button type="button" data-filtro-gestione="${k}" aria-pressed="${k === gestione.filtro}">${nome}</button>`).join('');
  el('filtro-gestione').querySelectorAll('[data-filtro-gestione]').forEach(b => {
    b.onclick = () => { gestione.filtro = b.dataset.filtroGestione; disegnaGestione(); };
  });
  const soloSenza = gestione.filtro === 'senza-apre';
  if (soloSenza) segnaChiaviViste(); else aggiornaPallinoChiavi();
  // Con il filtro le richieste da approvare restano fuori: non hanno date.
  const dati = { richieste: soloSenza ? [] : tutti.richieste.filter(richiestaDellaSede), prenotazioni: soloSenza ? senza : righe };
  dove.className = '';
  let html = '';
  if (dati.richieste.length) {
    html += '<h2>Da approvare</h2>' + dati.richieste.map(r => `
      <div class="riga da-decidere">
        <div><b>${esc(r.titolo)}</b> · ${esc(r.sedeNome)}</div>
        <div class="quando">${esc(r.cadenza)}</div>
        <div class="quando">Chiede ${esc(r.chi)}${r.serveApertura ? ' · serve qualcuno che apra' : ''}</div>
        <div class="azioni a-destra">
          <button type="button" class="grave" data-richiesta="${esc(r.id)}" data-scelta="no">Rifiuta</button>
          <button type="button" class="conferma" data-richiesta="${esc(r.id)}" data-scelta="si">Approva</button>
        </div>
      </div>`).join('');
  }
  const perGiorno = new Map();
  for (const p of dati.prenotazioni) {
    const g = p.inizio.slice(0, 10);
    perGiorno.set(g, [...(perGiorno.get(g) || []), p]);
  }
  const oggi = isoLocale(new Date());
  const domani = isoLocale(new Date(Date.now() + 864e5));
  const nomeGiorno = (g) => g === oggi ? 'Oggi' : g === domani ? 'Domani'
    : new Date(`${g}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const ora = (iso) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  html += perGiorno.size ? [...perGiorno].map(([g, lista]) => `
    <h2 class="giorno-gestione">${esc(nomeGiorno(g))}</h2>
    ${lista.map(p => {
      const scoperta = p.serveApertura && !p.apre;
      const chiavi = !p.serveApertura ? ''
        : p.apre ? `<span class="chiavi ok">Apre ${esc(p.apre)}</span>` : '<span class="chiavi no">Non hanno le chiavi</span>';
      return `
      <div class="riga pren${soloSenza ? ' con-apro' : ''}" data-pren="${esc(p.id)}">
        <div class="corpo-riga">
          <div class="pren-testa"><b>${esc(p.titolo)}</b></div>
          <div class="quando">${ora(p.inizio)}-${ora(p.fine)} · ${esc(p.sedeNome)}${p.chi ? ' · ' + esc(p.chi) : ''}${p.serieId ? ' · si ripete' : ''}</div>
          ${soloSenza ? '' : chiavi}
        </div>
        ${soloSenza ? `<div class="azioni in-vista">
          <button type="button" class="conferma" data-apro="${esc(p.id)}">Apro io</button>
        </div>` : ''}
        ${scoperta ? `<div class="azioni sinistra">
          <button type="button" class="libero" data-pieno data-apro="${esc(p.id)}">Apro io</button>
        </div>` : ''}
        <div class="azioni">
          <button type="button" class="grave" data-pieno data-annulla="${esc(p.id)}">${p.serieId ? 'Annulla questa data' : 'Annulla'}</button>
        </div>
      </div>`;
    }).join('')}`).join('')
    : soloSenza ? '<p class="vuoto">Tutte le aperture dei prossimi quattordici giorni hanno le chiavi.</p>'
    : '<p class="vuoto">Nessuna prenotazione nei prossimi quattordici giorni.</p>';
  dove.innerHTML = html;

  dove.querySelectorAll('[data-richiesta]').forEach(b => {
    b.onclick = () => azioneGestione(b, 'staff/richiesta', { id: b.dataset.richiesta, scelta: b.dataset.scelta },
      b.dataset.scelta === 'si' ? 'Approvata: è in calendario.' : 'Rifiutata.');
  });
  const prenotazione = (id) => gestione.dati.prenotazioni.find(p => p.id === id);
  dove.querySelectorAll('[data-apro]').forEach(b => { b.onclick = () => aproIo(prenotazione(b.dataset.apro), b); });
  dove.querySelectorAll('[data-serie]').forEach(b => { b.onclick = () => apriSerie(b.dataset.sede, b.dataset.serie); });
  dove.querySelectorAll('[data-annulla]').forEach(b => { b.onclick = () => annullaData(prenotazione(b.dataset.annulla)); });
  // Le richieste da approvare tengono i pulsanti in vista: sono una
  // decisione da prendere, non un'azione da cercare.
  // Toccare una prenotazione apre i suoi dettagli, con tutte le azioni.
  scorrevoli(dove, '.riga:not(.da-decidere)', {
    tocco: (riga) => dettaglioPrenotazione(prenotazione(riga.dataset.pren)),
    menu: (riga) => dettaglioPrenotazione(prenotazione(riga.dataset.pren)),
  });
}

// Fa la chiamata, poi rilegge l'elenco senza "Carico…" e senza animazioni.
async function azioneGestione(bottone, percorso, dati, fatto) {
  if (bottone) bottone.disabled = true;
  try {
    await chiama(percorso, dati);
    toast(fatto);
    chiudiFoglio();
    caricaGestione({ silenzioso: true });
  } catch (err) {
    lamenta(err.message);
    if (bottone) bottone.disabled = false;
  }
}

const giornoLungo = (iso) => new Date(iso).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const giornoBreve = (iso) => new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
const oraBreve = (iso) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

// Apro io: di un'attivita' periodica, solo questa data o tutte.
async function aproIo(p, bottone, tutte = null) {
  if (!p) return;
  if (p.serieId && tutte === null) {
    const scelta = await scegli('Apri tu le chiavi?', 'È un’attività che si ripete.',
      [['una', `Solo ${giornoLungo(p.inizio).split(' ').slice(0, 2).join(' ')}`], ['tutte', 'Tutte le date']]);
    if (!scelta) return;
    tutte = scelta === 'tutte';
  }
  azioneGestione(bottone, 'staff/apro', { sede: p.sede, eventId: p.id, serieId: p.serieId, tutte: Boolean(tutte) },
    tutte ? 'Segnato: apri tu, tutte le date.' : 'Segnato: apri tu.');
}

// Annullare una data: chi l'ha prenotata riceve un messaggio, e lo staff
// puo' scriverci il perche'.
function annullaData(p) {
  if (!p) return;
  const corpo = apriFoglio(`
    <h2>Annullo “${esc(p.titolo)}”?</h2>
    <p class="spiega">${giornoLungo(p.inizio)}, ${oraBreve(p.inizio)}-${oraBreve(p.fine)} · ${esc(p.sedeNome)}${p.serieId ? ' · solo questa data' : ''}</p>
    <div class="campo">
      <label for="motivo-annullo">Un messaggio per chi l’ha prenotata (facoltativo)</label>
      <textarea id="motivo-annullo" maxlength="500" placeholder="Per esempio, perché si annulla."></textarea>
    </div>
    <p class="aiuto-foglio">${p.chi ? `${esc(p.chi)} riceve` : 'Chi l’ha prenotata riceve'} comunque un messaggio in chat.</p>
    <div class="azioni-form">
      <button type="button" class="bottone secondario" data-indietro>Indietro</button>
      <button type="button" class="bottone pieno-grave" data-conferma>Annulla la data</button>
    </div>`);
  corpo.querySelector('[data-indietro]').onclick = chiudiFoglio;
  corpo.querySelector('[data-conferma]').onclick = (e) => azioneGestione(e.currentTarget, 'staff/annulla',
    { sede: p.sede, eventId: p.id, messaggio: el('motivo-annullo').value }, 'Prenotazione annullata.');
}

// I dettagli di una prenotazione (o di un'attivita' periodica), con tutte
// le azioni: quelle dello swipe, piu' comode da leggere.
function dettaglioPrenotazione(p) {
  if (!p) return;
  const date = p.serieId ? gestione.dati.prenotazioni.filter(x => x.serieId === p.serieId) : [];
  const righe = [
    ['Quando', `${giornoLungo(p.inizio).replace(/^./, c => c.toUpperCase())}, ${oraBreve(p.inizio)}-${oraBreve(p.fine)}`],
    ['Sede', esc(p.sedeNome)],
    ...(p.chi ? [['Prenotata da', esc(p.chi)]] : []),
    ...(p.serieId ? [['Si ripete', esc(p.cadenza || 'sì')]] : []),
    ...(p.serveApertura ? [['Chiavi', p.apre ? `Apre ${esc(p.apre)}` : '<span class="ritardo">Non hanno le chiavi</span>']] : []),
    ...(p.note ? [['Note', esc(p.note)]] : []),
  ];
  const scoperta = p.serveApertura && !p.apre;
  const corpo = apriFoglio(`
    <h2 class="titolo-foglio">${esc(p.titolo)}</h2>
    <div class="riepilogo">${righe.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
    ${date.length > 1 ? `<p class="domanda">Nei prossimi quattordici giorni</p>
      <div class="date-serie">${date.map(d => `<span class="${d.apre ? 'apre' : ''}">${new Date(d.inizio).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })}${d.apre ? ' · ' + esc(d.apre) : ''}</span>`).join('')}</div>` : ''}
    ${p.serieId ? `
      <div class="griglia-azioni con-nomi">
        ${scoperta ? `<span class="nome-azione">Apro io</span>
        <button type="button" class="bottone" data-apro-una>Solo ${giornoBreve(p.inizio)}</button>
        <button type="button" class="bottone secondario" data-apro-tutte>Sempre</button>` : ''}
        <span class="nome-azione">Annulla</span>
        <button type="button" class="bottone arancio" data-annulla-data>Solo ${giornoBreve(p.inizio)}</button>
        <button type="button" class="bottone grave" data-annulla-serie>Tutta la serie…</button>
      </div>` : `
      <div class="griglia-azioni">
        ${scoperta ? '<button type="button" class="bottone" data-apro-una>Apro io</button>' : ''}
        <button type="button" class="bottone arancio" data-annulla-data>Annulla</button>
      </div>`}`);
  corpo.querySelector('[data-apro-una]')?.addEventListener('click', (e) => aproIo(p, e.currentTarget, false));
  corpo.querySelector('[data-apro-tutte]')?.addEventListener('click', (e) => aproIo(p, e.currentTarget, true));
  corpo.querySelector('[data-annulla-data]').onclick = () => annullaData(p);
  corpo.querySelector('[data-annulla-serie]')?.addEventListener('click', () => { chiudiFoglio(); apriSerie(p.sede, p.serieId); });
}

// Il riepilogo di un'attivita' periodica, prima di chiuderla: cos'e', chi
// l'ha proposta, quante date spariscono e le prime di queste. Le date
// passate restano nel calendario. Il pulsante in basso, rosso, la chiude.
const serieAperta = { sede: null, id: null };

async function apriSerie(sede, serieId) {
  Object.assign(serieAperta, { sede, id: serieId, titolo: '' });
  mostra('serie');
  const giro = nuovoGiro('serie');
  window.scrollTo(0, 0);
  const dove = el('riepilogo-serie');
  dove.className = 'vuoto';
  dove.textContent = 'Carico…';
  let s;
  try {
    ({ serie: s } = await chiama('staff/serie', { sede, serieId }));
  } catch (err) {
    if (giroValido('serie', giro)) erroreCarico(dove, err, () => apriSerie(sede, serieId));
    return;
  }
  // Mentre arrivava si e' tornati indietro, o si e' aperta un'altra serie:
  // il pulsante rosso non deve finire su un'altra pagina.
  if (!giroValido('serie', giro) || el('pannello-serie').hidden || serieAperta.id !== serieId) return;
  serieAperta.titolo = s.titolo;
  const giorno = (iso) => new Date(iso).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const prossime = s.prossime || [];
  const righe = [
    ['Sede', s.sedeNome],
    ['Quando', `${s.cadenza}, ${s.orario}`],
    [s.cominciata ? 'Va dal' : 'Comincia il', dataTesto(s.dal)],
    ...(s.chi ? [['Proposta da', s.chi]] : []),
    ['Date che spariscono', s.quante ? `${s.quante} nel prossimo anno` : 'nessuna'],
  ];
  dove.className = 'con-pagamento';
  dove.innerHTML = html`
    <h1>${s.titolo}</h1>
    <div class="riepilogo">${righe.map(([k, v]) => html`<div><span>${k}</span><b>${v}</b></div>`)}</div>
    ${prossime.length ? html`<h2>Le prossime</h2>
      ${prossime.map(d => html`<div class="riga data-serie"><span class="giorno-serie">${giorno(d.inizio)}</span>${d.apre ? html`<span class="quando">apre ${d.apre}</span>` : ''}</div>`)}
      ${s.quante > prossime.length ? html`<p class="nota-pagamento">…e altre ${s.quante - prossime.length}.</p>` : ''}` : ''}
    <p class="nota-serie">${s.cominciata ? 'Le date già passate restano nel calendario: se ne vanno solo quelle da adesso in poi.'
      : 'Non è ancora cominciata: se ne va tutta.'} Non si torna indietro.</p>
    ${s.avvisabile ? raw(`<div class="campo">
      <label for="messaggio-serie">Un messaggio per chi l’ha proposta (facoltativo)</label>
      <textarea id="messaggio-serie" maxlength="500" placeholder="Per esempio, perché si chiude."></textarea>
    </div>
    <p class="nota-pagamento">Riceve comunque un messaggio in chat che dice che l’attività è chiusa.</p>`) : ''}`;
  azionePrincipale = annullaSerie;
  pulsantePrincipale('Annulla la serie', true);
  el('azione').classList.add('grave');
}

async function annullaSerie() {
  // Non si torna indietro: si chiede prima.
  if (el('pannello-serie').hidden || !serieAperta.id) return;
  const { sede, id } = serieAperta;
  if (!await conferma('Tutte le date future spariscono dal calendario. Non si torna indietro.',
    serieAperta.titolo ? `Annullo “${serieAperta.titolo}”?` : 'Annullo la serie?')) return;
  if (el('pannello-serie').hidden || serieAperta.id !== id) return;
  const messaggio = el('messaggio-serie')?.value || '';
  attesaAzione(true);
  try {
    await chiama('staff/annulla-serie', { sede, serieId: id, messaggio });
    attesaAzione(false);
    toast('Serie annullata.');
    mostra('gestione');
  } catch (err) {
    attesaAzione(false);
    lamenta(err.message);
  }
}
