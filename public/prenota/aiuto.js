// Il pulsante "?": come funziona la scheda in cui si e', a chi scrivere per
// la biblioteca, dove sono le sedi, una segnalazione al direttivo e dove
// stanno i propri dati. Si apre in un foglio dal basso.

const AIUTO_VALIDO_MS = 10 * 60 * 1000;
let aiutoDati = null;
let aiutoLetto = 0;

// Cosa dire per ogni scheda: poche righe, quelle che servono la prima volta.
function guidaScheda(scheda) {
  const giorni = inv.giorni || 30;
  return {
    inventario: ['La biblioteca', [
      `Cerca un libro o un gioco, toccalo e premi «Prendi in prestito»: è tuo per ${giorni} giorni. Se ne prende uno alla volta.`,
      'Per restituirlo rimettilo al suo posto in sede e premi «L’ho restituito»: ti chiedo una foto del bene sullo scaffale.',
      'Tre giorni prima della scadenza ti scrivo in chat. Se ti serve più tempo, chiedi alle referenti qui sotto.',
    ]],
    mie: ['Le attività', [
      'Con il + prenoti una stanza: sede, giorno e orario, cosa fate. Se in quelle ore la sede è piena te lo dico subito.',
      'Senza chiavi? Spunta «Non ho le chiavi»: lo staff riceve un messaggio e viene ad aprire.',
      'Le attività che si ripetono le approva lo staff della sede. Da «Le tue attività» sposti una data, ne salti una o la cancelli.',
    ]],
    tessera: ['La tessera', [
      'Qui vedi la tua tessera e le mensilità pagate.',
      '«Contribuisci» ti dice quanto e come pagare. Le ricevute sono in «Le mie ricevute»: te le mando in chat.',
    ]],
    task: ['Le task', [
      'Le cose da fare dello staff. «Prendo io» per occupartene; scorri una riga per segnarla fatta.',
      'Chi se ne occupa riceve un messaggio quando gliela affidano e il giorno prima della scadenza.',
    ]],
  }[scheda];
}

const schedaAttuale = () => ['inventario', 'mie', 'tessera', 'task'].find(p => !el(`pannello-${p}`).hidden) || 'mie';
const apriLinkTelegram = (link) => { if (tg?.openTelegramLink) tg.openTelegramLink(link); else window.open(link, '_blank'); };
const apriLinkEsterno = (link) => { if (tg?.openLink) tg.openLink(link); else window.open(link, '_blank'); };

async function apriAiuto() {
  const scheda = schedaAttuale();
  const [titolo, righe] = guidaScheda(scheda);
  const sedi = (stato.sediInfo || []).filter(s => s.indirizzo);
  const corpo = apriFoglio(`
    <h2>${esc(titolo)}</h2>
    ${righe.map(r => `<p class="riga-aiuto">${esc(r)}</p>`).join('')}

    <h2 class="titolo-aiuto">Referenti della biblioteca</h2>
    <div id="referenti-aiuto"><p class="nota-pagamento">Carico…</p></div>

    ${sedi.length ? `<h2 class="titolo-aiuto">Le sedi</h2>
    <div class="sedi-aiuto">${sedi.map(s => `
      <button type="button" class="riga sede-aiuto" data-indirizzo="${esc(`${s.indirizzo}`)}">
        <b>${esc(s.nome)}</b><span class="quando">${esc(s.indirizzo)} · apri la mappa</span>
      </button>`).join('')}</div>` : ''}

    <h2 class="titolo-aiuto">Qualcosa non va?</h2>
    <div class="campo">
      <textarea id="testo-segnala" maxlength="1500" placeholder="Scrivi cosa è successo: arriva al direttivo, con la scheda in cui sei."></textarea>
    </div>
    <button type="button" class="bottone secondario largo" id="invia-segnala">Manda la segnalazione</button>

    <p class="nota-pagamento dati-aiuto">I tuoi dati: scrivi /mydata al bot per vederli o cancellarli.</p>`);

  corpo.querySelectorAll('[data-indirizzo]').forEach(b => {
    b.onclick = () => apriLinkEsterno(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.dataset.indirizzo)}`);
  });
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
  const referenti = aiutoDati?.referenti || [];
  dove.innerHTML = referenti.length ? referenti.map(r => r.username
    ? `<button type="button" class="riga referente-aiuto" data-chat="${esc(r.username)}"><b>${esc(r.nome)}</b><span class="quando">scrivi in chat</span></button>`
    : `<div class="riga referente-aiuto"><b>${esc(r.nome)}</b><span class="quando">in sede</span></div>`).join('')
    : '<p class="nota-pagamento">Per la biblioteca chiedi allo staff in sede.</p>';
  dove.querySelectorAll('[data-chat]').forEach(b => { b.onclick = () => apriLinkTelegram(`https://t.me/${b.dataset.chat}`); });
}
