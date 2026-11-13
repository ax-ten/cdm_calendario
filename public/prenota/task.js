// Le task dello staff: l'elenco, la scheda di una task e il modulo per
// crearla o cambiarla. Sono le task dei progetti di Odoo; chi se ne occupa
// sono schede socio, non utenti Odoo.

// ------------------------------------------------------------------ elenco
// In cima: le mie, tutte, o quelle fatte da poco; poi il progetto e
// l'etichetta. L'elenco va per scadenza: in ritardo, oggi, questa
// settimana, piu' avanti, senza scadenza. Scorrendo una riga: Fatta da un
// lato, Prendo io dall'altro.
const tk = { dati: null, filtro: 'mie', progetto: 0, etichetta: 0, aperta: null, modulo: null };
const FILTRI_TASK = [['mie', 'Le mie'], ['tutte', 'Tutte'], ['fatte', 'Fatte']];
const GIORNI_FATTE = 14;
const RIPETE_TESTO = { settimana: 'Ogni settimana', mese: 'Ogni mese', altro: 'Sì' };
// Il filtro scelto resta fra una sessione e l'altra, per persona.
const FILTRO_TASK = 'filtro_task';
let filtroTaskLetto = null;
function filtroTask() {
  if (!filtroTaskLetto) {
    filtroTaskLetto = leggiNotaUtente(FILTRO_TASK).then(v => {
      if (FILTRI_TASK.some(([k]) => k === v) && v !== 'fatte') tk.filtro = v;
    });
  }
  return filtroTaskLetto;
}

const oggiIso = () => isoLocale(new Date());
const traGiorni = (n) => isoLocale(new Date(Date.now() + n * 864e5));
const scadenzaTesto = (iso) => {
  if (!iso) return '';
  if (iso === oggiIso()) return 'oggi';
  if (iso === traGiorni(1)) return 'domani';
  if (iso === traGiorni(-1)) return 'ieri';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
};
const inRitardo = (t) => !t.fatta && t.scadenza && t.scadenza < oggiIso();

async function caricaTask({ silenzioso = false } = {}) {
  const giro = nuovoGiro('task');
  const dove = el('elenco-task');
  if (!silenzioso) { dove.className = 'vuoto'; dove.textContent = 'Carico…'; }
  try {
    const [dati] = await Promise.all([chiama('task/elenco', { fatteDaGiorni: GIORNI_FATTE }), filtroTask()]);
    if (!giroValido('task', giro)) return;
    tk.dati = dati;
    segnaFresco('task');
  } catch (err) {
    if (!giroValido('task', giro)) return;
    if (silenzioso) return lamenta(err.message);
    erroreCarico(dove, err, () => caricaTask());
    return;
  }
  disegnaTask();
}

function gruppoTask(t) {
  if (t.fatta) return 'Fatte negli ultimi giorni';
  if (!t.scadenza) return 'Senza scadenza';
  if (t.scadenza < oggiIso()) return 'In ritardo';
  if (t.scadenza === oggiIso()) return 'Oggi';
  if (t.scadenza <= traGiorni(7)) return 'Nei prossimi sette giorni';
  return 'Più avanti';
}
const ORDINE_GRUPPI = ['In ritardo', 'Oggi', 'Nei prossimi sette giorni', 'Più avanti', 'Senza scadenza', 'Fatte negli ultimi giorni'];

function filtriTaskHtml(id, voci, scelto, dato) {
  return voci.map(([k, nome]) =>
    `<button type="button" data-${dato}="${esc(k)}" aria-pressed="${String(k) === String(scelto)}">${esc(nome)}</button>`).join('');
}

