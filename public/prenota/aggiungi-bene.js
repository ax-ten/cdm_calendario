// Aggiunta dei beni (staff): scanner del codice a barre, ISBN, modulo.

// ------------------------------------------------- aggiunta beni (staff)
// La fotocamera legge il codice a barre: dove il browser lo sa fare da
// solo (BarcodeDetector, Chrome e il WebView di Android) con quello, altrove
// (iPhone) con ZXing, che si carica solo in quel momento. Se la fotocamera
// non si apre, l'ISBN si scrive a mano.
const SI_SCANSIONA = Boolean(navigator.mediaDevices?.getUserMedia);
const LETTORE_NATIVO = 'BarcodeDetector' in window;
let formAggiungiPronto = false;

function preparaFormBene() {
  if (!formAggiungiPronto) {
    const o = inv.opzioni;
    const opzioni = (lista) => lista.map(x => `<option value="${esc(x.id)}">${esc(x.nome)}</option>`).join('');
    el('agg-categoria').innerHTML = opzioni(o.categorie);
    el('agg-categoria').value = 'libro';
    el('agg-sede').innerHTML = opzioni(o.sedi);
    el('agg-sistema').insertAdjacentHTML('beforeend', opzioni(o.sistemi));
    el('agg-categoria').onchange = aggiornaCategoria;
    el('scansiona-isbn').hidden = !SI_SCANSIONA;
    el('scansiona-isbn').onclick = scansiona;
    el('cerca-isbn').onclick = cercaIsbn;
    el('agg-isbn').addEventListener('keydown', e => { if (e.key === 'Enter') cercaIsbn(); });
    el('aggiungi-genere').onclick = aggiungiGenere;
    el('agg-nuovo-genere').oninput = suggerisciGeneri;
    el('agg-nuovo-genere').onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      // Invio: il primo suggerito se c'e', se no il nome scritto.
      const primo = el('agg-generi-suggeriti').querySelector('[data-genere-esistente]');
      if (primo && !el('agg-generi-suggeriti').hidden) primo.click(); else aggiungiGenere();
    };
    el('chiudi-aggiungi').onclick = () => (inv.passoBene === 2 ? passoBene(1) : mostra('inventario'));
    formAggiungiPronto = true;
  }
}

const CAMPI_FORM_BENE = ['agg-isbn', 'agg-titolo', 'agg-autore', 'agg-editore', 'agg-anno',
                         'agg-codice', 'agg-valore', 'agg-proprietario', 'agg-note', 'agg-nuovo-sistema'];

function svuotaFormBene() {
  for (const id of CAMPI_FORM_BENE) el(id).value = '';
  el('agg-sistema').value = '';
  el('agg-mancante').checked = false;
  inv.generiScelti.clear();
  inv.nuoviGeneri = [];
  esitoIsbn('');
}

// I due passi del form. Al secondo si passa solo con un titolo: e' l'unico
// dato che serve davvero, e chi cataloga deve vedere cosa sta catalogando.
function passoBene(n) {
  if (n === 2 && !el('agg-titolo').value.trim()) {
    lamenta('Manca il titolo.');
    el('agg-titolo').focus();
    return;
  }
  inv.passoBene = n;
  document.querySelectorAll('[data-passo-bene-corpo]').forEach(c => { c.hidden = Number(c.dataset.passoBeneCorpo) !== n; });
  el('titolo-aggiungi').textContent = n === 1 ? 'Il bene' : 'Catalogazione';
  el('chiudi-aggiungi').textContent = n === 1 ? '‹ Biblioteca' : '‹ Indietro';
  el('avanzamento-bene-pieno').style.width = `${n / 2 * 100}%`;
  el('avanzamento-bene').setAttribute('aria-valuenow', String(n));
  el('avanzamento-bene').setAttribute('aria-valuetext', `Passo ${n} di 2`);
  // Il primo passo va avanti con la freccia, il secondo salva.
  if (n === 1) {
    azionePrincipale = () => passoBene(2);
    pulsanteTondo('freccia', 'Avanti');
  } else {
    azionePrincipale = salvaBene;
    pulsantePrincipale(inv.modifica ? 'Salva' : 'Aggiungi', true);
  }
  if (n === 2) {
    const sede = el('agg-sede').selectedOptions[0]?.textContent || '';
    const cat = el('agg-categoria').selectedOptions[0]?.textContent || '';
    el('riassunto-bene').innerHTML = `<b>${esc(el('agg-titolo').value.trim())}</b>` +
      `<span>${[el('agg-autore').value.trim(), cat, sede].filter(Boolean).map(esc).join(' · ')}</span>`;
  }
  window.scrollTo(0, 0);
}

