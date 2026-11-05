// Prenotare una stanza: calendario, ricorrenza, fascia, esito, passi,
// serie, prenota e sposta.

// ------------------------------------------------------------- calendario
function chiaveMese() { return `${stato.sede}|${stato.mese.anno}-${stato.mese.mese}`; }

function attesaMese(si) {
  el('calendario').classList.toggle('in-attesa', si);
  const gia = el('mese-nome').querySelector('.rotella');
  if (si && !gia) {
    const r = document.createElement('span');
    r.className = 'rotella';
    r.setAttribute('aria-label', 'sto controllando');
    el('mese-nome').appendChild(r);
  } else if (!si && gia) {
    gia.remove();
  }
}

// Una richiesta sola per sede e mese, anche toccando due volte la freccia:
// la seconda aspetta la prima. Se nel frattempo si e' passati a un altro
// mese (o sede), la risposta resta in memoria ma il calendario non si
// ridisegna: quello giusto lo disegna la richiesta del mese nuovo.
const meseInVolo = new Map();

// Dopo una prenotazione o un annullo i giorni sono cambiati: si dimentica
// tutto, anche le richieste ancora in viaggio (la loro risposta e' vecchia).
function dimenticaMesi() {
  Object.keys(stato.occupazione).forEach(k => delete stato.occupazione[k]);
  meseInVolo.clear();
}

async function caricaMese() {
  const chiave = chiaveMese();
  if (!stato.occupazione[chiave]) {
    if (!meseInVolo.has(chiave)) {
      const richiesta = chiama('mese', { sede: stato.sede, anno: stato.mese.anno, mese: stato.mese.mese })
        .then(r => r.giorni || {})
        // Senza i dati il calendario si disegna lo stesso: meglio poter
        // scegliere un giorno che una griglia vuota.
        .catch(() => ({}))
        .then(giorni => {
          if (meseInVolo.get(chiave) !== richiesta) return;   // dimenticata nel frattempo
          meseInVolo.delete(chiave);
          stato.occupazione[chiave] = giorni;
        });
      meseInVolo.set(chiave, richiesta);
    }
    attesaMese(true);
    await meseInVolo.get(chiave);
    if (chiaveMese() !== chiave) return false;
    // Dimenticata mentre arrivava: si richiede.
    if (!stato.occupazione[chiave]) return caricaMese();
  }
  attesaMese(false);
  disegnaCalendario();
  return true;
}

