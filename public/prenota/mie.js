// Le mie prenotazioni: l'elenco, annullare.

// -------------------------------------------------------------------- mie
const NESSUNA_MIA = `
  <div class="nessuna-mia">
    <p>Non hai attività in programma.</p>
  </div>`;

// Mentre si aspetta l'elenco si puo' annullare o saltare una data, o
// cambiare pagina: conta solo l'ultima richiesta, cosi' una risposta lenta
// non rimette in elenco una data appena saltata.
async function caricaMie() {
  const giro = nuovoGiro('mie');
  const dove = el('elenco-mie');
  dove.className = 'vuoto';
  dove.textContent = 'Carico…';
  try {
    // Di un'attivita' periodica si mostra solo la prossima data.
    const lette = (await chiama('mie')).prenotazioni;
    if (!giroValido('mie', giro)) return;
    segnaFresco('mie');
    const prenotazioni = primeDelleSerie(lette);
    const avviso = stato.senzaTessera ? AVVISO_SENZA_TESSERA : '';
    if (!prenotazioni.length) {
      dove.className = '';
      // Senza tessera l'avviso prende il posto di "Non hai attivita'".
      dove.innerHTML = avviso || NESSUNA_MIA;
      collegaAvvisoTessera(dove);
      return;
    }
    dove.className = '';
    dove.innerHTML = html`${raw(avviso)}${prenotazioni.map(p => html`
      <div class="riga">
        <div>${p.nome || 'senza titolo'}${p.fissa ? ' · ' + (CADENZE[p.ricorrenza] || CADENZE.settimanale) : ''}</div>
        <div class="quando">${p.fissa ? 'Prossima: ' : ''}${quandoTesto(p.inizio, p.fine)} · ${nomeSede(p.sede)}</div>
        <div class="azioni">
          ${p.fissa
            ? html`<button class="grave" data-pieno data-icona="salta" data-sede="${p.sede}" data-id="${p.id}" data-nome="${p.nome || ''}" data-inizio="${p.inizio}" data-fine="${p.fine}" data-cosa="volta">Salta la prossima data</button>`
            : html`<button class="grave" data-pieno data-icona="elimina" data-menu="Elimina la prenotazione" data-sede="${p.sede}" data-id="${p.id}" data-nome="${p.nome || ''}" data-inizio="${p.inizio}" data-fine="${p.fine}" data-cosa="una">Elimina</button>`}
        </div>
        ${p.fissa ? '' : html`<div class="azioni sinistra">
          <button class="conferma" data-pieno data-icona="ricorrente" data-sede="${p.sede}" data-id="${p.id}" data-cosa="settimanale">Rendi ricorrente</button>
        </div>`}
        ${p.fissa ? html`<div class="azioni sinistra">
          <button class="conferma" data-pieno data-icona="modifica" data-sede="${p.sede}" data-id="${p.id}" data-nome="${p.nome || ''}" data-inizio="${p.inizio}" data-fine="${p.fine}" data-cosa="sposta">Modifica la data</button>
        </div>` : ''}
        ${p.fissa && p.serieId ? html`<div class="azioni solo-menu" hidden>
          <button class="grave" data-icona="elimina" data-sede="${p.sede}" data-id="${p.serieId}" data-nome="${p.nome || ''}" data-cosa="serie">Elimina la serie</button>
        </div>` : ''}
      </div>`)}`;
    dove.querySelectorAll('button').forEach(b => {
      b.onclick = b.dataset.cosa === 'settimanale'
        ? () => rendiSettimanale(b.dataset.sede, b.dataset.id, b)
        : b.dataset.cosa === 'sposta'
          ? () => apriSposta(b.dataset.sede, b.dataset.id, b.dataset.nome, b.dataset.inizio, b.dataset.fine)
          : () => annulla(b.dataset.sede, b.dataset.id, b, b.dataset.cosa);
      // Il pulsante si chiama "Elimina" (non "Annulla"): nelle domande di
      // conferma "Annulla" vuol dire lasciar perdere.
    });
    collegaAvvisoTessera(dove);
    scorrevoli(dove, '.riga', { tocco: menuDellaRiga, menu: menuDellaRiga });
  } catch (err) {
    if (giroValido('mie', giro)) erroreCarico(dove, err, caricaMie);
  }
}

// Di ogni attivita' periodica, solo la prima data dell'elenco: le altre
// sono la stessa cosa ripetuta. L'elenco arriva gia' in ordine di data.
function primeDelleSerie(lista) {
  const viste = new Set();
  return lista.filter(p => {
    if (!p.serieId) return true;
    if (viste.has(p.serieId)) return false;
    viste.add(p.serieId);
    return true;
  });
}

// Senza la tessera dell'anno non si prenota: lo si dice in cima, con la
// strada per farla.
const AVVISO_SENZA_TESSERA = `<div class="avviso-tessera">
  Per prenotare un’attività bisogna tesserarsi.
  <button type="button" class="link" data-vai-tessera>Vai al tesseramento ›</button></div>`;
