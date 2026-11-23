// Il pulsante "?": come funziona la scheda in cui si e', a chi scrivere per
// la biblioteca, dove sono le sedi, una segnalazione al direttivo e dove
// stanno i propri dati. Si apre in un foglio dal basso.

const AIUTO_VALIDO_MS = 10 * 60 * 1000;
let aiutoDati = null;
let aiutoLetto = 0;

// Cosa dire per ogni scheda: il titolo e due righe, non di piu'.
function guidaScheda(scheda) {
  const giorni = inv.giorni || 30;
  return {
    inventario: ['La biblioteca', inv.gestore
      ? `Da qui prendi in prestito libri e giochi, uno alla volta per ${giorni} giorni, e tieni i prestiti degli altri. Per restituirlo premi «L’ho restituito» e manda una foto.`
      : `Da qui vedi cosa c’è. Per prendere un libro o un gioco passa in sede: chi è di turno lo segna per te, per ${giorni} giorni. Per restituirlo premi «L’ho restituito» e manda una foto.`],
    mie: ['Le tue attività', 'Da qui puoi prenotare una stanza e gestire i tuoi appuntamenti. Premi + per crearne una nuova.'],
    tessera: ['La tua tessera', 'Da qui vedi la tua tessera, le mensilità pagate e le ricevute. «Contribuisci» ti dice quanto e come pagare.'],
    task: ['Le task', 'Le cose da fare dello staff. «Prendo io» per occupartene, scorri una riga per segnarla fatta.'],
  }[scheda];
}

const schedaAttuale = () => ['inventario', 'mie', 'tessera', 'task'].find(p => !el(`pannello-${p}`).hidden) || 'mie';
const apriLinkTelegram = (link) => { if (tg?.openTelegramLink) tg.openTelegramLink(link); else window.open(link, '_blank'); };
const apriLinkEsterno = (link) => { if (tg?.openLink) tg.openLink(link); else window.open(link, '_blank'); };

// Il navigatore con la sede come destinazione: il link di Google Maps apre
// l'app, se c'e', gia' sul percorso.
const linkPercorso = (indirizzo) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(indirizzo)}`;

async function apriAiuto() {
  const scheda = schedaAttuale();
  const [titolo, guida] = guidaScheda(scheda);
  const sedi = (stato.sediInfo || []).filter(s => s.indirizzo);
  // Prima come funziona la scheda e dove sono le sedi, poi la segnalazione
  // e i propri dati; le referenti solo in biblioteca, in fondo.
  const corpo = apriFoglio(`
    <h2>${esc(titolo)}</h2>
    <p class="riga-aiuto">${esc(guida)}</p>

    ${sedi.length ? `<h2 class="sezione-aiuto">Le sedi</h2>
    <div class="sedi-aiuto">${sedi.map(s => `
      <button type="button" class="riga sede-aiuto" data-indirizzo="${esc(s.indirizzo)}" aria-label="Portami a ${esc(s.nome)}, ${esc(s.indirizzo)}">
        <span class="testa-sede"><b>${esc(s.nome)}</b><span class="vai-sede">Vai ›</span></span>
        <span class="quando">${esc(s.indirizzo)}</span>
      </button>`).join('')}</div>` : ''}

    <h2 class="sezione-aiuto">Qualcosa non va?</h2>
    <div class="campo">
      <textarea id="testo-segnala" maxlength="1500" placeholder="Scrivi cosa è successo: arriva al direttivo, con la scheda in cui sei."></textarea>
    </div>
    <button type="button" class="bottone secondario largo" id="invia-segnala">Manda la segnalazione</button>

    <h2 class="sezione-aiuto">I tuoi dati</h2>
    <p class="riga-aiuto">Conserviamo nome, tessera associativa, quali libri hai preso in prestito, ecc.</p>
    <button type="button" class="bottone secondario largo" id="miei-dati">Richiedi i tuoi dati</button>
    <p class="nota-pagamento">Te li mando in chat, con il pulsante per cancellarli.</p>

    ${scheda === 'inventario' ? `<h2 class="sezione-aiuto">Referenti della biblioteca</h2>
    <div id="referenti-aiuto"><p class="nota-pagamento">Carico…</p></div>` : ''}`);

  corpo.querySelectorAll('[data-indirizzo]').forEach(b => {
    b.onclick = () => apriLinkEsterno(linkPercorso(b.dataset.indirizzo));
  });
  el('miei-dati').onclick = async () => {
    el('miei-dati').disabled = true;
    try {
      await chiama('aiuto/miei-dati');
      toast('Te li ho scritti in chat.');
    } catch (err) {
      lamenta(err.message);
    }
    el('miei-dati').disabled = false;
  };
  el('invia-segnala').onclick = async () => {
    const testo = el('testo-segnala').value.trim();
    if (testo.length < 5) return toast('Scrivi cosa non va, anche in poche parole.', false);
    el('invia-segnala').disabled = true;
    try {
      await chiama('aiuto/segnala', { testo, pagina: scheda });
      chiudiFoglio();
      toast('Segnalazione mandata: grazie!');
    } catch (err) {
      el('invia-segnala').disabled = false;
      lamenta(err.message);
    }
  };
  if (scheda !== 'inventario') return;

  if (!aiutoDati || Date.now() - aiutoLetto > AIUTO_VALIDO_MS) {
    try {
      aiutoDati = await chiama('aiuto');
      aiutoLetto = Date.now();
    } catch {
      aiutoDati = null;
    }
  }
  const dove = el('referenti-aiuto');
  if (!dove?.isConnected) return;
  // Chi si puo' scrivere in chat ha il nome in chiaro; chi non ha (ancora)
  // Telegram collegato, o non ha uno username, resta in grigio.
  const referenti = aiutoDati?.referenti || [];
  dove.innerHTML = referenti.length ? referenti.map(r => r.username
    ? `<button type="button" class="riga referente-aiuto" data-chat="${esc(r.username)}" aria-label="Scrivi in chat a ${esc(r.nome)}">${esc(r.nome)}</button>`
    : `<div class="riga referente-aiuto spenta">${esc(r.nome)}</div>`).join('')
    : '<p class="nota-pagamento">Per la biblioteca chiedi allo staff in sede.</p>';
  dove.querySelectorAll('[data-chat]').forEach(b => { b.onclick = () => apriLinkTelegram(`https://t.me/${b.dataset.chat}`); });
}