function disegnaTask() {
  const dove = el('elenco-task');
  const { task, progetti, etichette } = tk.dati;
  el('filtro-task').innerHTML = filtriTaskHtml('filtro-task', FILTRI_TASK, tk.filtro, 'filtro-task');
  el('filtro-task').querySelectorAll('[data-filtro-task]').forEach(b => {
    b.onclick = () => {
      tk.filtro = b.dataset.filtroTask;
      if (tk.filtro !== 'fatte') { filtroTaskLetto = Promise.resolve(); scriviNotaUtente(FILTRO_TASK, tk.filtro); }
      disegnaTask();
    };
  });
  // Progetti ed etichette si mostrano solo se ce n'e' piu' di uno da scegliere.
  const usati = new Set(task.map(t => t.progetto.id));
  const progettiUsati = progetti.filter(p => usati.has(p.id));
  el('riga-progetto-task').hidden = progettiUsati.length < 2;
  el('progetto-task').innerHTML = filtriTaskHtml('progetto-task',
    [[0, 'Tutti'], ...progettiUsati.map(p => [p.id, p.nome])], tk.progetto, 'progetto-task');
  el('progetto-task').querySelectorAll('[data-progetto-task]').forEach(b => {
    b.onclick = () => { tk.progetto = Number(b.dataset.progettoTask); disegnaTask(); };
  });
  const etichetteUsate = etichette.filter(e => task.some(t => t.etichette.some(x => x.id === e.id)));
  el('riga-etichetta-task').hidden = !etichetteUsate.length;
  el('etichetta-task').innerHTML = filtriTaskHtml('etichetta-task',
    [[0, 'Tutte'], ...etichetteUsate.map(e => [e.id, e.nome])], tk.etichetta, 'etichetta-task');
  el('etichetta-task').querySelectorAll('[data-etichetta-task]').forEach(b => {
    b.onclick = () => { tk.etichetta = Number(b.dataset.etichettaTask); disegnaTask(); };
  });

  const scelte = task
    .filter(t => tk.filtro === 'fatte' ? t.fatta : !t.fatta)
    .filter(t => tk.filtro !== 'mie' || t.mia)
    .filter(t => !tk.progetto || t.progetto.id === tk.progetto)
    .filter(t => !tk.etichetta || t.etichette.some(e => e.id === tk.etichetta));
  const gruppi = new Map(ORDINE_GRUPPI.map(g => [g, []]));
  for (const t of scelte) gruppi.get(gruppoTask(t)).push(t);
  dove.className = '';
  if (!scelte.length) {
    dove.className = 'vuoto';
    dove.textContent = tk.filtro === 'mie' ? 'Non hai task aperte. Quelle di tutti sono in «Tutte».'
      : tk.filtro === 'fatte' ? `Nessuna task chiusa negli ultimi ${GIORNI_FATTE} giorni.`
      : 'Nessuna task aperta. Creane una con il +.';
    return;
  }
  dove.innerHTML = [...gruppi].filter(([, l]) => l.length).map(([g, lista]) => `
    <h2 class="giorno-gestione${g === 'In ritardo' ? ' ritardo' : ''}">${esc(g)}</h2>
    ${lista.map(rigaTask).join('')}`).join('');
  dove.querySelectorAll('[data-fatta]').forEach(b => { b.onclick = () => statoTask(Number(b.dataset.fatta), true, b); });
  dove.querySelectorAll('[data-riapri]').forEach(b => { b.onclick = () => statoTask(Number(b.dataset.riapri), false, b); });
  dove.querySelectorAll('[data-prendo]').forEach(b => { b.onclick = () => prendoTask(Number(b.dataset.prendo), b); });
  scorrevoli(dove, '.riga', {
    tocco: (riga) => apriTask(Number(riga.dataset.task)),
    menu: (riga) => apriTask(Number(riga.dataset.task)),
  });
}

function etichetteHtml(lista) {
  return lista.length ? `<div class="etichette-task">${lista.map(e =>
    `<span class="etichetta-task colore-${Number(e.colore) % 12}">${esc(e.nome)}</span>`).join('')}</div>` : '';
}

function rigaTask(t) {
  const persone = t.persone.length ? t.persone.map(p => p.nome.split(' ')[0]).join(', ') : 'nessuno';
  const dettagli = [
    t.voci.tutte ? `checklist ${t.voci.fatte}/${t.voci.tutte}` : '',
    t.foto ? `${t.foto} foto` : '',
    t.commenti ? `${t.commenti} ${t.commenti === 1 ? 'commento' : 'commenti'}` : '',
    t.ripete ? 'si ripete' : '',
  ].filter(Boolean).join(' · ');
  return `
    <div class="riga task-riga${t.fatta ? ' spento' : ''}" data-task="${t.id}">
      <div class="corpo-riga">
        <div class="pren-testa"><b>${esc(t.nome)}</b>${t.importante && !t.fatta ? '<span class="bollino importante">Importante</span>' : ''}</div>
        <div class="quando">${esc(t.progetto.nome)}${t.scadenza ? ` · <span class="${inRitardo(t) ? 'ritardo' : ''}">${esc(scadenzaTesto(t.scadenza))}</span>` : ''} · ${esc(persone)}</div>
        ${etichetteHtml(t.etichette)}
        ${dettagli ? `<div class="quando">${esc(dettagli)}</div>` : ''}
      </div>
      <div class="azioni sinistra">
        ${t.fatta ? `<button type="button" class="conferma" data-pieno data-riapri="${t.id}">Riapri</button>`
          : `<button type="button" class="libero" data-pieno data-fatta="${t.id}">Fatta</button>`}
      </div>
      ${!t.fatta && !t.mia ? `<div class="azioni">
        <button type="button" class="conferma" data-pieno data-prendo="${t.id}">Prendo io</button>
      </div>` : ''}
    </div>`;
}

