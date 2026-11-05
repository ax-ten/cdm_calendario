// La biblioteca: catalogo, ricerca, prestiti, prestiti a nome e prestiti
// dello staff.

// ------------------------------------------------------------- inventario
// Catalogo e prestiti stanno in Odoo; qui si sfoglia, si prende e si
// restituisce. Lo staff (gruppi staff o direttivo) vede anche chi ha cosa,
// prolunga i prestiti e aggiunge beni.
const inv = {
  pronto: false,
  staff: false,
  maxPrestiti: 1,
  giorni: 30,
  categorie: {},
  prestiti: [],
  offset: 0,
  totale: 0,
  generiScelti: new Set(),
  nuoviGeneri: [],
};

// Titoli e autori li scrive chi aggiunge i beni: passano da esc() (in cima).
const STATI_BENE = { disponibile: 'Disponibile', in_prestito: 'In prestito', mancante: 'Mancante' };

function dataTesto(iso) {
  if (!iso) return '';
  const [a, m, g] = iso.split('-').map(Number);
  return `${g} ${MESI[m - 1]}${a !== new Date().getFullYear() ? ' ' + a : ''}`;
}

async function apriInventario() {
  if (!inv.pronto) {
    // Due tocchi veloci sulla scheda non devono collegare tutto due volte
    // (e mettere due volte le sedi nel filtro): il secondo aspetta il primo.
    if (inv.caricando) return;
    el('elenco-beni').className = 'vuoto';
    el('elenco-beni').textContent = 'Carico…';
    let o;
    inv.caricando = true;
    try {
      o = await chiama('inventario/opzioni');
    } catch (err) {
      erroreCarico(el('elenco-beni'), err, apriInventario);
      return;
    } finally {
      inv.caricando = false;
    }
    inv.pronto = true;
    inv.staff = o.staff;
    inv.maxPrestiti = o.max_prestiti;
    inv.giorni = o.giorni_prestito;
    inv.prestiti = o.prestiti;
    inv.categorie = Object.fromEntries(o.categorie.map(c => [c.id, c.nome]));
    inv.opzioni = o;
    const opzioni = (lista) => lista.map(x => `<option value="${esc(x.id)}">${esc(x.nome)}</option>`).join('');
    el('filtro-sede').insertAdjacentHTML('beforeend', opzioni(o.sedi));
    disegnaTipi();
    el('apri-aggiungi').hidden = !inv.staff;

    collegaRicerca();
    for (const id of ['filtro-sede', 'filtro-genere', 'filtro-disponibili']) {
      el(id).addEventListener('change', () => cercaBeni(true));
    }
    el('ordine-beni').addEventListener('change', () => {
      el('campo-ordine').classList.toggle('attivo', el('ordine-beni').value !== 'popolari');
      el('icona-ordine').innerHTML = ICONE_ORDINE[el('ordine-beni').value] || ICONE_ORDINE.popolari;
      // Ogni volta che si sceglie "A caso" e' un'estrazione nuova.
      inv.seme = Math.floor(Math.random() * 1e9);
      cercaBeni(true);
    });
    el('altri-beni').onclick = () => cercaBeni(false);
    el('apri-aggiungi').onclick = apriAggiungi;
    inv.admin = Boolean(o.admin);
    el('apri-prestiti').hidden = !inv.admin;
    el('apri-prestiti').classList.toggle('secondo', !el('apri-aggiungi').hidden);
    el('apri-prestiti').onclick = () => { mostra('prestiti'); caricaPrestitiAdmin(); };
    el('chiudi-prestiti').onclick = () => mostra('inventario');
  }
  disegnaMioPrestito();
  if (inv.sedeIniziale) {
    const voce = [...el('filtro-sede').options].find(o => o.textContent.toLowerCase() === inv.sedeIniziale);
    if (voce) el('filtro-sede').value = voce.value;
    inv.sedeIniziale = null;
  }
  if (inv.tipoIniziale) { const t = inv.tipoIniziale; inv.tipoIniziale = null; return scegliTipo(t); }
  aggiornaFiltroGeneri();
  // Tornando dalla biblioteca appena vista l'elenco e' ancora quello: si
  // tiene, con il bene scelto e il suo pulsante.
  if (eFresco('inventario') && inv.filtriCercati === JSON.stringify(filtriBeni())) return aggiornaPrestito();
  cercaBeni(true);
}

// I generi che hanno i beni di queste categorie (nessuna: tutti). Il server
// li ricava dal catalogo; se non ci sono, si mostrano tutti.
function generiDi(categorie) {
  const mappa = inv.opzioni.generi_categoria;
  if (!mappa || !categorie.length) return inv.opzioni.generi;
  const ids = new Set(categorie.flatMap(c => mappa[c] || []));
  return inv.opzioni.generi.filter(g => ids.has(g.id));
}