// La modifica usa lo stesso form dell'aggiunta, riempito con il bene.
function modalitaForm(beneId) {
  const prima = inv.modifica;
  inv.modifica = beneId;
  el('campo-mancante').hidden = !beneId;
  // Passando da una modifica a un'aggiunta il form non deve tenere il bene di prima.
  if (prima || beneId) svuotaFormBene();
}

// Nell'anno solo cifre, al massimo quattro; l'anno in corso fa da esempio.
el('agg-anno').placeholder = String(new Date().getFullYear());
el('agg-anno').addEventListener('input', () => {
  const pulito = el('agg-anno').value.replace(/\D/g, '').slice(0, 4);
  if (pulito !== el('agg-anno').value) el('agg-anno').value = pulito;
});

async function apriModifica(beneId) {
  let v;
  try {
    v = (await chiama('inventario/admin/bene', { beneId })).valori;
  } catch (err) {
    return lamenta(err.message);
  }
  preparaFormBene();
  modalitaForm(beneId);
  el('agg-categoria').value = v.categoria;
  el('agg-sede').value = String(v.sede_id);
  const metti = { 'agg-isbn': v.isbn, 'agg-titolo': v.name, 'agg-autore': v.autore,
    'agg-editore': v.editore, 'agg-anno': v.anno_pubblicazione, 'agg-codice': v.codice_interno,
    'agg-valore': v.valore_stimato ? String(v.valore_stimato).replace('.', ',') : '',
    'agg-proprietario': v.proprietario_libero, 'agg-note': v.note };
  for (const [id, valore] of Object.entries(metti)) el(id).value = valore ?? '';
  el('agg-sistema').value = v.sistema_id ? String(v.sistema_id) : '';
  el('agg-mancante').checked = Boolean(v.mancante);
  for (const g of v.genere_ids) inv.generiScelti.add(String(g));
  aggiornaCategoria();
  mostra('aggiungi');
  passoBene(1);
}

function apriAggiungi() {
  preparaFormBene();
  modalitaForm(null);
  // Si parte dalla categoria che si stava guardando.
  const t = TIPI.find(x => x.chiave === inv.tipo);
  if (t?.categorie.length && [...el('agg-categoria').options].some(o => o.value === t.categorie[0])) {
    el('agg-categoria').value = t.categorie[0];
  }
  aggiornaCategoria();
  mostra('aggiungi');
  passoBene(1);
}

function aggiornaCategoria() {
  const c = el('agg-categoria').value;
  el('campo-sistema').hidden = c !== 'gioco_di_ruolo';
  // L'ISBN e' dei libri e dei manuali; per un gioco da tavolo e' rumore.
  el('campo-isbn').hidden = !['libro', 'manuale', 'gioco_di_ruolo'].includes(c);
  // I generi proposti sono quelli di questa categoria: quelli scelti per
  // un'altra non valgono piu'.
  const validi = new Set(generiDi([c]).map(g => String(g.id)));
  for (const k of [...inv.generiScelti]) {
    if (!k.startsWith('nuovo:') && !validi.has(k)) inv.generiScelti.delete(k);
  }
  disegnaGeneri();
}

function disegnaGeneri() {
  const c = el('agg-categoria').value;
  // I generi della categoria si contano una volta, non uno per genere.
  const dellaCategoria = new Set(generiDi([c]));
  const tutti = [
    ...inv.opzioni.generi
      .filter(g => dellaCategoria.has(g) || inv.generiScelti.has(String(g.id)))
      .map(g => ({ chiave: String(g.id), nome: g.nome })),
    ...inv.nuoviGeneri.map(n => ({ chiave: 'nuovo:' + n, nome: n })),
  ];
  el('agg-generi').innerHTML = tutti.map(g =>
    `<button type="button" data-genere="${esc(g.chiave)}" aria-pressed="${inv.generiScelti.has(g.chiave)}">${esc(g.nome)}</button>`
  ).join('');
  el('agg-generi').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      const k = b.dataset.genere;
      inv.generiScelti.has(k) ? inv.generiScelti.delete(k) : inv.generiScelti.add(k);
      b.setAttribute('aria-pressed', String(inv.generiScelti.has(k)));
    };
  });
}