// Aggiorna una task nell'elenco in memoria (dopo Prendo io, Fatta...).
function rimettiTask(t) {
  if (!tk.dati || !t) return;
  const i = tk.dati.task.findIndex(x => x.id === t.id);
  if (i >= 0) tk.dati.task[i] = t; else tk.dati.task.unshift(t);
}

async function statoTask(id, fatta, bottone) {
  if (bottone) bottone.disabled = true;
  try {
    const { task, prossima } = await chiama('task/stato', { taskId: id, fatta });
    rimettiTask(task);
    if (prossima) rimettiTask(prossima);
    tg?.HapticFeedback?.notificationOccurred('success');
    toast(fatta ? (prossima?.scadenza ? `Fatta. La prossima è per ${scadenzaTesto(prossima.scadenza)}.` : 'Fatta.') : 'Riaperta.');
    if (!el('pannello-task-scheda').hidden && tk.aperta?.id === id) apriTask(id, { silenzioso: true });
    else if (tk.dati) disegnaTask();
  } catch (err) {
    lamenta(err.message);
    if (bottone) bottone.disabled = false;
  }
}

async function prendoTask(id, bottone) {
  if (bottone) bottone.disabled = true;
  try {
    const { task } = await chiama('task/prendo', { taskId: id });
    rimettiTask(task);
    toast('Te ne occupi tu.');
    if (!el('pannello-task-scheda').hidden && tk.aperta?.id === id) apriTask(id, { silenzioso: true });
    else disegnaTask();
  } catch (err) {
    lamenta(err.message);
    if (bottone) bottone.disabled = false;
  }
}

// ------------------------------------------------------------------ scheda
async function apriTask(id, { silenzioso = false } = {}) {
  if (el('pannello-task-scheda').hidden) mostra('task-scheda');
  const giro = nuovoGiro('task-scheda');
  const dove = el('scheda-task');
  if (!silenzioso) { window.scrollTo(0, 0); dove.className = 'vuoto'; dove.textContent = 'Carico…'; }
  let t;
  try {
    ({ task: t } = await chiama('task/dettaglio', { taskId: id }));
  } catch (err) {
    if (giroValido('task-scheda', giro)) erroreCarico(dove, err, () => apriTask(id));
    return;
  }
  if (!giroValido('task-scheda', giro) || el('pannello-task-scheda').hidden) return;
  tk.aperta = t;
  rimettiTask(t);
  disegnaSchedaTask();
}