// Il filtro del genere segue la categoria scelta: solo i generi che ci sono
// davvero, e se non ce n'e' nessuno (o non c'e' categoria) non si vede.
function aggiornaFiltroGeneri() {
  const t = TIPI.find(x => x.chiave === inv.tipo);
  const generi = t ? generiDi(t.categorie) : [];
  const campo = el('filtro-genere');
  const prima = campo.value;
  campo.innerHTML = '<option value="">Genere</option>' +
    generi.map(g => `<option value="${esc(g.id)}">${esc(g.nome)}</option>`).join('');
  campo.value = generi.some(g => String(g.id) === prima) ? prima : '';
  // Senza generi per quel tipo il filtro resta al suo posto, spento.
  campo.disabled = !generi.length;
}

function disegnaMioPrestito() {
  const dove = el('mio-prestito');
  if (!inv.prestiti.length) { dove.innerHTML = ''; return; }
  const oggi = iso(new Date());
  dove.innerHTML = inv.prestiti.map(p => {
    const scaduto = p.scadenza && p.scadenza < oggi;
    return `
      <div class="mio-prestito${scaduto ? ' scaduto' : ''}">
        <div class="bene-info">Il ${dataTesto(p.data_prestito)} hai preso in prestito</div>
        <b>${esc(p.titolo)}</b>
        <div class="scadenza">${scaduto
          ? `Scaduto il ${dataTesto(p.scadenza)}: riportalo a ${esc(p.sede)} appena puoi.`
          : `Da riportare a ${esc(p.sede)} entro il ${dataTesto(p.scadenza)}.`}</div>
        <p class="avviso-foto">Per restituirlo manda una foto del bene rimesso al suo posto.</p>
        <div class="azioni">
          <button type="button" class="bottone" data-restituisci="${esc(p.id)}">L’ho restituito</button>
        </div>
      </div>`;
  }).join('');
  dove.querySelectorAll('[data-restituisci]').forEach(b => {
    b.onclick = () => restituisci(Number(b.dataset.restituisci));
  });
}

// L'icona dell'ordinamento mostra l'ordine scelto. Lucide (ISC): barre che
// calano per i piu' presi, orologio per gli ultimi aggiunti, A-Z in colonna
// per titolo; per autore la stessa A-Z con una testolina al posto della
// freccia; a caso, la freccia con un punto interrogativo.
const ICONE_ORDINE = {
  popolari: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h10"/><path d="M11 8h7"/><path d="M11 12h4"/></svg>',
  recenti: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.338 21.994A10 10 0 1 1 21.925 13.227"/><path d="M12 6v6l2 1"/><path d="m14 18 4 4 4-4"/><path d="M18 14v8"/></svg>',
  titolo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M20 8h-5"/><path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10"/><path d="M15 14h5l-5 6h5"/></svg>',
  autore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6.5" cy="8" r="3"/><path d="M2 18a4.5 4.5 0 0 1 9 0"/><path d="M20 8h-5"/><path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10"/><path d="M15 14h5l-5 6h5"/></svg>',
  casuale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M14 7.5a3 3 0 1 1 4 2.8c-.8.4-1 .9-1 1.7V13"/><path d="M17 18h.01"/></svg>',
};

function filtriBeni() {
  return {
    testo: el('cerca-beni').value.trim(),
    sede_id: el('filtro-sede').value,
    categoria: TIPI.find(t => t.chiave === inv.tipo)?.categorie || [],
    genere_id: el('filtro-genere').value,
    solo_disponibili: el('filtro-disponibili').checked,
    bene_id: inv.beneId || '',
    autore: inv.autore || '',
  };
}

// ------------------------------------------------------------- ricerca
// L'elenco si aggiorna mentre si scrive, appena ci si ferma: niente tendina,
// che mostrava gli stessi beni una seconda volta.
function collegaRicerca() {
  const campo = el('cerca-beni');
  let attesa;
  campo.addEventListener('input', () => {
    clearTimeout(attesa);
    attesa = setTimeout(() => cercaBeni(true), 350);
  });
  campo.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(attesa);
    campo.blur();
    cercaBeni(true);
  });
}