// Scrivendo, i generi gia' nel sistema che contengono quelle lettere (non
// gia' scelti): toccandone uno si sceglie. "Aggiungi" o Invio con un nome
// che non c'e' lo crea, come prima.
function suggerisciGeneri() {
  const campo = el('agg-nuovo-genere');
  const dove = el('agg-generi-suggeriti');
  const t = campo.value.trim().toLowerCase();
  const lista = !t ? [] : inv.opzioni.generi
    .filter(g => !inv.generiScelti.has(String(g.id)) && g.nome.toLowerCase().includes(t))
    .sort((a, b) => Number(!a.nome.toLowerCase().startsWith(t)) - Number(!b.nome.toLowerCase().startsWith(t))
      || a.nome.localeCompare(b.nome, 'it'))
    .slice(0, 8);
  dove.innerHTML = lista.map(g => `<button type="button" role="option" data-genere-esistente="${esc(g.id)}"><b>${esc(g.nome)}</b></button>`).join('');
  dove.hidden = !lista.length;
  campo.setAttribute('aria-expanded', String(Boolean(lista.length)));
  dove.querySelectorAll('[data-genere-esistente]').forEach(b => {
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.onclick = () => {
      inv.generiScelti.add(b.dataset.genereEsistente);
      campo.value = '';
      suggerisciGeneri();
      disegnaGeneri();
    };
  });
}

function aggiungiGenere() {
  // La maiuscola iniziale, come quelli che ci sono gia'.
  const scritto = el('agg-nuovo-genere').value.trim().replace(/\s+/g, ' ');
  const nome = scritto.charAt(0).toLocaleUpperCase('it-IT') + scritto.slice(1);
  if (!nome) return;
  // Se c'e' gia', a meno delle maiuscole, si sceglie quello.
  const esistente = inv.opzioni.generi.find(g => g.nome.toLowerCase() === nome.toLowerCase());
  if (esistente) {
    inv.generiScelti.add(String(esistente.id));
  } else if (!inv.nuoviGeneri.some(n => n.toLowerCase() === nome.toLowerCase())) {
    inv.nuoviGeneri.push(nome);
    inv.generiScelti.add('nuovo:' + nome);
  }
  el('agg-nuovo-genere').value = '';
  suggerisciGeneri();
  disegnaGeneri();
}

function esitoIsbn(testo, attento = false) {
  el('esito-isbn').textContent = testo;
  el('esito-isbn').classList.toggle('attento', attento);
  el('esito-isbn').hidden = !testo;
}

async function cercaIsbn() {
  const codice = el('agg-isbn').value.trim();
  if (!codice) return;
  el('cerca-isbn').disabled = true;
  esitoIsbn('Cerco…');
  try {
    const r = await chiama('inventario/isbn', { isbn: codice, sedeId: el('agg-sede').value });
    el('agg-isbn').value = r.isbn;
    if (r.dati) {
      // Si riempie solo quello che e' vuoto: chi ha gia' scritto il titolo
      // a mano lo sa meglio di Open Library.
      const metti = (id, valore) => { if (valore && !el(id).value.trim()) el(id).value = valore; };
      metti('agg-titolo', r.dati.titolo);
      metti('agg-autore', r.dati.autore);
      metti('agg-editore', r.dati.editore);
      metti('agg-anno', r.dati.anno);
    }
    const doppi = r.esistenti.length
      ? `Attenzione: in questa sede c’è già “${r.esistenti[0].titolo}” con lo stesso ISBN. `
      : '';
    esitoIsbn(doppi + (r.dati ? `Dati da ${r.dati.fonte}: controllali.` : 'Non lo trovo da nessuna parte: scrivi tu i dati.'),
      Boolean(r.esistenti.length));
  } catch (err) {
    esitoIsbn(err.message, true);
  } finally {
    el('cerca-isbn').disabled = false;
  }
}

function caricaZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  return new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = 'vendor/zxing-0.21.3.min.js';
    s.onload = () => ok(window.ZXing);
    s.onerror = ko;
    document.head.appendChild(s);
  });
}

// La fotocamera aperta: chi la chiude (Annulla, Indietro, un'altra scheda)
// ferma il video e la lettura, non solo la finestra. Senza, il telefono
// teneva la fotocamera accesa e continuava a cercare codici.
let scannerAperto = null;
function fermaScanner() {
  const chiudi = scannerAperto;
  scannerAperto = null;
  if (chiudi) chiudi();
}

async function scansionaConZxing() {
  let ZXing;
  try {
    ZXing = await caricaZxing();
  } catch {
    return lamenta('Non riesco a caricare il lettore: scrivi l’ISBN a mano.');
  }
  const indizi = new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13]]]);
  const lettore = new ZXing.BrowserMultiFormatReader(indizi, 250);
  const chiudi = () => {
    if (scannerAperto === chiudi) scannerAperto = null;
    try { lettore.reset(); } catch {}
    el('video-isbn').srcObject = null;
    el('scanner').hidden = true;
  };
  fermaScanner();
  scannerAperto = chiudi;
  el('chiudi-scanner').onclick = chiudi;
  el('scanner').hidden = false;
  try {
    await lettore.decodeFromConstraints(
      { video: { facingMode: 'environment' } }, el('video-isbn'), (risultato) => {
        const testo = risultato?.getText();
        if (!testo || !/^97[89]\d{10}$/.test(testo)) return;
        chiudi();
        tg?.HapticFeedback?.notificationOccurred('success');
        el('agg-isbn').value = testo;
        cercaIsbn();
      });
  } catch {
    // Chiusa da chi ha cambiato pagina mentre si apriva: niente da dire.
    if (scannerAperto !== chiudi) return;
    chiudi();
    lamenta('Non riesco ad aprire la fotocamera: scrivi l’ISBN a mano.');
  }
}

