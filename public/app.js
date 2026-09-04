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

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('it-IT', {
    day: 'numeric',
    month: 'long'
  });
}





async function loadAndRender(offset=0) {
  const res = await fetch(`${BASE}/api/weekly?offset=${offset}`); 
  const data = await res.json();

  document.getElementById('range').textContent +=
    `${formatDate(data.range.start)} → ${formatDate(data.range.end)}`;

  const eventiEl = document.getElementById('eventi');
  const attivitaEl = document.getElementById('attivita');

  eventiEl.innerHTML = data.aperti.map(eventCard).join('');
  attivitaEl.innerHTML = renderActivitiesByDay(data.chiusi);
}


loadAndRender(OFFSET);
document.body.classList.add('day');

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