let ricercaInCorso = 0;
async function cercaBeni(daCapo) {
  const mio = ++ricercaInCorso;
  if (daCapo) inv.offset = 0;
  const dove = el('elenco-beni');
  // Si parte da "Tutto", in ordine di quanto e' preso in prestito: aprendo
  // la biblioteca c'e' subito qualcosa da guardare.
  const f = filtriBeni();
  if (daCapo) { dove.className = 'vuoto'; dove.textContent = 'Carico…'; }
  el('altri-beni').disabled = true;
  try {
    const { beni, totale } = await chiama('inventario/catalogo',
      { filtri: f, offset: inv.offset, ordine: el('ordine-beni').value, seme: inv.seme || 0 });
    // Chi scrive veloce manda piu' ricerche: conta solo l'ultima.
    if (mio !== ricercaInCorso) return;
    if (daCapo) { segnaFresco('inventario'); inv.filtriCercati = JSON.stringify(f); }
    inv.totale = totale;
    inv.offset += beni.length;
    if (daCapo) { dove.className = ''; dove.innerHTML = ''; inv.beni = new Map(); sceglieBene(null); }
    for (const b of beni) inv.beni.set(b.id, b);
    if (!totale) nienteBeni(dove, f);
    dove.insertAdjacentHTML('beforeend', beni.map(schedaBene).join(''));
    collegaBottoni(dove);
    el('altri-beni').hidden = inv.offset >= totale;
  } catch (err) {
    if (mio === ricercaInCorso) erroreCarico(dove, err, () => cercaBeni(true));
  } finally {
    el('altri-beni').disabled = false;
  }
}

// Nessun risultato: si dice perche' (la ricerca guarda solo nella categoria
// scelta) e si offre di togliere i filtri. La parola cercata resta.
function nienteBeni(dove, f) {
  const tipo = TIPI.find(t => t.chiave === inv.tipo);
  const filtri = (tipo && tipo.chiave !== 'tutto') || f.sede_id || f.genere_id || f.solo_disponibili;
  dove.className = 'vuoto';
  dove.innerHTML = html`<p class="vuoto-testo">${f.testo ? `Niente per «${f.testo}»` : 'Niente'}${filtri ? ' con questi filtri' : ''}.${
    f.testo && tipo && tipo.chiave !== 'tutto' ? ` La ricerca guarda solo tra: ${tipo.nome}.` : ''}</p>
    ${filtri ? html`<button type="button" class="bottone secondario" data-azzera-filtri>Azzera i filtri</button>` : ''}`;
  const azzera = dove.querySelector('[data-azzera-filtri]');
  if (azzera) azzera.onclick = () => {
    el('filtro-sede').value = '';
    el('filtro-disponibili').checked = false;
    el('filtro-genere').value = '';
    scegliTipo('tutto');
  };
}

// "Tutto" per primo: e' la scelta di partenza, e a 390px non va a capo da
// solo sulla seconda riga.
const TIPI = [
  { chiave: 'tutto', nome: 'Tutto', categorie: [] },
  { chiave: 'libri', nome: 'Libri', categorie: ['libro'] },
  { chiave: 'giochi', nome: 'Giochi', categorie: ['gioco_da_tavolo'] },
  { chiave: 'gdr', nome: 'Manuali', categorie: ['gioco_di_ruolo', 'manuale'] },
  { chiave: 'altro', nome: 'Altro', categorie: ['altro'] },
];

function disegnaTipi() {
  inv.tipo = inv.tipo || 'tutto';
  el('tipi-beni').innerHTML = TIPI.map(t =>
    `<button type="button" data-tipo="${t.chiave}" aria-pressed="${t.chiave === inv.tipo}">${t.nome}</button>`
  ).join('');
  // Toccare la categoria gia' scelta la toglie: si torna a "Tutto".
  el('tipi-beni').querySelectorAll('button').forEach(b => {
    b.onclick = () => scegliTipo(inv.tipo === b.dataset.tipo ? 'tutto' : b.dataset.tipo);
  });
}