function disegnaCalendario() {
  const { anno, mese } = stato.mese;
  const dati = stato.occupazione[chiaveMese()] || {};
  const oggi = new Date(); oggi.setHours(0,0,0,0);
  const ultimo = new Date(oggi.getTime() + stato.limiti.giorniAvanti * 86400000);

  el('mese-nome').textContent = `${MESI[mese-1]} ${anno}`;
  el('mese-prima').disabled = new Date(anno, mese-1, 1) <= new Date(oggi.getFullYear(), oggi.getMonth(), 1);
  el('mese-dopo').disabled = new Date(anno, mese-1, 1) >= new Date(ultimo.getFullYear(), ultimo.getMonth(), 1);

  const pezzi = GIORNI.map(g => `<div class="intestazione">${g}</div>`);
  const primo = new Date(anno, mese-1, 1);
  const vuoti = (primo.getDay() + 6) % 7;   // la settimana comincia di lunedi
  for (let i = 0; i < vuoti; i++) pezzi.push('<div class="giorno vuoto"></div>');

  const quanti = new Date(anno, mese, 0).getDate();
  for (let g = 1; g <= quanti; g++) {
    const data = new Date(anno, mese-1, g);
    const chiave = iso(data);
    const info = dati[chiave] || { occupati: 0, pieno: false };
    const fuori = data < oggi || data > ultimo;
    const classe = ['giorno'];
    if (info.pieno) classe.push('pieno');
    else if (info.occupati > 0) classe.push('occupato');
    // Spostando una data, quella di adesso ha un bordo suo: si vede da dove
    // si parte.
    const attuale = stato.spostando?.giorno === chiave;
    if (attuale) classe.push('attuale');
    // Per chi non vede i colori: il giorno per esteso, e com'e' messo.
    const nome = data.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    const come = (info.pieno ? ', pieno' : info.occupati > 0 ? ', occupato' : '') + (attuale ? ', data attuale' : '');
    pezzi.push(
      `<button class="${classe.join(' ')}" data-data="${chiave}"` +
      `${fuori || info.pieno ? ' disabled' : ''}` +
      ` aria-label="${esc(nome + come)}"` +
      ` aria-pressed="${stato.giorno === chiave}">` +
      `<span aria-hidden="true">${g}</span><span class="segno"></span></button>`
    );
  }
  el('calendario').innerHTML = pezzi.join('');
  el('calendario').querySelectorAll('.giorno[data-data]').forEach(b => {
    b.onclick = async () => {
      await scegliGiorno(b.dataset.data);
      // Giorno e orario stanno nella stessa schermata: scelto il giorno, si
      // scende all'orario.
      const fascia = el('dopo-giorno');
      const prima = fascia.hidden;
      fascia.hidden = false;
      if (prima) fascia.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
}

async function scegliGiorno(data) {
  stato.giorno = data;
  disegnaCalendario();
  disegnaFascia();
  aggiornaCadenza();
  aggiornaEsito();
}

// -------------------------------------------------------------- ricorrenza
// "Una volta al mese" da solo non dice se e' il 16 o il terzo giovedi': sotto
// la spunta si legge quale, con il giorno scelto. E' la stessa regola che il
// server scrive nell'evento (testoRicorrenza in prenotazioni.js).
function testoCadenza() {
  if (!stato.giorno) return null;
  const d = new Date(stato.giorno + 'T12:00');
  const giorno = d.toLocaleDateString('it-IT', { weekday: 'long' });
  if (stato.ricorrenza === 'quindicinale') return `Ogni due settimane, di ${giorno}`;
  if (stato.ricorrenza === 'giornoFisso') {
    return `Ogni mese, ${articoloGiorno(d.getDate())}` +
      (d.getDate() > 28 ? ', saltando i mesi che non ce l’hanno' : '');
  }
  if (stato.ricorrenza === 'mensile') {
    const f = d.getDay() === 0;
    const n = Math.ceil(d.getDate() / 7);
    const ordinale = n === 5
      ? (f ? 'l’ultima' : 'l’ultimo')
      : `${f ? 'la' : 'il'} ${(f ? ['prima', 'seconda', 'terza', 'quarta'] : ['primo', 'secondo', 'terzo', 'quarto'])[n - 1]}`;
    return `Ogni mese, ${ordinale} ${giorno}`;
  }
  return `Ogni ${giorno}`;
}

function aggiornaCadenza() {
  const acceso = el('fissa').checked;
  el('cadenze').hidden = !acceso;
  el('cadenze').querySelectorAll('button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.ricorrenza === stato.ricorrenza)));
  // Il pulsante dice il giorno vero appena ce n'e' uno.
  el('cadenza-giorno').textContent = stato.giorno
    ? `Sempre ${articoloGiorno(Number(stato.giorno.slice(8)))}`
    : 'Sempre lo stesso giorno';
  // La frase esce solo a spunta accesa e con una data: senza data non c'e'
  // niente di concreto da dire.
  const frase = acceso ? testoCadenza() : null;
  el('frase-cadenza').hidden = !frase;
  el('frase-cadenza').textContent = frase || '';
}

// ----------------------------------------------------------------- fascia
function eventiDelGiorno() {
  const dati = stato.occupazione[chiaveMese()] || {};
  return (dati[stato.giorno]?.eventi) || [];
}

function percentuale(h) {
  const { oraMinima: a, oraMassima: b } = stato.limiti;
  return ((h - a) / (b - a)) * 100;
}

function disegnaFascia() {
  const { oraMinima: a, oraMassima: b } = stato.limiti;

  el('ore').innerHTML = '';
  for (let h = a; h <= b; h++) el('ore').insertAdjacentHTML('beforeend', html`<span>${h}</span>`);

  const pista = el('pista');
  pista.querySelectorAll('.tacca, .gia').forEach(n => n.remove());
  for (let h = a + 1; h < b; h++) {
    const t = document.createElement('div');
    t.className = 'tacca';
    t.style.left = percentuale(h) + '%';
    pista.appendChild(t);
  }

  // Quello che c'e' gia', impilato: due barre alla stessa ora vogliono dire
  // che quel pezzo di serata e' pieno, e si deve vedere.
  eventiDelGiorno().forEach((ev, i) => {
    const da = Math.max(ev.da, a), fino = Math.min(ev.a, b);
    if (fino <= da) return;
    const barra = document.createElement('div');
    barra.className = 'gia';
    barra.style.left = percentuale(da) + '%';
    barra.style.width = (percentuale(fino) - percentuale(da)) + '%';
    barra.style.top = (6 + (i % 2) * 18) + 'px';
    barra.textContent = ev.nome;
    // title: il tooltip del browser, per chi usa Telegram da computer.
    barra.title = `${ev.nome} · ${oraTesto(ev.da)}-${oraTesto(ev.a)}`;
    pista.appendChild(barra);
  });

  aggiornaManiglie();
}

function aggiornaManiglie() {
  el('scelta').style.left = percentuale(stato.daOra) + '%';
  el('scelta').style.width = (percentuale(stato.aOra) - percentuale(stato.daOra)) + '%';
  el('maniglia-inizio').style.left = percentuale(stato.daOra) + '%';
  el('maniglia-fine').style.left = percentuale(stato.aOra) + '%';
  el('maniglia-inizio').setAttribute('aria-valuenow', stato.daOra);
  el('maniglia-fine').setAttribute('aria-valuenow', stato.aOra);
  // Il lettore di schermo legge "18:30", non "18.5".
  el('maniglia-inizio').setAttribute('aria-valuetext', oraTesto(stato.daOra));
  el('maniglia-fine').setAttribute('aria-valuetext', oraTesto(stato.aOra));

  const durata = stato.aOra - stato.daOra;
  const ore = Math.floor(durata);
  const minuti = durata % 1 ? 30 : 0;
  el('quanto').innerHTML =
    `<b>${oraTesto(stato.daOra)}-${oraTesto(stato.aOra)}</b> ` +
    `<span>· ${ore ? ore + 'h' : ''}${minuti ? ' 30′' : ''}</span>`;
}

// La pista si misura una volta, quando si prende la maniglia: misurarla a
// ogni movimento, subito dopo aver spostato le maniglie, costringeva il
// browser a ricalcolare la pagina a ogni pixel.
function oraDaPosizione(clientX, r) {
  const { oraMinima: a, oraMassima: b } = stato.limiti;
  const frazione = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  return Math.round((a + frazione * (b - a)) * 2) / 2;   // scatti di mezz'ora
}

function trascina(maniglia, quale) {
  let pista = null;
  const muovi = (ev) => {
    const h = oraDaPosizione(ev.clientX, pista);
    const prima = [stato.daOra, stato.aOra];
    if (quale === 'inizio') stato.daOra = Math.min(h, stato.aOra - 0.5);
    else stato.aOra = Math.max(h, stato.daOra + 0.5);
    // Si ridisegna solo quando l'orario cambia davvero (ogni mezz'ora).
    if (prima[0] === stato.daOra && prima[1] === stato.aOra) return;
    aggiornaManiglie();
    aggiornaEsito();
  };
  maniglia.addEventListener('pointerdown', (ev) => {
    pista = el('pista').getBoundingClientRect();
    maniglia.setPointerCapture(ev.pointerId);
    maniglia.addEventListener('pointermove', muovi);
  });
  const finito = (ev) => {
    maniglia.removeEventListener('pointermove', muovi);
    try { maniglia.releasePointerCapture(ev.pointerId); } catch {}
  };
  maniglia.addEventListener('pointerup', finito);
  maniglia.addEventListener('pointercancel', finito);

  // Chi non puo' trascinare (tastiera, lettore di schermo) deve poter
  // comunque scegliere l'orario.
  maniglia.addEventListener('keydown', (ev) => {
    const passo = ev.key === 'ArrowLeft' ? -0.5 : ev.key === 'ArrowRight' ? 0.5 : 0;
    if (!passo) return;
    ev.preventDefault();
    if (quale === 'inizio') {
      stato.daOra = Math.max(stato.limiti.oraMinima, Math.min(stato.daOra + passo, stato.aOra - 0.5));
    } else {
      stato.aOra = Math.min(stato.limiti.oraMassima, Math.max(stato.aOra + passo, stato.daOra + 0.5));
    }
    aggiornaManiglie();
    aggiornaEsito();
  });
}

// ------------------------------------------------------------------ esito
// Spostando una data, la data stessa non conta: non ci si sovrappone a se'.
// Il server (mese) per ora non manda l'id degli eventi: se c'e' si usa
// quello, se no si riconosce dal nome, dal giorno e dall'orario di prima.
function eLaDataSpostata(ev) {
  const s = stato.spostando;
  if (!s) return false;
  if (ev.id !== undefined) return String(ev.id) === String(s.id);
  return stato.sede === s.sede && stato.giorno === s.giorno &&
    ev.nome === s.nome && ev.da === s.da && ev.a === s.a;
}

// Se nella fascia scelta c'e' posto, detto sotto l'orario (passo Quando?). Il
// resto lo chiede un passo per volta.
function aggiornaEsito() {
  const dove = el('esito-orario');
  let libero = false;
  if (stato.sede && stato.giorno) {
    const sovrapposti = eventiDelGiorno()
      .filter(ev => !eLaDataSpostata(ev))
      .filter(ev => ev.a > stato.daOra && ev.da < stato.aOra);
    if (sovrapposti.length >= stato.limiti.maxContemporanei) {
      dove.innerHTML = `<div class="esito pieno"><b>In quelle ore non c'è più posto</b>
        <span>Ci sono già ${sovrapposti.length} attività, ed è il massimo per una sede. Sposta l'orario.</span></div>`;
    } else if (sovrapposti.length === 1) {
      /* Esserci in due non e' un intoppo: la sede ci sta. Verde, e l'altro
         gruppo si dice sotto. */
      libero = true;
      dove.innerHTML = `<div class="esito libero"><b>Libero</b>
        <span>C'è comunque ${esc(sovrapposti[0].nome)}, avvisali che condividerete la sede.</span></div>`;
    } else {
      libero = true;
      dove.innerHTML = `<div class="esito libero"><b>Libero</b>
        <span>${oraTesto(stato.daOra)}-${oraTesto(stato.aOra)}, non c'è nessun'altra attività.</span></div>`;
    }
  } else {
    dove.innerHTML = '';
  }
  stato.fasciaLibera = libero;
  // Spostando una data il nome e la categoria ci sono gia': basta l'orario.
  abilita(Boolean(libero && (stato.spostando || (stato.categoria && el('titolo').value.trim()))));
}

// ------------------------------------------------------------------ passi
const PASSI = [
  { titolo: 'Dove?', pronto: () => Boolean(stato.sede) },
  { titolo: 'Quando?', pronto: () => Boolean(stato.giorno && stato.fasciaLibera) },
  { titolo: 'Cosa fate?', pronto: () => Boolean(stato.categoria && el('titolo').value.trim()) },
  { titolo: 'Tutto giusto?', pronto: () => stato.prenotabile },
];
stato.passo = 1;

// Spostare una data non chiede di nuovo nome e categoria: restano quelli.
// Il passo 3 si salta, avanti e indietro, e la barra conta tre passi invece di quattro.
function vaiAPasso(n) {
  const prima = stato.passo;
  let dove = Math.min(Math.max(n, 1), PASSI.length);
  if (stato.spostando && dove === 3) dove = prima < 3 ? 4 : 2;
  stato.passo = dove;
  const totale = stato.spostando ? 3 : PASSI.length;
  const numero = stato.spostando && stato.passo === 4 ? 3 : stato.passo;
  document.querySelectorAll('#pannello-prenota .passo').forEach(p => {
    p.hidden = Number(p.dataset.passo) !== stato.passo;
  });
  el('dopo-giorno').hidden = !stato.giorno;
  el('apertura').closest('.campo').hidden = Boolean(stato.spostando);
  el('fissa').closest('.campo').hidden = Boolean(stato.spostando);
  el('box-sposta').hidden = !stato.spostando || stato.passo !== 2;
  el('avanzamento-pieno').style.width = `${numero / totale * 100}%`;
  el('avanzamento').setAttribute('aria-valuenow', String(numero));
  el('avanzamento').setAttribute('aria-valuetext', `Passo ${numero} di ${totale}`);
  el('titolo-passo').textContent = PASSI[stato.passo - 1].titolo;
  if (stato.passo === PASSI.length) disegnaRiepilogo();
  window.scrollTo(0, 0);
  abilita(stato.prenotabile);
}

function avanti() {
  if (!PASSI[stato.passo - 1].pronto()) return;
  if (stato.passo === 3 && !el('titolo').value.trim()) {
    return lamenta('Dai un nome all’attività: allo staff serve per sapere chi c’è.');
  }
  vaiAPasso(stato.passo + 1);
}

// Il pulsante in basso nelle stanze: la freccia per andare avanti, e
// all'ultimo passo Prenota.
function azionePrenota() {
  return stato.passo === PASSI.length ? prenota() : avanti();
}

// Indietro, con la freccia di Telegram o il link in alto: dall'aggiunta di un
// bene alla biblioteca, da un passo a quello prima, e dal primo passo alle
// tue prenotazioni.
function indietro() {
  if (menuAperto) return chiudiMenuRiga();
  if (scannerAperto) return fermaScanner();
  if (!el('foglio').hidden) return chiudiFoglio();
  if (!el('foglio-a-nome').hidden) return chiudiPrestatoA();
  if (!el('pannello-aggiungi').hidden && inv.passoBene === 2) return passoBene(1);
  if (!el('pannello-aggiungi').hidden || !el('pannello-prestiti').hidden) return mostra('inventario');
  if (!el('pannello-ricevute').hidden) return mostra('tessera');
  if (!el('pannello-gestione').hidden) return mostra('mie');
  if (!el('pannello-serie').hidden) return mostra('gestione');
  if (!el('pannello-quote').hidden) return mostra('tessera');
  if (!el('pannello-quota').hidden) return mostra('quote');
  if (!el('pannello-incassi').hidden) return mostra('quote');
  if (!el('pannello-prenota').hidden) {
    if (stato.passo > 1) vaiAPasso(stato.passo - 1); else mostra('mie');
  }
}

// Da Le tue prenotazioni si comincia una prenotazione nuova.
// Dove e quando si scelgono da capo a ogni prenotazione nuova: senza, dopo
// aver spostato una data si ripartiva con la sua sede, il suo giorno e il
// suo orario. Nome, categoria e descrizione restano (dopo una prenotazione
// riuscita sono gia' vuoti).
function azzeraDoveQuando() {
  const oggi = new Date();
  stato.sede = null;
  stato.giorno = null;
  stato.daOra = 18;
  stato.aOra = 21;
  stato.fasciaLibera = false;
  stato.mese = { anno: oggi.getFullYear(), mese: oggi.getMonth() + 1 };
  el('sedi').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false'));
  el('dopo-giorno').hidden = true;
  disegnaCalendario();
  disegnaFascia();
  aggiornaCadenza();
  aggiornaEsito();
}

// Da Le tue prenotazioni si comincia una prenotazione nuova.
function nuovaPrenotazione() {
  if (stato.bloccato || stato.senzaTessera) return;
  stato.spostando = null;
  stato.passo = 1;
  azzeraDoveQuando();
  mostra('prenota');
  vaiAPasso(1);
}

// Ore decimali (18.5 e' 18:30), come la fascia e i dati del mese.
const oreDecimali = (d) => d.getHours() + d.getMinutes() / 60;

// Modifica la data di una data di serie: si parte dal calendario della sede
// della data, sul mese della data, con l'orario che aveva, e la stessa
// scelta di giorno e orario di una prenotazione nuova. Si puo' cambiare
// anche sede, che qui e' la stanza.
function apriSposta(sede, id, nome, inizio, fine) {
  if (stato.bloccato || stato.senzaTessera) return;
  const a = inizio ? new Date(inizio) : null;
  const b = fine ? new Date(fine) : null;
  const valida = a && !isNaN(a) && b && !isNaN(b);
  const da = valida ? oreDecimali(a) : null;
  const fino = valida ? oreDecimali(b) + (iso(b) !== iso(a) ? 24 : 0) : null;
  stato.spostando = { sede, id, nome, giorno: valida ? iso(a) : null, da, a: fino };
  const quando = valida ? `${giornoLungo(inizio)}, ${oraTesto(da)}-${oraTesto(fino)}` : '';
  el('box-sposta').innerHTML = html`Sposti <b>«${nome || 'senza titolo'}»</b>${quando ? ` di ${quando}` : ''}${
    nomeSede(sede) ? ` a ${nomeSede(sede)}` : ''}. Scegli il giorno nuovo.`;
  stato.sede = sede;
  stato.giorno = null;
  if (valida) {
    stato.mese = { anno: a.getFullYear(), mese: a.getMonth() + 1 };
    const { oraMinima, oraMassima } = stato.limiti;
    if (da >= oraMinima && fino <= oraMassima && fino > da) { stato.daOra = da; stato.aOra = fino; }
  }
  dimenticaMesi();
  el('sedi').querySelectorAll('button')
    .forEach(x => x.setAttribute('aria-pressed', String(x.dataset.slug === sede)));
  disegnaFascia();
  mostra('prenota');
  stato.passo = 1;
  vaiAPasso(2);
  caricaMese();
}

function disegnaRiepilogo() {
  if (stato.spostando) return disegnaRiepilogoSposta();
  const sede = (stato.sediInfo || []).find(x => x.slug === stato.sede);
  const categoria = (stato.categorieInfo || []).find(c => c.slug === stato.categoria);
  const giorno = new Date(stato.giorno + 'T12:00')
    .toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const righe = [
    ['Sede', sede ? sede.nome : stato.sede],
    ['Giorno', giorno],
    ['Orario', `${oraTesto(stato.daOra)}-${oraTesto(stato.aOra)}`],
    ['Attività', el('titolo').value.trim()],
    ['Categoria', categoria ? categoria.nome : ''],
  ];
  if (el('fissa').checked) righe.push(['Si ripete', testoCadenza() || '']);
  if (el('vetrina').checked) righe.push(['Vetrina', 'Sì']);
  el('riepilogo').innerHTML = righe.map(([k, v]) =>
    `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('') +
    (el('fissa').checked
      ? '<p>Essendo ricorrente, lo staff della sede deve approvarla: ti scrivo appena decide.</p>' : '');
}

// Il riepilogo dice da dove a dove: "Da giovedì 5 novembre → sabato 21
// novembre", e cosi' orario e sede se cambiano anche loro.
function disegnaRiepilogoSposta() {
  const s = stato.spostando;
  const lungo = (g) => new Date(g + 'T12:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const daA = (prima, dopo) => prima && prima !== dopo ? `Da ${prima} → ${dopo}` : dopo;
  const orarioPrima = s.da !== null ? `${oraTesto(s.da)}-${oraTesto(s.a)}` : '';
  const righe = [
    ['Attività', s.nome || ''],
    ['Giorno', daA(s.giorno ? lungo(s.giorno) : '', lungo(stato.giorno))],
    ['Orario', daA(orarioPrima, `${oraTesto(stato.daOra)}-${oraTesto(stato.aOra)}`)],
    ['Sede', daA(nomeSede(s.sede), nomeSede(stato.sede))],
  ];
  el('riepilogo').innerHTML = righe.map(([k, v]) =>
    `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('') +
    '<p>Cambia solo questa data: le altre restano come sono.</p>';
}

// Fino al penultimo passo non c'e' un pulsante Avanti: si va avanti
// compilando. La freccia, piccola a destra, compare quando il passo e' gia'
// completo (per esempio tornando indietro), e all'ultimo c'e' Prenota.
function abilita(si) {
  stato.prenotabile = si;
  if (el('pannello-prenota').hidden) return;
  if (stato.passo === PASSI.length) {
    pulsantePrincipale(stato.spostando ? 'Sposta' : el('fissa').checked ? 'Chiedi allo staff' : 'Prenota', si);
  } else {
    // La freccia c'e' sempre: spenta finche' il passo non e' completo, e se la
    // si tocca lo stesso dice cosa manca.
    pulsanteTondo('freccia', 'Avanti');
    el('azione').classList.toggle('spento', !PASSI[stato.passo - 1].pronto());
  }
}

function cosaManca() {
  if (stato.passo === 1) return 'Scegli la sede.';
  if (stato.passo === 2) return stato.giorno ? 'In quelle ore non c’è posto: sposta l’orario.' : 'Scegli il giorno.';
  if (stato.passo === 3) return stato.categoria ? 'Dai un nome all’attività.' : 'Scegli la categoria.';
  return '';
}

// ----------------------------------------------------------------- serie
// Due eventi finiscono nella stessa tessera se hanno lo stesso titolo, a meno
// di maiuscole e spazi. E" una regola invisibile: un refuso non da" errore, da"
// una tessera in piu' sul calendario che va nel gruppo. Quindi il nome si puo"
// scegliere da un elenco, e sotto al campo si legge cosa succedera".
// La descrizione esce sotto il titolo della tessera, e li' ci sta una riga:
// misurata sullo scatto da 600px, settanta caratteri stanno, ottanta vanno a
// capo. Non e' un limite, e' un consiglio: il contatore lo dice e basta.
const DESCRIZIONE_UNA_RIGA = 70;

function contaDescrizione() {
  const quanti = el('note').value.trim().length;
  const conta = el('conta-note');
  conta.textContent = `${quanti}/${DESCRIZIONE_UNA_RIGA}`;
  conta.classList.toggle('lungo', quanti > DESCRIZIONE_UNA_RIGA);
}

function chiaveSerie(nome) {
  return String(nome || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function caricaSerie() {
  if (stato.serie) return stato.serie;
  try {
    const { serie } = await chiama('serie');
    stato.serie = serie;
  } catch {
    // Senza elenco l'app funziona lo stesso: si perde il suggerimento, non
    // la prenotazione.
    stato.serie = [];
  }
  // I titoli li scrivono i soci: costruiti a nodi e non a stringa, cosi' un
  // apostrofo o una parentesi angolare restano quello che sono.
  const elenco = el('serie-note');
  elenco.textContent = '';
  for (const s of stato.serie) {
    const voce = document.createElement('option');
    voce.value = s.nome;
    elenco.appendChild(voce);
  }
  return stato.serie;
}

// Una serie che si ripete elenca otto date nei prossimi due mesi, e otto date
// non si leggono. Se lo stesso giorno della settimana torna piu' volte alla
// stessa ora e nella stessa sede, la data esatta non aggiunge niente: e"
// "ogni mercoledi". Quando invece capita una volta sola, il giorno serve.
function quandoSerie(date) {
  const gruppi = new Map();
  for (const d of date) {
    const settimana = String(d.giorno).split(' ')[0];
    const chiave = `${settimana}|${d.sedeNome}|${d.orainizio}`;
    if (!gruppi.has(chiave)) {
      gruppi.set(chiave, { settimana, giorno: d.giorno, sede: d.sedeNome, ora: d.orainizio, quante: 0 });
    }
    gruppi.get(chiave).quante++;
  }
  return [...gruppi.values()]
    .map(g => `${g.quante > 1 ? 'ogni ' + g.settimana : g.giorno} ${g.sede} ${g.ora}`)
    .join(', ');
}

// L'elenco dei nomi ha senso solo per la vetrina: fuori di li' il titolo non
// raggruppa niente, e suggerire "Boar/D games" a chi prenota una partita fra
// amici gli fa credere che c'entri qualcosa.
function sincronizzaVetrina() {
  if (el('vetrina').checked) el('titolo').setAttribute('list', 'serie-note');
  else el('titolo').removeAttribute('list');
  el('campo-note').hidden = !el('vetrina').checked;
  aggiornaSerie();
}

function aggiornaSerie() {
  const nota = el('serie-nota');
  const nome = el('titolo').value.trim();
  if (!el('vetrina').checked || !nome) {
    nota.hidden = true;
    return;
  }
  const trovata = (stato.serie || []).find(s => s.chiave === chiaveSerie(nome));
  nota.hidden = false;
  if (!trovata) {
    nota.textContent = 'Nessun altro evento con questo nome: nascerà una tessera sua.';
    return;
  }
  const quando = quandoSerie(trovata.date);
  const nome_forte = document.createElement('b');
  nome_forte.textContent = trovata.nome;
  nota.textContent = 'Si unirà a ';
  nota.append(nome_forte, `: ${quando}.`);
}


// ---------------------------------------------------------------- prenota
async function sposta() {
  if (!stato.prenotabile) return;
  attesaAzione(true);
  try {
    await chiama('sposta', {
      sede: stato.spostando.sede,
      eventId: stato.spostando.id,
      nuovaSede: stato.sede,
      data: stato.giorno,
      oraInizio: stato.daOra,
      oraFine: stato.aOra,
    });
    tg?.HapticFeedback?.notificationOccurred('success');
    toast('Data spostata.');
    stato.spostando = null;
    dimenticaMesi();
    stato.passo = 1;
    mostra('mie');
  } catch (err) {
    lamenta(err.message);
  } finally {
    attesaAzione(false);
  }
}

async function prenota() {
  if (stato.spostando) return sposta();
  if (!stato.prenotabile) return;
  const titolo = el('titolo').value.trim();
  if (!titolo) {
    lamenta('Dai un nome all’attività: allo staff serve per sapere chi c’è.');
    el('titolo').focus();
    return;
  }
  attesaAzione(true);
  try {
    const esito = await chiama('prenota', {
      sede: stato.sede,
      data: stato.giorno,
      oraInizio: stato.daOra,
      oraFine: stato.aOra,
      titolo,
      categoria: stato.categoria,
      // Fuori dalla vetrina la descrizione non si vede: non si manda.
      note: el('vetrina').checked ? el('note').value.trim() : '',
      serveApertura: el('apertura').checked,
      fissa: el('fissa').checked,
      ricorrenza: stato.ricorrenza,
      vetrina: el('vetrina').checked,
    });

    if (esito.inAttesa) {
      tg?.HapticFeedback?.notificationOccurred('success');
      tg?.showPopup?.({
        title: 'Richiesta mandata',
        message: 'Lo staff della sede deve approvarla. Ti scrivo appena ' +
                 'decidono: se dicono di sì, finisce sul calendario ' +
                 `${CADENZE[stato.ricorrenza]}.`,
        buttons: [{ type: 'ok' }],
      });
      if (!tg?.showPopup) toast('Richiesta mandata. Lo staff della sede deve approvarla.');
      el('titolo').value = '';
      el('note').value = '';
      el('apertura').checked = false;
      el('fissa').checked = false;
      el('vetrina').checked = false;
      stato.ricorrenza = 'settimanale';
      aggiornaCadenza();
      contaDescrizione();
      aggiornaEsito();
      sincronizzaVetrina();
      stato.passo = 1;
      mostra('mie');
      return;
    }

    const righe = ['Prenotato!'];
    if (esito.secondo) righe.push('Condividerete la sede con un altro gruppo: avvisali.');
    if (esito.avvisoStaff) righe.push(esito.avvisoStaff);
    else if (el('apertura').checked) righe.push('Ho chiesto allo staff di aprire.');

    tg?.HapticFeedback?.notificationOccurred('success');
    toast(righe.join(' '));

    el('titolo').value = '';
    el('note').value = '';
    contaDescrizione();
    el('apertura').checked = false;
    el('fissa').checked = false;
    el('vetrina').checked = false;
    stato.ricorrenza = 'settimanale';
    aggiornaCadenza();
    // La tessera appena creata cambia i suggerimenti: si rileggono.
    delete stato.serie;
    sincronizzaVetrina();
    dimenticaMesi();   // il giorno adesso e' diverso
    await caricaMese();
    await scegliGiorno(stato.giorno);
    stato.passo = 1;
    mostra('mie');
  } catch (err) {
    lamenta(err.message);
  } finally {
    attesaAzione(false);
  }
}