function disegnaSchedaTask() {
  const t = tk.aperta;
  const dove = el('scheda-task');
  const quando = (iso) => new Date(iso.replace(' ', 'T') + 'Z').toLocaleString('it-IT',
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const righe = [
    ['Progetto', esc(t.progetto.nome)],
    ['Scadenza', t.scadenza ? `<span class="${inRitardo(t) ? 'ritardo' : ''}">${esc(new Date(`${t.scadenza}T12:00:00`)
      .toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }))}</span>` : 'nessuna'],
    ['Chi se ne occupa', t.persone.length ? esc(t.persone.map(p => p.nome).join(', ')) : 'nessuno'],
    ...(t.ripete ? [['Si ripete', esc(RIPETE_TESTO[t.ripete])]] : []),
    ...(t.evento ? [['Per', esc([t.evento.titolo, t.evento.inizio ? `${giornoLungo(t.evento.inizio.replace(' ', 'T') + 'Z')}, ${oraBreve(t.evento.inizio.replace(' ', 'T') + 'Z')}` : '',
      t.evento.sede].filter(Boolean).join(' · '))]] : []),
    ...(t.fatta ? [['Fatta il', esc(dataTesto(t.chiusa_il))]] : []),
  ];
  dove.className = 'con-pagamento';
  dove.innerHTML = `
    <div class="testa-task">
      <h1>${esc(t.nome)}</h1>
      <button type="button" class="link" id="modifica-task">Modifica</button>
    </div>
    <p class="quando-quota">${t.creata_da ? `Creata da ${esc(t.creata_da)}` : ''}${t.importante ? `${t.creata_da ? ' · ' : ''}<span class="bollino importante">Importante</span>` : ''}</p>
    <div class="riepilogo">${righe.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
    ${etichetteHtml(t.etichette)}
    ${!t.fatta && !t.mia ? '<button type="button" class="bottone secondario largo" id="prendo-task">Prendo io</button>' : ''}
    ${t.descrizione ? `<p class="descrizione-task">${esc(t.descrizione)}</p>` : ''}

    <h2>Checklist</h2>
    <div id="checklist-task">${t.checklist.map(v => `
      <div class="riga voce-task${v.fatto ? ' fatta' : ''}">
        <span class="voce-spunta" role="checkbox" tabindex="0" aria-checked="${v.fatto}" data-spunta="${v.id}"><span class="spunta" aria-hidden="true"></span>${esc(v.nome)}</span>
        <button type="button" class="togli-incasso" data-togli-voce="${v.id}" aria-label="Togli ${esc(v.nome)}">×</button>
      </div>`).join('')}</div>
    <div class="riga-aggiungi">
      <input type="text" id="nuova-voce" maxlength="200" placeholder="Aggiungi una voce" autocomplete="off">
      <button type="button" class="bottone secondario" id="aggiungi-voce">Aggiungi</button>
    </div>

    <h2>Foto</h2>
    <div class="foto-task">${t.immagini.map(f => `
      <button type="button" class="miniatura" data-foto="${f.id}" aria-label="Apri la foto ${esc(f.nome)}"><img src="data:${esc(f.tipo)};base64,${f.dati}" alt=""></button>`).join('')}
      <button type="button" class="miniatura aggiungi-foto" id="aggiungi-foto-task" aria-label="Aggiungi una foto">+</button>
    </div>

    <h2>Commenti</h2>
    <div id="commenti-task">${t.messaggi.length ? t.messaggi.map(m => `
      <div class="commento-task"><div class="quando"><b>${esc(m.autore)}</b> · ${esc(quando(m.data))}</div><p>${esc(m.testo)}</p></div>`).join('')
      : '<p class="nota-pagamento">Ancora nessun commento.</p>'}</div>
    <div class="campo">
      <textarea id="nuovo-commento" maxlength="2000" placeholder="Scrivi un commento: lo legge chi se ne occupa."></textarea>
    </div>
    <button type="button" class="bottone secondario largo" id="invia-commento">Invia il commento</button>`;

  el('modifica-task').onclick = () => apriModuloTask(t);
  el('prendo-task')?.addEventListener('click', (e) => prendoTask(t.id, e.currentTarget));
  dove.querySelectorAll('[data-spunta]').forEach(s => {
    const fai = () => voceTask('spunta', { voceId: Number(s.dataset.spunta) });
    s.onclick = fai;
    s.onkeydown = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); fai(); } };
  });
  dove.querySelectorAll('[data-togli-voce]').forEach(b => {
    b.onclick = () => voceTask('togli', { voceId: Number(b.dataset.togliVoce) });
  });
  const aggiungi = () => {
    const testo = el('nuova-voce').value.trim();
    if (testo) voceTask('aggiungi', { testo });
  };
  el('aggiungi-voce').onclick = aggiungi;
  el('nuova-voce').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); aggiungi(); } };
  dove.querySelectorAll('[data-foto]').forEach(b => {
    b.onclick = () => {
      const f = t.immagini.find(x => String(x.id) === b.dataset.foto);
      if (f) apriFoglio(`<h2>${esc(f.nome)}</h2><img class="foto-grande" src="data:${esc(f.tipo)};base64,${f.dati}" alt="">`);
    };
  });
  el('aggiungi-foto-task').onclick = scegliFotoTask;
  el('invia-commento').onclick = commentaTask;

  azionePrincipale = () => statoTask(t.id, !t.fatta);
  pulsantePrincipale(t.fatta ? 'Riapri la task' : 'Segna come fatta', true);
}