function scegliTipo(chiave, cerca = true) {
  inv.tipo = chiave;
  aggiornaFiltroGeneri();
  el('tipi-beni').querySelectorAll('button').forEach(b => {
    const si = b.dataset.tipo === chiave;
    b.setAttribute('aria-pressed', String(si));
    if (si) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  if (cerca) cercaBeni(true);
}

function schedaBene(b) {
  const riga1 = [b.autore, [b.editore, b.anno].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  const riga2 = [inv.tipo === 'tutto' || inv.tipo === 'gdr' ? inv.categorie[b.categoria] : '',
                 b.sistema, b.sede, b.generi.join(', ')].filter(Boolean).join(' · ');
  return `
    <div class="bene" role="button" tabindex="0" aria-pressed="false" data-bene="${esc(b.id)}">
      <div class="bene-testa">
        <b>${esc(b.titolo)}</b>
        ${b.stato === 'disponibile' ? '' : `<span class="stato stato-${esc(b.stato)}">${STATI_BENE[b.stato] || esc(b.stato)}</span>`}
      </div>
      ${riga1 ? `<div class="bene-info">${esc(riga1)}</div>` : ''}
      <div class="bene-info">${esc(riga2)}</div>
    </div>`;
}

function collegaBottoni(dove) {
  dove.querySelectorAll('.bene[data-bene]:not([data-collegato])').forEach(scheda => {
    scheda.dataset.collegato = '1';
    const id = Number(scheda.dataset.bene);
    scheda.onclick = () => {
      // Dopo uno swipe non si sceglie; con la scheda aperta, il tocco la chiude.
      if (scheda.dataset.appenaScorsa) return;
      const scatola = scheda.closest('.scorri');
      if (scatola?._lato) return apriScorri(scatola, false);
      sceglieBene(inv.scelto === id ? null : id);
    };
    scheda.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); scheda.click(); } };
    // Chi amministra la biblioteca trascina la scheda verso destra e trova
    // "Modifica": apre lo stesso modulo dell'aggiunta, sede compresa. Per
    // gli altri la scheda non si sposta.
    if (inv.admin) {
      const azioni = document.createElement('div');
      azioni.className = 'azioni sinistra';
      azioni.innerHTML = '<button type="button" class="conferma" data-pieno data-icona="modifica">Modifica</button>';
      azioni.querySelector('button').onclick = () => { chiudiScorri(scheda); apriModifica(id); };
      scheda.append(azioni);
    }
  });
  if (inv.admin) {
    // Il tocco sceglie il bene (lo fa gia' la scheda); Modifica si trova
    // scorrendo, o nel menu della scheda: pressione lunga, tasto destro,
    // Maiusc+F10.
    scorrevoli(dove, '.bene[data-bene]', { tocco: () => {}, menu: menuDellaRiga,
      aiuto: 'Tocca per sceglierlo, tieni premuto per le altre azioni.' });
    dove.querySelectorAll('.scorri:not(.di-bene)').forEach(s => { if (s.querySelector(':scope > .bene')) s.classList.add('di-bene'); });
  }
  dove.querySelectorAll('[data-prolunga]').forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); prolunga(Number(b.dataset.prolunga), b); };
  });
}


// Chi amministra segna che un bene l'ha preso qualcun altro: si scrive il
// nome, e se e' unə sociə la si sceglie dai suggerimenti, cosi' il prestito
// va sulla sua scheda. Altrimenti resta solo il nome.
const aNome = { bene: null, scelto: null, attesa: null, giro: 0, evidenziato: -1, lista: [] };

function apriPrestatoA(beneId) {
  const b = inv.beni?.get(beneId);
  if (!b) return;
  aNome.bene = b;
  aNome.scelto = null;
  el('a-nome-titolo').textContent = `“${b.titolo}”, a ${b.sede}.`;
  el('a-nome').value = '';
  mostraSuggerimentiSoci([]);
  cercaSociANome(0);
  el('a-nome-conferma').disabled = false;
  if (el('foglio-a-nome').hidden) {
    el('foglio-a-nome').hidden = false;
    aNome.rilascia = trattieniFuoco(el('foglio-a-nome'), el('foglio-a-nome').querySelector('.foglio'), chiudiPrestatoA);
  }
  setTimeout(() => el('a-nome').focus(), 50);
}

function chiudiPrestatoA() {
  if (el('foglio-a-nome').hidden) return;
  el('foglio-a-nome').hidden = true;
  el('a-nome').blur();
  const rilascia = aNome.rilascia;
  aNome.rilascia = null;
  rilascia?.();
}

// L'elenco sotto il campo: si apre appena arrivano nomi, si chiude quando
// se ne sceglie uno o non ce ne sono. Toccare un nome lo mette nel campo e
// collega il prestito alla sua scheda; riscrivere il nome lo scollega.
function mostraSuggerimentiSoci(soci) {
  aNome.lista = soci;
  aNome.evidenziato = -1;
  const dove = el('a-nome-soci');
  dove.innerHTML = soci.map((s, i) => `
    <button type="button" role="option" id="a-nome-soci-${i}" data-indice="${i}" aria-selected="false">
      <b>${esc(s.nome)}</b><span>${s.numero_socio ? '#' + esc(s.numero_socio) : ''}</span>
    </button>`).join('');
  dove.hidden = !soci.length;
  el('a-nome').setAttribute('aria-expanded', String(Boolean(soci.length)));
  el('a-nome').removeAttribute('aria-activedescendant');
  dove.querySelectorAll('[data-indice]').forEach(b => {
    // pointerdown: senza, il campo perde il fuoco e la tastiera si chiude
    // e riapre a ogni tocco.
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.onclick = () => scegliSocio(Number(b.dataset.indice));
  });
}