function collegaAvvisoTessera(dove) {
  const b = dove.querySelector('[data-vai-tessera]');
  if (b) b.onclick = () => mostra('tessera');
}

// Il nome della sede, non quello tecnico: "Trani", non "trani".
const nomeSede = (slug) => (stato.sediInfo || []).find(s => s.slug === slug)?.nome || slug;

function quandoTesto(inizio, fine) {
  const a = new Date(inizio), b = new Date(fine);
  const giorno = a.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const ora = (d) => d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return `${giorno}, ${ora(a)}-${ora(b)}`;
}

// cosa: "una" una prenotazione singola, "volta" una sola data di
// un'attivita' periodica, "serie" tutte le date. La domanda dice quale data
// e quale attivita'; il pulsante che conferma dice cosa fa, in rosso.
const DOMANDE = {
  una: (d) => [`Eliminare la prenotazione di ${d.giorno}?`, `«${d.nome}»${d.orario ? ', ' + d.orario : ''}.`, 'Elimina', 'Elimino…'],
  volta: (d) => [`Saltare ${d.giorno}?`, `«${d.nome}»: le altre date restano.`, 'Salta', 'Salto…'],
  serie: (d) => ['Eliminare tutte le date?', `«${d.nome}»: non si torna indietro.`, 'Elimina', 'Elimino…'],
};

function annulla(sede, id, bottone, cosa = 'una') {
  const b = bottone.dataset;
  const valida = b.inizio && !isNaN(new Date(b.inizio));
  const dati = { nome: b.nome || 'senza titolo', giorno: valida ? giornoLungo(b.inizio) : 'questa data',
                 orario: valida && b.fine ? `${oraBreve(b.inizio)}-${oraBreve(b.fine)}` : '' };
  const [domanda, testo, etichetta, mentre] = (DOMANDE[cosa] || DOMANDE.una)(dati);
  const prima = bottone.innerHTML;
  const fai = async () => {
    // Il bottone dice cosa sta succedendo: la chiamata passa da Google e
    // qualche secondo ci mette, e un bottone che non reagisce sembra rotto.
    // La riga con le sue azioni dietro, quando si scorre: e' quella che se ne va.
    const riga = bottone.closest('.scorri') || bottone.closest('.riga');
    riga.querySelectorAll('button').forEach(b => b.disabled = true);
    bottone.textContent = mentre;
    try {
      await chiama('annulla', { sede, eventId: id });
      tg?.HapticFeedback?.notificationOccurred('success');
      // Saltata una data di una serie, la riga mostra la prossima: si rilegge.
      if (cosa === 'volta') {
        dimenticaMesi();
        return caricaMie();
      }
      riga.remove();
      if (!el('elenco-mie').querySelector('.riga')) {
        el('elenco-mie').className = 'vuoto';
        el('elenco-mie').className = '';
        el('elenco-mie').innerHTML = NESSUNA_MIA;
      }
      // Il giorno adesso e' piu' libero: la prossima volta si rilegge.
      dimenticaMesi();
    } catch (err) {
      riga.querySelectorAll('button').forEach(b => b.disabled = false);
      bottone.innerHTML = prima;
      lamenta(err.message);
    }
  };
  // Senza conferma non si toglie niente.
  confermaGrave(domanda, testo, etichetta).then(si => si && fai());
}

// Ripeterla ogni settimana non e' una modifica alla propria prenotazione: e'
// un'attivita' periodica, e quelle occupano la stanza per sempre, percio' le
// decide lo staff. Finche' non risponde, la serata di questa settimana resta
// dov'e': chi chiede non rischia di perdere anche quella.
function rendiSettimanale(sede, id, bottone) {
  const fai = async () => {
    const riga = bottone.closest('.scorri') || bottone.closest('.riga');
    riga.querySelectorAll('button').forEach(b => b.disabled = true);
    bottone.textContent = 'Chiedo…';
    try {
      await chiama('settimanale', { sede, eventId: id });
      tg?.HapticFeedback?.notificationOccurred('success');
      bottone.textContent = 'Chiesto allo staff';
      // Annullare la serata di questa settimana resta possibile: e' l altro
      // bottone, e non ha niente a che vedere con la richiesta.
      riga.querySelectorAll('button').forEach(b => { if (b !== bottone) b.disabled = false; });
      toast('Richiesta mandata allo staff. Ti scrivo appena decidono.');
    } catch (err) {
      riga.querySelectorAll('button').forEach(b => b.disabled = false);
      bottone.textContent = 'Rendi ricorrente';
      lamenta(err.message);
    }
  };
  const domanda = 'Chiedo allo staff di ripeterla ogni settimana, '
    + 'stesso giorno e stessa ora?';
  // Fuori da Telegram chiede il browser: senza conferma non si annulla niente.
  conferma(domanda).then(si => si && fai());
}
