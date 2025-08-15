const VW_PER_10MIN = 2;
document.documentElement.style.setProperty('--vw-per-10min', VW_PER_10MIN);


function eventCard(ev) {
  const categoria = ev.categoria || 'default';
  const tags = ev.tags?.length ? `<div class="tags">${ev.tags.map(t => `<span>${t}</span>`).join('')}</div>` : '';
  const imgDiv = ev.immagine
    ? `<div class="thumb" style="background-image:url('${ev.immagine}')"></div>`
    : `<div class="thumb ${categoria}-img"></div>`;


  return `
    <article class="card ${categoria}">
      ${imgDiv}
      <div class="card-body">
        <div class="header-line">
          <h3 class="title">${ev.nome}</h3>
          <span class="time">${ev.giorno} · ${ev.orainizio}–${ev.orafine}</span>
        </div>
        ${ev.descrizione ? `<p class="desc">${ev.descrizione}</p>` : ''}
      </div>
    </article>
  `;
}

function activityBar(ev) {

  const widthVW  = Math.max(1, (ev.durataMinuti / 10) * VW_PER_10MIN);
  const offsetVW = Math.max(0, (ev.offsetMinuti / 10) * VW_PER_10MIN);
  const cat = ev.categoria || 'default';

  return `
    <div class="bar ${cat}" style="width:${widthVW}vw; margin-left:${offsetVW}vw" title="${ev.nome}">
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



async function loadAndRender() {
  const res = await fetch('/api/weekly');
  const data = await res.json();

  document.getElementById('range').textContent =
    `Settimana: ${data.range.start} → ${data.range.end} (${data.tz})`;

  const eventiEl = document.getElementById('eventi');
  const attivitaEl = document.getElementById('attivita');

  eventiEl.innerHTML = data.aperti.map(eventCard).join('');
  attivitaEl.innerHTML = renderActivitiesByDay(data.chiusi);
}


loadAndRender();
document.body.classList.add('night');

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