function scegliSocio(i) {
  const s = aNome.lista[i];
  if (!s) return;
  el('a-nome').value = s.nome;
  aNome.scelto = { id: s.id, nome: s.nome };
  clearTimeout(aNome.attesa);
  aNome.giro += 1;
  mostraSuggerimentiSoci([]);
}

function evidenziaSocio(i) {
  const bottoni = [...el('a-nome-soci').querySelectorAll('[data-indice]')];
  if (!bottoni.length) return;
  aNome.evidenziato = (i + bottoni.length) % bottoni.length;
  bottoni.forEach((b, j) => b.setAttribute('aria-selected', String(j === aNome.evidenziato)));
  bottoni[aNome.evidenziato].scrollIntoView({ block: 'nearest' });
  el('a-nome').setAttribute('aria-activedescendant', bottoni[aNome.evidenziato].id);
}

// L'elenco e' aperto da subito, a meta' schermo: con il campo vuoto ci sono
// i nomi in ordine, e si puo' scorrere e toccare senza scrivere niente.
function cercaSociANome(attesa = 250) {
  clearTimeout(aNome.attesa);
  const testo = el('a-nome').value.trim();
  if (aNome.scelto && aNome.scelto.nome !== testo) aNome.scelto = null;
  // Le risposte che arrivano dopo una lettera nuova non valgono piu'.
  const giro = ++aNome.giro;
  aNome.attesa = setTimeout(async () => {
    try {
      const { soci } = await chiama('inventario/admin/soci', { testo });
      if (giro !== aNome.giro) return;
      // Gia' scelto e uguale: non c'e' niente da riproporre.
      mostraSuggerimentiSoci(aNome.scelto ? [] : soci);
    } catch { /* i suggerimenti sono un aiuto: se non arrivano si scrive */ }
  }, attesa);
}
el('a-nome').addEventListener('input', () => cercaSociANome());
el('a-nome').addEventListener('keydown', (e) => {
  if (el('a-nome-soci').hidden) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); evidenziaSocio(aNome.evidenziato + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); evidenziaSocio(aNome.evidenziato - 1); }
  else if (e.key === 'Enter' && aNome.evidenziato >= 0) { e.preventDefault(); scegliSocio(aNome.evidenziato); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); mostraSuggerimentiSoci([]); }
});
el('a-nome-annulla').onclick = chiudiPrestatoA;
el('azione-a-nome').onclick = () => inv.scelto && apriPrestatoA(inv.scelto);
el('foglio-a-nome').addEventListener('click', (e) => { if (e.target === el('foglio-a-nome')) chiudiPrestatoA(); });
el('a-nome-conferma').onclick = async () => {
  const nome = el('a-nome').value.trim();
  if (!nome) return toast('Scrivi chi l’ha preso.', false);
  el('a-nome-conferma').disabled = true;
  try {
    const { prestito } = await chiama('inventario/admin/presta',
      { beneId: aNome.bene.id, nome, partnerId: aNome.scelto?.nome === nome ? aNome.scelto.id : null });
    chiudiPrestatoA();
    toast(`Segnato: “${prestito.titolo}” l’ha preso ${prestito.socio}.`);
    cercaBeni(true);
  } catch (err) {
    el('a-nome-conferma').disabled = false;
    lamenta(err.message);
  }
};

// Toccare un bene lo sceglie (toccarlo di nuovo lo lascia), e in fondo
// compare il pulsante per prenderlo, o il motivo per cui non si puo'.
function sceglieBene(id) {
  inv.scelto = id;
  el('elenco-beni').querySelectorAll('.bene[data-bene]').forEach(s => {
    const si = Number(s.dataset.bene) === id;
    s.classList.toggle('scelto', si);
    s.setAttribute('aria-pressed', String(si));
  });
  aggiornaPrestito();
}

function aggiornaPrestito() {
  const b = inv.scelto && inv.beni?.get(inv.scelto);
  const visibile = Boolean(b) && !el('pannello-inventario').hidden;
  let testo = 'Prendi in prestito', attivo = true;
  if (b && b.stato === 'in_prestito') { testo = 'Già in prestito'; attivo = false; }
  else if (b && b.stato === 'mancante') { testo = 'Risulta mancante'; attivo = false; }
  else if (b && inv.prestiti.length >= inv.maxPrestiti) { testo = 'Porta indietro il tuo prestito!'; attivo = false; }

  if (visibile) pulsantePrincipale(testo, attivo); else nascondiAzione();
  // Chi amministra, su un bene disponibile, ha anche "Segna come prestato".
  const aNomeVisibile = visibile && inv.admin && b.stato === 'disponibile';
  el('azione-a-nome').hidden = !aNomeVisibile;
  document.body.classList.toggle('due-azioni', aNomeVisibile);
  // Il + sta dove sta il pulsante del prestito: si vede solo senza un bene scelto.
  el('apri-aggiungi').hidden = !inv.staff || Boolean(b);
  el('apri-prestiti').hidden = !inv.admin || Boolean(b);
  el('apri-prestiti').classList.toggle('secondo', !el('apri-aggiungi').hidden);
}