async function voceTask(azione, dati) {
  const t = tk.aperta;
  try {
    const { checklist } = await chiama('task/voce', { taskId: t.id, azione, ...dati });
    t.checklist = checklist;
    t.voci = { fatte: checklist.filter(v => v.fatto).length, tutte: checklist.length };
    rimettiTask(t);
    // La voce appena scritta si svuota, e il campo resta pronto per la prossima.
    if (azione === 'aggiungi') el('nuova-voce').value = '';
    const tornato = ridisegnaTenendo(el('scheda-task'), disegnaSchedaTask);
    if (azione === 'aggiungi') { el('nuova-voce').value = ''; el('nuova-voce').focus(); }
    else tornato?.focus?.();
  } catch (err) {
    lamenta(err.message);
  }
}

async function commentaTask() {
  const t = tk.aperta;
  const testo = el('nuovo-commento').value.trim();
  if (!testo) return toast('Scrivi qualcosa.', false);
  el('invia-commento').disabled = true;
  try {
    await chiama('task/commenta', { taskId: t.id, testo });
    toast(t.persone.length ? 'Commento mandato a chi se ne occupa.' : 'Commento salvato.');
    apriTask(t.id, { silenzioso: true });
  } catch (err) {
    el('invia-commento').disabled = false;
    lamenta(err.message);
  }
}

// La foto si scatta (o si sceglie) e parte subito: e' una prova, non un
// documento da ritoccare. Si rimpicciolisce come quella delle restituzioni.
function scegliFotoTask() {
  const campo = el('foto-task');
  campo.value = '';
  campo.onchange = async () => {
    const file = campo.files[0];
    if (!file) return;
    let foto;
    try {
      foto = await rimpicciolisci(file, 1280);
    } catch {
      return lamenta('Non riesco a leggere questa foto: riprova.');
    }
    toast('Carico la foto…');
    try {
      await chiama('task/foto', { taskId: tk.aperta.id, foto });
      toast('Foto aggiunta.');
      apriTask(tk.aperta.id, { silenzioso: true });
    } catch (err) {
      lamenta(err.message);
    }
  };
  campo.click();
}

// ------------------------------------------------------------------ modulo
// Crea o cambia: nome, progetto, scadenza, se si ripete, chi se ne occupa,
// etichette, importante, l'attivita' del calendario, checklist (solo
// creando: dopo si cambia dalla scheda) e descrizione.
const SCADENZE = [['', 'Nessuna'], ['oggi', 'Oggi'], ['domani', 'Domani'], ['settimana', 'Fra una settimana'], ['data', 'Altro giorno']];
const RIPETIZIONI_TASK = [['', 'No'], ['settimana', 'Ogni settimana'], ['mese', 'Ogni mese']];

async function apriModuloTask(t = null) {
  const m = {
    id: t?.id || null,
    nome: t?.nome || '',
    progettoId: t?.progetto.id || tk.dati?.progetti[0]?.id || 0,
    scadenza: t?.scadenza || '',
    ripete: t?.ripete && t.ripete !== 'altro' ? t.ripete : '',
    persone: t ? t.persone.map(p => ({ ...p })) : (stato.mioSocio ? [{ id: stato.mioSocio.id, nome: stato.mioSocio.nome }] : []),
    etichette: new Set(t ? t.etichette.map(e => e.id) : []),
    etichetteNuove: [],
    importante: Boolean(t?.importante),
    evento: t?.evento || null,
    descrizione: t?.descrizione || '',
    checklist: '',
  };
  m.scelta = !m.scadenza ? '' : m.scadenza === oggiIso() ? 'oggi' : m.scadenza === traGiorni(1) ? 'domani'
    : m.scadenza === traGiorni(7) ? 'settimana' : 'data';
  tk.modulo = m;
  mostra('task-modulo');
  window.scrollTo(0, 0);
  el('chiudi-task-modulo').textContent = t ? '‹ La task' : '‹ Task';
  el('titolo-task-modulo').textContent = t ? 'Modifica la task' : 'Nuova task';
  if (!tk.dati) {
    el('modulo-task').className = 'vuoto';
    el('modulo-task').textContent = 'Carico…';
    try {
      tk.dati = await chiama('task/elenco', { fatteDaGiorni: GIORNI_FATTE });
      m.progettoId = m.progettoId || tk.dati.progetti[0]?.id || 0;
    } catch (err) {
      return erroreCarico(el('modulo-task'), err, () => apriModuloTask(t));
    }
  }
  // Le attivita' dei prossimi giorni, per collegarne una: le stesse delle
  // Prenotazioni dello staff. Se non arrivano il campo resta senza.
  if (!gestione.dati) chiama('staff/prenotazioni').then(d => { gestione.dati = d; if (tk.modulo === m) disegnaModuloTask(); }).catch(() => {});
  disegnaModuloTask();
}