async function scansiona() {
  if (!LETTORE_NATIVO) return scansionaConZxing();
  let flusso;
  try {
    flusso = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch {
    lamenta('Non riesco ad aprire la fotocamera: scrivi l’ISBN a mano.');
    return;
  }
  // Mentre il telefono chiedeva il permesso si e' andati altrove.
  if (el('pannello-aggiungi').hidden) { flusso.getTracks().forEach(t => t.stop()); return; }
  const video = el('video-isbn');
  const lettore = new BarcodeDetector({ formats: ['ean_13'] });
  let finito = false;
  const chiudi = () => {
    if (scannerAperto === chiudi) scannerAperto = null;
    finito = true;
    flusso.getTracks().forEach(t => t.stop());
    video.srcObject = null;
    el('scanner').hidden = true;
  };
  fermaScanner();
  scannerAperto = chiudi;
  el('chiudi-scanner').onclick = chiudi;
  el('scanner').hidden = false;
  video.srcObject = flusso;
  await video.play().catch(() => {});
  while (!finito) {
    try {
      // Solo gli EAN dei libri (978, 979): il codice del prezzo accanto
      // non deve passare per un ISBN.
      const trovato = (await lettore.detect(video)).find(c => /^97[89]\d{10}$/.test(c.rawValue));
      if (finito) return;
      if (trovato) {
        chiudi();
        tg?.HapticFeedback?.notificationOccurred('success');
        el('agg-isbn').value = trovato.rawValue;
        cercaIsbn();
        return;
      }
    } catch { /* il primo fotogramma a volte non e' pronto */ }
    await new Promise(r => setTimeout(r, 250));
  }
}

async function salvaBene() {
  const titolo = el('agg-titolo').value.trim();
  if (!titolo) return lamenta('Manca il titolo.');
  const scelti = [...inv.generiScelti];
  const valori = {
    titolo,
    categoria: el('agg-categoria').value,
    sedeId: el('agg-sede').value,
    isbn: el('campo-isbn').hidden ? '' : el('agg-isbn').value.trim(),
    autore: el('agg-autore').value,
    editore: el('agg-editore').value,
    anno: el('agg-anno').value,
    codiceInterno: el('agg-codice').value,
    valore: el('agg-valore').value,
    proprietario: el('agg-proprietario').value,
    note: el('agg-note').value,
    generi: scelti.filter(k => !k.startsWith('nuovo:')),
    mancante: el('agg-mancante').checked,
    nuoviGeneri: scelti.filter(k => k.startsWith('nuovo:')).map(k => k.slice(6)),
    sistemaId: el('campo-sistema').hidden ? '' : el('agg-sistema').value,
    nuovoSistema: el('campo-sistema').hidden ? '' : el('agg-nuovo-sistema').value,
  };
  // Nella modifica un ISBN nascosto (un gioco da tavolo) resta com'e' in Odoo.
  if (inv.modifica && el('campo-isbn').hidden) delete valori.isbn;
  attesaAzione(true);
  try {
    if (inv.modifica) {
      await chiama('inventario/admin/modifica', { beneId: inv.modifica, valori });
      toast(`Salvato: ${titolo}`);
      modalitaForm(null);
      mostra('inventario');
      cercaBeni(true);
      return;
    }
    await chiama('inventario/aggiungi', { valori });
    toast(`Aggiunto: ${titolo}`);
    // Si svuota quello che cambia da un libro all'altro; categoria e sede
    // restano, perche' di solito se ne aggiungono tanti della stessa pila.
    for (const id of CAMPI_FORM_BENE) el(id).value = '';
    el('agg-sistema').value = '';
    // I generi usati adesso sono di questa categoria anche per i prossimi.
    const mappa = inv.opzioni.generi_categoria;
    const c = valori.categoria;
    if (mappa) mappa[c] = [...new Set([...(mappa[c] || []), ...valori.generi.map(Number)])];
    inv.generiScelti.clear();
    // I generi nuovi adesso esistono: si ricaricano al prossimo avvio, e
    // intanto restano scritti cosi'.
    disegnaGeneri();
    esitoIsbn('');
    // Si riparte dal primo passo, per il prossimo della pila.
    attesaAzione(false);
    passoBene(1);
  } catch (err) {
    lamenta(err.message);
  } finally {
    attesaAzione(false);
  }
}