async function prendiScelto() {
  const b = inv.scelto && inv.beni?.get(inv.scelto);
  if (!b || b.stato !== 'disponibile' || inv.prestiti.length >= inv.maxPrestiti) return;
  // Niente domanda prima: c'e' il toast con Annulla dopo, che basta e
  // costa un tocco in meno. Il toast dice anche dove e quando riportarlo.
  const entro = new Date(); entro.setDate(entro.getDate() + inv.giorni);
  attesaAzione(true);
  try {
    const { prestito } = await chiama('inventario/presta', { beneId: b.id });
    inv.prestiti = [prestito];
    tg?.HapticFeedback?.notificationOccurred('success');
    toastAnnulla(`Preso in prestito: «${b.titolo}». Riportalo a ${b.sede} entro il ${dataTesto(prestito.scadenza || iso(entro))}.`, async () => {
      try {
        await chiama('inventario/annulla-prestito', { prestitoId: prestito.id });
        inv.prestiti = [];
        disegnaMioPrestito();
        cercaBeni(true);
        toast('Prestito annullato.');
      } catch (err) {
        lamenta(err.message);
      }
    });
    disegnaMioPrestito();
    window.scrollTo(0, 0);
    cercaBeni(true);
  } catch (err) {
    lamenta(err.message);
    aggiornaPrestito();
  } finally {
    attesaAzione(false);
  }
}

// Si restituisce con una foto del bene rimesso al suo posto: la vede lo
// staff della sede, ed e' l'unica prova che e' tornato davvero.
let fotoPerPrestito = null;

function restituisci(prestitoId) {
  fotoPerPrestito = prestitoId;
  const campo = el('foto-restituzione');
  campo.value = '';
  campo.onchange = () => campo.files[0] && preparaFoto(campo.files[0]);
  campo.click();
}

// Una foto del telefono pesa diversi MB: la si rimpicciolisce qui, prima di
// mandarla. Al gruppo staff basta vedere il bene sullo scaffale.
async function rimpicciolisci(file, lato = 1600) {
  let immagine;
  try {
    immagine = await createImageBitmap(file);
  } catch {
    immagine = await new Promise((ok, ko) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = ko;
      img.src = URL.createObjectURL(file);
    });
  }
  const scala = Math.min(1, lato / Math.max(immagine.width, immagine.height));
  const tela = document.createElement('canvas');
  tela.width = Math.round(immagine.width * scala);
  tela.height = Math.round(immagine.height * scala);
  tela.getContext('2d').drawImage(immagine, 0, 0, tela.width, tela.height);
  return tela.toDataURL('image/jpeg', 0.8);
}

async function preparaFoto(file) {
  let foto;
  try {
    foto = await rimpicciolisci(file);
  } catch {
    return lamenta('Non riesco a leggere questa foto: riprova.');
  }
  el('foto-scelta').src = foto;
  el('anteprima-foto').hidden = false;
  el('rifai-foto').onclick = () => {
    el('anteprima-foto').hidden = true;
    restituisci(fotoPerPrestito);
  };
  el('invia-foto').disabled = false;
  el('invia-foto').onclick = async () => {
    el('invia-foto').disabled = true;
    try {
      await chiama('inventario/restituisci', { prestitoId: fotoPerPrestito, foto });
      inv.prestiti = inv.prestiti.filter(p => p.id !== fotoPerPrestito);
      el('anteprima-foto').hidden = true;
      tg?.HapticFeedback?.notificationOccurred('success');
      toast('Grazie! Lo staff ha la foto, ora è di nuovo disponibile.');
      disegnaMioPrestito();
      cercaBeni(true);
    } catch (err) {
      el('invia-foto').disabled = false;
      lamenta(err.message);
    }
  };
}