function disegnaModuloTask() {
  const m = tk.modulo;
  const dove = el('modulo-task');
  const { progetti, etichette } = tk.dati;
  const prenotazioni = gestione.dati?.prenotazioni ? primeDelleSerie(gestione.dati.prenotazioni) : [];
  const chiaveEvento = (e) => `${e.sede}|${e.id}`;
  const html = `
    <div class="campo">
      <label for="task-nome">Cosa c’è da fare</label>
      <input type="text" id="task-nome" maxlength="200" value="${esc(m.nome)}" placeholder="Es. Comprare le lampadine della sala grande">
    </div>
    ${progetti.length > 1 ? `<p class="domanda">Progetto</p>
    <div class="scelte">${progetti.map(p =>
      `<button type="button" data-progetto="${p.id}" aria-pressed="${p.id === m.progettoId}">${esc(p.nome)}</button>`).join('')}</div>` : ''}
    <p class="domanda">Entro quando?</p>
    <div class="scelte">${SCADENZE.map(([k, nome]) =>
      `<button type="button" data-scadenza="${k}" aria-pressed="${k === m.scelta}">${nome}</button>`).join('')}</div>
    ${m.scelta === 'data' ? `<div class="campo"><input type="date" id="task-data" value="${esc(m.scadenza)}" min="${oggiIso()}"></div>` : ''}
    ${m.scadenza ? `<p class="domanda">Si ripete?</p>
    <div class="scelte">${RIPETIZIONI_TASK.map(([k, nome]) =>
      `<button type="button" data-ripete="${k}" aria-pressed="${k === m.ripete}">${nome}</button>`).join('')}</div>
    ${m.ripete ? '<p class="nota-pagamento">Quando la segni fatta, nasce la prossima con la scadenza spostata in avanti.</p>' : ''}` : ''}
    <p class="domanda">Chi se ne occupa?</p>
    <div class="campo-cerca-incasso">
      <input type="text" id="cerca-persona-task" placeholder="Scrivi un nome" autocomplete="off"
             role="combobox" aria-autocomplete="list" aria-controls="suggerimenti-task" aria-expanded="false">
      <div id="suggerimenti-task" class="suggerimenti-soci" role="listbox" aria-label="Persone" hidden></div>
    </div>
    <div class="etichette-task scelte-persone">${m.persone.map(p =>
      `<span class="persona-task">${esc(p.nome)}<button type="button" data-togli-persona="${p.id}" aria-label="Togli ${esc(p.nome)}">×</button></span>`).join('')
      || '<span class="nota-pagamento">Nessuno, per ora.</span>'}
      ${stato.mioSocio && !m.persone.some(p => p.id === stato.mioSocio.id) ? '<button type="button" class="link" id="anche-io">+ Io</button>' : ''}</div>
    <p class="domanda">Etichette</p>
    <div class="tipi">${etichette.map(e =>
      `<button type="button" data-etichetta="${e.id}" aria-pressed="${m.etichette.has(e.id)}">${esc(e.nome)}</button>`).join('')}
      ${m.etichetteNuove.map((n, i) => `<button type="button" data-etichetta-nuova="${i}" aria-pressed="true">${esc(n)} (nuova)</button>`).join('')}</div>
    <div class="riga-aggiungi">
      <input type="text" id="nuova-etichetta" maxlength="40" placeholder="Un’etichetta nuova" autocomplete="off">
      <button type="button" class="bottone secondario" id="aggiungi-etichetta">Aggiungi</button>
    </div>
    <div class="campo interruttore">
      <input type="checkbox" id="task-importante"${m.importante ? ' checked' : ''}>
      <div><label for="task-importante">Importante</label><small>Va in cima, con il bollino.</small></div>
    </div>
    ${prenotazioni.length || m.evento ? `<div class="campo">
      <label for="task-evento">Per un’attività <small>(facoltativa)</small></label>
      <select id="task-evento">
        <option value="">Nessuna</option>
        ${m.evento && !prenotazioni.some(p => chiaveEvento(p) === `${m.evento.sede}|${m.evento.id}`)
          ? `<option value="attuale" selected>${esc(m.evento.titolo)}</option>` : ''}
        ${prenotazioni.map(p => `<option value="${esc(chiaveEvento(p))}"${m.evento && `${m.evento.sede}|${m.evento.id}` === chiaveEvento(p) ? ' selected' : ''}>${esc(`${giornoBreve(p.inizio)} · ${p.titolo} · ${p.sedeNome}`)}</option>`).join('')}
      </select>
    </div>` : ''}
    ${m.id ? '' : `<div class="campo">
      <label for="task-checklist">Checklist <small>(facoltativa, una voce per riga)</small></label>
      <textarea id="task-checklist" maxlength="3000">${esc(m.checklist)}</textarea>
    </div>`}
    <div class="campo">
      <label for="task-descrizione">Note <small>(facoltative)</small></label>
      <textarea id="task-descrizione" maxlength="4000">${esc(m.descrizione)}</textarea>
    </div>`;
  ridisegnaTenendo(dove, () => { dove.className = 'con-pagamento'; dove.innerHTML = html; });

  // I campi di testo scrivono nel modulo a ogni tasto: un ridisegno non li perde.
  const leggi = (id, chiave) => { const c = el(id); if (c) c.oninput = () => { m[chiave] = c.value; aggiornaPulsanteTask(); }; };
  leggi('task-nome', 'nome');
  leggi('task-checklist', 'checklist');
  leggi('task-descrizione', 'descrizione');
  dove.querySelectorAll('[data-progetto]').forEach(b => { b.onclick = () => { m.progettoId = Number(b.dataset.progetto); disegnaModuloTask(); }; });
  dove.querySelectorAll('[data-scadenza]').forEach(b => {
    b.onclick = () => {
      m.scelta = b.dataset.scadenza;
      m.scadenza = { '': '', oggi: oggiIso(), domani: traGiorni(1), settimana: traGiorni(7) }[m.scelta] ?? (m.scadenza || traGiorni(2));
      if (!m.scadenza) m.ripete = '';
      disegnaModuloTask();
    };
  });
  el('task-data')?.addEventListener('change', (e) => { if (e.target.value) { m.scadenza = e.target.value; aggiornaPulsanteTask(); } });
  dove.querySelectorAll('[data-ripete]').forEach(b => { b.onclick = () => { m.ripete = b.dataset.ripete; disegnaModuloTask(); }; });
  dove.querySelectorAll('[data-togli-persona]').forEach(b => {
    b.onclick = () => { m.persone = m.persone.filter(p => p.id !== Number(b.dataset.togliPersona)); disegnaModuloTask(); };
  });
  el('anche-io')?.addEventListener('click', () => { m.persone.push({ id: stato.mioSocio.id, nome: stato.mioSocio.nome }); disegnaModuloTask(); });
  dove.querySelectorAll('[data-etichetta]').forEach(b => {
    b.onclick = () => {
      const id = Number(b.dataset.etichetta);
      m.etichette.has(id) ? m.etichette.delete(id) : m.etichette.add(id);
      disegnaModuloTask();
    };
  });
  dove.querySelectorAll('[data-etichetta-nuova]').forEach(b => {
    b.onclick = () => { m.etichetteNuove.splice(Number(b.dataset.etichettaNuova), 1); disegnaModuloTask(); };
  });
  const nuovaEtichetta = () => {
    const nome = el('nuova-etichetta').value.trim();
    if (!nome) return;
    const esistente = etichette.find(e => e.nome.toLowerCase() === nome.toLowerCase());
    if (esistente) m.etichette.add(esistente.id);
    else if (!m.etichetteNuove.some(n => n.toLowerCase() === nome.toLowerCase())) m.etichetteNuove.push(nome);
    el('nuova-etichetta').value = '';
    disegnaModuloTask();
  };
  el('aggiungi-etichetta').onclick = nuovaEtichetta;
  el('nuova-etichetta').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); nuovaEtichetta(); } };
  el('task-importante').onchange = (e) => { m.importante = e.target.checked; };
  el('task-evento')?.addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === 'attuale') return;
    const p = prenotazioni.find(x => `${x.sede}|${x.id}` === v);
    m.evento = p ? { titolo: p.titolo, inizio: p.inizio, sede: p.sedeNome, id: p.id } : null;
  });
  collegaCercaPersonaTask();
  aggiornaPulsanteTask();
}

