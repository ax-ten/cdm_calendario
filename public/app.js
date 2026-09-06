const VW_PER_10MIN = 2;
document.documentElement.style.setProperty('--vw-per-10min', VW_PER_10MIN);
const BASE = window.location.pathname.startsWith('/calendario') ? '/calendario' : '';

// Settimana da mostrare: 0 = questa, 1 = la prossima. Di default questa, come
// prima. Il parametro serve al bot Telegram, che di domenica deve fotografare
// la settimana che sta per cominciare (?offset=1) e di lunedi' la stessa
// settimana, ormai corrente (?offset=0).
const OFFSET = (() => {
  const raw = new URLSearchParams(window.location.search).get('offset');
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
})();

// ?giorno=oggi oppure ?giorno=2026-09-14: mostra solo quel giorno, tutto in
// forma di barre. Serve a /calendario oggi, che deve dire cosa succede stasera
// e non fotografare tutta la settimana per farlo.
const GIORNO = (() => {
  const raw = new URLSearchParams(window.location.search).get('giorno');
  if (!raw) return null;
  if (raw === 'oggi') {
    // In locale, non in UTC: alle 23 di sera toISOString() darebbe domani.
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
})();

function sedeBadge(ev) {
  if (!ev.sedeNome) return '';
  const cls = ev.sedeEsterna ? 'esterna' : (ev.sede || 'default');
  return `<span class="sede-badge sede-${cls}" title="${ev.sedeIndirizzo || ev.sedeNome}">${ev.sedeNome}</span>`;
}




function eventCard(ev) {
  const categoria = ev.categoria || 'default';
  const tags = ev.tags?.length
    ? `<div class="tags">${ev.tags.map(t => `<span class="${categoria}-tag">${t}</span>`).join('')}</div>`
    : '';

  return `
    <article class="card ${categoria}">
      <div class="thumb-wrapper">
        <img class="thumb thumb-img" src="${BASE}/immagine/${categoria}">
      </div>
      <div class="card-body">
        ${sedeBadge(ev)}
        <div class="header-line">
          <h1 class="title">${ev.nome}</h1>
          <span class="time"><strong>${ev.giorno}</strong> dalle ${ev.orainizio}</span>
        </div>
        <div class="description-line">
          ${ev.verbose}
        </div>
      </div>
    </article>
  `;
}


function activityBar(ev) {

  const widthVW  = Math.max(1, (ev.durataMinuti / 10) * VW_PER_10MIN);
  const offsetVW = Math.max(0, (ev.offsetMinuti / 10) * VW_PER_10MIN);
  const cat = ev.categoria || 'default';

  // Il logo della sede dice dove si va, che e" l informazione che manca
  // guardando una barra. La categoria si capisce gia" dal colore e dal nome,
  // quindi l icona serve meglio a questo. Fuori sede non ha un logo: li"
  // resta l icona della categoria, come le sedi nuove finche" non ne hanno
  // uno (l onerror copre quel caso invece di lasciare un'immagine rotta).
  const iconaCategoria = `${BASE}/src/${cat}.png`;
  const sedeSlug = ev.sedeEsterna ? '' : (ev.sede || '');
  const icona = sedeSlug ? `${BASE}/src/sede-${sedeSlug}.png` : iconaCategoria;

  return `
    <div class="bar ${cat}" style="width:${widthVW}vw; margin-left:${offsetVW}vw" title="${ev.nome}${ev.sedeNome ? ' - ' + ev.sedeNome : ''}">
      <img class="bar-icon" src="${icona}" alt="${ev.sedeNome || cat}" onerror="this.onerror=null;this.src='${iconaCategoria}'">
      <span class="title">${ev.nome || 'Senza titolo'}</span>
    </div>
  `;
}


// Render schermate
function renderActivitiesByDay(attivita) {
  // Raggruppa per dayKey preservando l’ordine di data
  const groups = new Map();
  for (const a of attivita) {
    if (!groups.has(a.dayKey)) {
      groups.set(a.dayKey, {
        dayNum: a.dayNum,
        dayAbbr: a.dayAbbr,
        items: []
      });
    }
    groups.get(a.dayKey).items.push(a);
  }

  // Ordina internamente per orario di inizio (e durata in caso di pari)
  for (const { items } of groups.values()) {
    items.sort(
      (x, y) =>
        x.offsetMinuti - y.offsetMinuti ||
        y.durataMinuti - x.durataMinuti
    );
  }

  // Renderizza
  let html = '';
  for (const { dayNum, dayAbbr, items } of groups.values()) {
    html += `
      <div class="day-row">
        <div class="day-label">
          <span class="day-num">${dayNum}</span>
          <span class="day-abbr">${dayAbbr}</span>
        </div>
        <div class="day-track">
          ${items.map(activityBar).join('')}
        </div>
      </div>
    `;
  }

  return html;
}

// La fascia disegnata finisce dove finisce la track: con lo scatto a 600px
// sono le 23:30. Le barre sono in vw, quindi un evento che va oltre sporge dal
// contenitore, e lo screenshot si allarga per non tagliarlo: viene fuori
// un'immagine piu' larga del calendario, con l'ultima ora senza riga sotto.
// Meglio fermare la barra al bordo. L'angolo destro resta dritto: e' il segno
// che l'attivita' continua, mentre l'angolo tondo direbbe che finisce li'.
function troncaAlBordo() {
  for (const track of document.querySelectorAll('.day-track')) {
    const bordo = track.getBoundingClientRect().right;
    for (const bar of track.querySelectorAll('.bar')) {
      const box = bar.getBoundingClientRect();
      if (box.right <= bordo + 0.5) continue;
      bar.style.width = Math.max(2, bordo - box.left) + 'px';
      bar.classList.add('troncata');
    }
  }
}


function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('it-IT', {
    day: 'numeric',
    month: 'long'
  });
}