// Chi amministra la biblioteca vede tutti i prestiti in corso, prima quelli
// in ritardo, e li chiude o li prolunga. In cima quanti sono e quanti in
// ritardo (i numeri sono sui filtri); il filtro parte da "In ritardo" quando ce n'e' qualcuno, perche'
// sono quelli di cui occuparsi. Accanto al titolo, se la persona ha
// Telegram collegato (e uno username), un pulsante apre la sua chat; se
// no c'e' l'icona barrata, che toccata dice perche' la chat non si apre.
const prestitiAdmin = { lista: null, filtro: null };
// lucide: message-circle-off, per chi non ha uno username: la chat non si apre.
const ICONA_CHAT_NO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 2 20 20"/><path d="M4.93 4.929a10 10 0 0 0-1.938 11.412 2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 0 0 11.302-1.989"/><path d="M8.35 2.69A10 10 0 0 1 21.3 15.65"/></svg>';
// lucide: message-circle
const ICONA_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';

async function caricaPrestitiAdmin() {
  const giro = nuovoGiro('prestiti');
  const dove = el('elenco-prestiti');
  dove.className = 'vuoto';
  dove.textContent = 'Carico…';
  try {
    const { prestiti } = await chiama('inventario/admin/prestiti');
    if (!giroValido('prestiti', giro)) return;
    prestitiAdmin.lista = prestiti.sort((a, b) => (b.giorni_ritardo || 0) - (a.giorni_ritardo || 0)
      || String(a.scadenza || '9').localeCompare(String(b.scadenza || '9')));
  } catch (err) {
    if (!giroValido('prestiti', giro)) return;
    el('filtro-prestiti').hidden = true;
    erroreCarico(dove, err, caricaPrestitiAdmin);
    return;
  }
  await sedeGestione();
  if (!giroValido('prestiti', giro)) return;
  if (!prestitiAdmin.filtro) prestitiAdmin.filtro = prestitiAdmin.lista.some(p => p.giorni_ritardo) ? 'ritardo' : 'tutti';
  disegnaPrestitiAdmin();
}