function aggiornaPulsanteTask() {
  const m = tk.modulo;
  azionePrincipale = salvaTask;
  pulsantePrincipale(m.id ? 'Salva' : 'Crea la task', Boolean(m.nome.trim() && m.progettoId));
}

// Chi se ne occupa: i nomi arrivano da Odoo mentre si scrive.
let cercaPersonaTimer = null;
function collegaCercaPersonaTask() {
  const m = tk.modulo;
  const campo = el('cerca-persona-task');
  const lista = el('suggerimenti-task');
  let voci = [];
  let evidenziato = -1;
  const mostraLista = (nuove) => {
    voci = nuove.filter(p => !m.persone.some(x => x.id === p.id)).slice(0, 8);
    evidenziato = voci.length ? 0 : -1;
    lista.innerHTML = voci.map((p, i) => `
      <button type="button" role="option" id="persona-task-${i}" data-indice="${i}" aria-selected="${i === 0}">
        <b>${esc(p.nome)}</b><span>${p.numero_socio ? `#${esc(p.numero_socio)}` : ''}</span>
      </button>`).join('');
    lista.hidden = !voci.length;
    campo.setAttribute('aria-expanded', String(Boolean(voci.length)));
    lista.querySelectorAll('[data-indice]').forEach(b => {
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.onclick = () => aggiungi(Number(b.dataset.indice));
    });
  };
  const aggiungi = (i) => {
    const p = voci[i];
    if (!p) return;
    m.persone.push({ id: p.id, nome: p.nome });
    campo.value = '';
    disegnaModuloTask();
    el('cerca-persona-task')?.focus();
  };
  campo.addEventListener('input', () => {
    clearTimeout(cercaPersonaTimer);
    const testo = campo.value.trim();
    if (!testo) return mostraLista([]);
    cercaPersonaTimer = setTimeout(async () => {
      try {
        const { persone } = await chiama('task/persone', { testo });
        if (campo.isConnected && campo.value.trim() === testo) mostraLista(persone);
      } catch { /* si riprova al prossimo tasto */ }
    }, 250);
  });
  campo.addEventListener('keydown', (e) => {
    if (lista.hidden) return;
    const bottoni = [...lista.querySelectorAll('[data-indice]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      evidenziato = (evidenziato + (e.key === 'ArrowDown' ? 1 : -1) + bottoni.length) % bottoni.length;
      bottoni.forEach((b, j) => b.setAttribute('aria-selected', String(j === evidenziato)));
      campo.setAttribute('aria-activedescendant', bottoni[evidenziato].id);
    } else if (e.key === 'Enter') { e.preventDefault(); aggiungi(Math.max(0, evidenziato)); }
    else if (e.key === 'Escape') { e.preventDefault(); mostraLista([]); }
  });
}

async function salvaTask() {
  const m = tk.modulo;
  if (!m.nome.trim()) return toast('Scrivi cosa c’è da fare.', false);
  attesaAzione(true);
  try {
    const { task } = await chiama('task/salva', {
      taskId: m.id, nome: m.nome, progettoId: m.progettoId, scadenza: m.scadenza || null,
      ripete: m.ripete || null, importante: m.importante, persone: m.persone.map(p => p.id),
      etichette: [...m.etichette], etichetteNuove: m.etichetteNuove, evento: m.evento || null,
      descrizione: m.descrizione, checklist: m.checklist.split('\n').map(x => x.trim()).filter(Boolean),
    });
    attesaAzione(false);
    rimettiTask(task);
    // Le etichette nuove ora esistono: l'elenco si rilegge con le opzioni.
    tk.dati = null;
    tg?.HapticFeedback?.notificationOccurred('success');
    const altri = task.persone.filter(p => p.id !== stato.mioSocio?.id).length;
    toast(m.id ? 'Salvata.' : altri ? 'Creata: chi se ne occupa lo sa in chat.' : 'Creata.');
    apriTask(task.id);
  } catch (err) {
    attesaAzione(false);
    lamenta(err.message);
  }
}