// Quante settimane separano il giorno chiesto da quella corrente. L API
// restituisce una settimana per volta: senza questo, chiedere un giorno della
// settimana prossima darebbe "nessuna attivita" invece delle sue attivita.
function offsetPerGiorno(giorno) {
  const lunediDi = (d) => {
    const x = new Date(d);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const differenza = lunediDi(new Date(giorno + 'T12:00:00')) - lunediDi(new Date());
  return Math.round(differenza / (7 * 24 * 3600 * 1000));
}

async function loadAndRender(offset=0) {
  if (GIORNO) offset = offsetPerGiorno(GIORNO);
  const res = await fetch(`${BASE}/api/weekly?offset=${offset}`); 
  const data = await res.json();

  const eventiEl = document.getElementById('eventi');
  const attivitaEl = document.getElementById('attivita');

  if (GIORNO) {
    renderSoloUnGiorno(data);
    return;
  }

  document.getElementById('range').textContent +=
    `${formatDate(data.range.start)} → ${formatDate(data.range.end)}`;

  eventiEl.innerHTML = data.aperti.map(eventCard).join('');
  attivitaEl.innerHTML = renderActivitiesByDay(data.chiusi);
  troncaAlBordo();
}

// La vista di un giorno solo: niente schede in cima, tutto diventa una barra.
// Le schede servono a promuovere le attivita aperte nella settimana; qui la
// domanda e "cosa c'e stasera", e la risposta si legge meglio in una riga sola.
function renderSoloUnGiorno(data) {
  document.getElementById('schermata-eventi').hidden = true;
  document.getElementById('eventi').hidden = true;

  const delGiorno = [...data.aperti, ...data.chiusi]
    // Chi comincia prima della fascia disegnata non ha un posto dove stare, e
    // metterlo al bordo sinistro direbbe un orario falso.
    .filter(ev => ev.dayKey === GIORNO && !ev.primaDellaFascia)
    .sort((a, b) => String(a.startISO).localeCompare(String(b.startISO)));

  const titolo = document.querySelector('#schermata-attivita h4');
  const quando = new Date(GIORNO + 'T12:00:00');
  titolo.textContent = quando.toLocaleDateString('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long',
  }).replace(/^./, c => c.toUpperCase());

  document.getElementById('attivita').innerHTML = delGiorno.length
    ? renderActivitiesByDay(delGiorno)
    : '<p class="niente">Nessuna attivita in programma.</p>';
  troncaAlBordo();
}


loadAndRender(OFFSET);
document.body.classList.add('day');

// ?sfondo=bianco: serve alla versione per le storie, che monta questo
// screenshot su una tela bianca. Col grigio di sempre si vedrebbe il
// riquadro incollato sopra.
if (new URLSearchParams(window.location.search).get('sfondo') === 'bianco') {
  document.body.style.background = '#ffffff';
}

document.addEventListener('keydown', (e) => {
  // Evita che lo spazio faccia scroll
  if (e.code === 'Space') {
    e.preventDefault();

    if (document.body.classList.contains('night')) {
      document.body.classList.remove('night');
      document.body.classList.add('day');
    } else {
      document.body.classList.remove('day');
      document.body.classList.add('night');
    }
  }
});