function disegnaPrestitiAdmin() {
  const dove = el('elenco-prestiti');
  // La sede e' la stessa scelta delle Prenotazioni, ricordata per persona.
  // Qui la sede arriva da Odoo col suo nome: si confronta il nome.
  const sedi = stato.sediInfo || [];
  el('sede-prestiti').hidden = sedi.length < 2;
  el('sede-prestiti').innerHTML = [['', 'Tutte'], ...sedi.map(x => [x.slug, x.nome])].map(([k, nome]) =>
    `<button type="button" data-sede-prestiti="${esc(k)}" aria-pressed="${k === gestione.sede}">${esc(nome)}</button>`).join('');
  el('sede-prestiti').querySelectorAll('[data-sede-prestiti]').forEach(b => {
    b.onclick = () => {
      gestione.sede = b.dataset.sedePrestiti;
      sedeGestioneLetta = Promise.resolve(gestione.sede);
      scriviNotaUtente(SEDE_GESTIONE, gestione.sede);
      disegnaPrestitiAdmin();
    };
  });
  const nomeScelta = sedi.find(x => x.slug === gestione.sede)?.nome;
  const tutti = prestitiAdmin.lista.filter(p => !nomeScelta
    || String(p.sede).toLowerCase() === nomeScelta.toLowerCase());
  const inRitardo = tutti.filter(p => p.giorni_ritardo);
  el('filtro-prestiti').hidden = !tutti.length;
  el('filtro-prestiti').innerHTML = [['tutti', 'Tutti'], ['ritardo', 'In ritardo']]
    .map(([k, nome]) => `<button type="button" data-filtro-prestiti="${k}" aria-pressed="${k === prestitiAdmin.filtro}">${nome}</button>`).join('');
  el('filtro-prestiti').querySelectorAll('[data-filtro-prestiti]').forEach(b => {
    b.onclick = () => { prestitiAdmin.filtro = b.dataset.filtroPrestiti; disegnaPrestitiAdmin(); };
  });
  const prestiti = prestitiAdmin.filtro === 'ritardo' ? inRitardo : tutti;
  if (!prestiti.length) {
    dove.className = 'vuoto';
    dove.textContent = tutti.length ? 'Nessun prestito in ritardo.' : 'Nessun prestito in corso.';
    return;
  }
  dove.className = '';
  dove.innerHTML = prestiti.map(p => `
    <div class="riga">
      <div class="testa-prestito">
        <b>${esc(p.titolo)}</b>
        ${p.username ? `<button type="button" class="icona-chat" data-chat="${esc(p.username)}" aria-label="Scrivi a ${esc(p.socio)} in chat" title="Scrivi in chat">${ICONA_CHAT}</button>`
          : `<button type="button" class="icona-chat spenta" data-senza-chat="${esc(p.socio)}" aria-disabled="true" aria-label="Chat non disponibile: ${esc(p.socio)} non ha uno username Telegram" title="Senza username Telegram">${ICONA_CHAT_NO}</button>`}
      </div>
      <div class="quando">${esc(p.socio)} · ${esc(p.sede)} · dal ${dataTesto(p.data_prestito)}</div>
      <div class="quando${p.giorni_ritardo ? ' ritardo' : ''}">${p.giorni_ritardo
        ? `In ritardo di ${p.giorni_ritardo} ${p.giorni_ritardo === 1 ? 'giorno' : 'giorni'}`
        : p.scadenza ? `Da riportare entro il ${dataTesto(p.scadenza)}` : 'Senza scadenza'}</div>
      <div class="azioni a-destra" data-azioni>
        <button type="button" class="grave" data-pieno data-icona="restituito" data-chiudi="${esc(p.id)}" data-titolo="${esc(p.titolo)}" data-socio="${esc(p.socio)}">Chiudi prestito</button>
      </div>
      <div class="azioni sinistra">
        <button type="button" class="conferma" data-pieno data-icona="estendi" data-apri-prolunga>Estendi</button>
      </div>
      ${p.username ? `<div class="azioni solo-menu" hidden>
        <button type="button" data-icona="chat" data-chat="${esc(p.username)}">Scrivi in chat</button>
      </div>` : ''}
      <div class="azioni a-destra prolunga" data-prolunga-di="${esc(p.id)}" hidden>
        <div class="contagiorni">
          <button type="button" data-meno aria-label="Un giorno in meno">−</button>
          <input type="number" inputmode="numeric" min="1" max="365" value="${esc(inv.giorni)}" aria-label="Giorni in piu'">
          <span class="unita">gg</span>
          <button type="button" data-piu aria-label="Un giorno in piu'">+</button>
        </div>
        <button type="button" data-annulla-prolunga>Annulla</button>
        <button type="button" class="conferma" data-conferma-prolunga>Estendi</button>
      </div>
    </div>`).join('');
  dove.querySelectorAll('[data-chat]').forEach(b => {
    b.onclick = () => {
      const link = `https://t.me/${b.dataset.chat}`;
      if (tg?.openTelegramLink) tg.openTelegramLink(link); else window.open(link, '_blank');
    };
  });
  dove.querySelectorAll('[data-senza-chat]').forEach(b => {
    b.onclick = () => toast(`${b.dataset.senzaChat} non ha uno username Telegram: la chat non si può aprire da qui.`, false);
  });
  dove.querySelectorAll('[data-chiudi]').forEach(b => {
    b.onclick = () => chiudiPrestito(Number(b.dataset.chiudi), b.dataset.titolo, b.dataset.socio, b);
  });
  // "Prolunga" apre, sulla riga, la scelta dei giorni: meno e piu', o scritti.
  dove.querySelectorAll('.riga').forEach(riga => {
    const scelta = riga.querySelector('[data-prolunga-di]');
    const giorni = scelta.querySelector('input');
    const vale = () => Math.min(365, Math.max(1, Number(giorni.value) || inv.giorni));
    riga.querySelector('[data-apri-prolunga]').onclick = () => { scelta.hidden = false; chiudiScorri(riga); };
    scelta.querySelector('[data-annulla-prolunga]').onclick = () => { scelta.hidden = true; };
    scelta.querySelector('[data-meno]').onclick = () => { giorni.value = Math.max(1, vale() - 1); };
    scelta.querySelector('[data-piu]').onclick = () => { giorni.value = Math.min(365, vale() + 1); };
    scelta.querySelector('[data-conferma-prolunga]').onclick = (e) =>
      prolunga(Number(scelta.dataset.prolungaDi), vale(), e.currentTarget);
  });
  scorrevoli(dove, '.riga', { tocco: menuDellaRiga, menu: menuDellaRiga });
}

async function chiudiPrestito(prestitoId, titolo, socio, bottone) {
  // Basta il nome: chi amministra sa di chi si parla, e la domanda resta corta.
  const nome = String(socio || '').trim().split(/\s+/)[0];
  if (!await conferma(`Chiudo il prestito di ${nome}?`)) return;
  bottone.disabled = true;
  try {
    await chiama('inventario/admin/chiudi', { prestitoId });
    toast('Prestito chiuso.');
    caricaPrestitiAdmin();
  } catch (err) {
    bottone.disabled = false;
    lamenta(err.message);
  }
}

async function prolunga(prestitoId, giorni, bottone) {
  bottone.disabled = true;
  try {
    const { prestito } = await chiama('inventario/prolunga', { prestitoId, giorni });
    toast(`Esteso: ora scade il ${dataTesto(prestito.scadenza)}.`);
    caricaPrestitiAdmin();
  } catch (err) {
    bottone.disabled = false;
    lamenta(err.message);
  }
}
