# Brief: mini app Telegram "Crocevia dei Mondi"

Interfaccia e commenti in italiano (commenti senza accenti, "e'"). Linguaggio
neutro (schwa solo se serve), trattino corto negli orari (18:00-21:00), date in
parole ("giovedì 5 novembre").

## Cosa fa
Mini app Telegram per i soci di un'associazione culturale con due sedi
(Trani, Barletta). Tre schede per tutti, più una per lo staff:
- **Attività**: prenotare la sede (Google Calendar) con un wizard a passi
  (Dove? → Quando? → Cosa fate? → riepilogo; barra di avanzamento in cima;
  scelta la sede si passa subito al calendario; in "Cosa fate?" prima la
  categoria, poi nome, vetrina e descrizione, che si apre solo con la vetrina),
  serie ricorrenti approvate
  dallo staff, "Modifica la data" di una data della serie (giorno, ora, sede),
  "Salta la prossima data". Per lo staff c'è "Prenotazioni": chi apre, chi non
  ha le chiavi, annullare date o serie.
- **Biblioteca**: catalogo beni (libri, giochi, manuali) su Odoo, prestito con
  "Annulla" nel toast, restituzione con foto, registro prestiti per lo staff,
  "Segna come prestato" (prestito a nome di un'altra persona), aggiunta bene in
  2 passi con ISBN e scanner. Gli avvisi di prestiti e restituzioni vanno in
  privato a chi ha "Amministra la biblioteca" in Odoo (responsabili_biblioteca);
  se nessuno è raggiungibile, al gruppo staff della sede.
- **Tessera**: tessera socio, contributi (Obolo, Mensilità, Evento) con
  totale e canali di pagamento (contanti in sede, PayPal, carta, bonifico; il
  pagamento dall'app non è ancora attivo, `PAGAMENTO_ATTIVO=false`). Ricevute
  in PDF. Il direttivo ha "Contributi": soci, mensilità, pagamenti, "Segna
  pagamenti".
- **Task** (solo staff, per ora solo dal link debug `?startapp=debug`): le
  task del modulo Progetti di Odoo. Elenco per scadenza (in ritardo, oggi,
  sette giorni, più avanti) con le mie, tutte o fatte, filtri per progetto ed
  etichetta; swipe per Fatta e Prendo io. Scheda con checklist, foto, commenti,
  Segna come fatta; modulo per creare o cambiare (nome, progetto, scadenza,
  ripetizione, persone, etichette, importante, attività collegata, note). Chi
  se ne occupa riceve gli avvisi in chat; il bot manda il promemoria del giorno
  prima (`interno/promemoria-task`). Il riepilogo del lunedì nei gruppi staff
  (`interno/riepilogo-task`) è sospeso: `RIEPILOGO_TASK_ATTIVO`.
- **Registrazione / primo tesseramento**: nome e cognome proposti da Telegram,
  da confermare come nomi veri. Il primo tesseramento si fa solo in sede; chi
  era già socio può rinnovare anche a distanza.

## Backend (Node, Express, ES modules)
- `server.js`: solo l'avvio.
- `config.js`: legge i txt (`sedi.txt`, `calendari.txt`, `staff.txt`,
  `gruppi.txt`, `categorie.txt`, `event_types.txt`).
- `sessione.js`: `conUtente` (verifica initData), ruoli staff/direttivo con
  cache, `controllaPrenotazione`.
- `prenotazioni.js`: Google Calendar (`estremi` con fuso Europe/Rome,
  `occupazione`, `spostaIstanza`, `chiudiSerie`, `segnaChiApre`, richieste
  periodiche, bloccati).
- `calendario.js`: auth Google, eventi di tutte le sedi, settimana pubblica
  (solo campi ammessi), Drive.
- `odoo.js`: JSON-RPC verso il modello `crocevia.miniapp` (i contratti sono
  descritti nei commenti, il modulo Odoo non è nel repo).
- `telegram.js`, `fisse.js` (approvazione delle serie), `soci.js`, `isbn.js`,
  `erroriPagina.js`, `util.js` (Cache, `inFila`, `senzaDoppioni`,
  `mappaConLimite`), `jsonStore.js` (file in `dati/`).
- `rotte/`: `prenota.js` (prenota, mie, annulla, sposta, settimanale),
  `inventario.js`, `tessere.js`, `staff.js`, `task.js` (task dello staff su
  Odoo: `task_elenco`, `task_dettaglio`, `task_salva`, ...), `account.js` (stato,
  registrazione, iscrizione), `interno.js` (chiamate del bot, protette da
  `soloBot`), `pubblico.js` (calendario pubblico `/api/weekly`).
- Mancano nel repo (e servono per avviare): `drive_key.json`,
  `calendar_key.json`, `bot_token.txt`, `odoo.json`.

## Frontend: `public/prenota/` (vanilla JS, nessuna build)
`index.html` contiene solo l'HTML; lo stile è in `stile.css`. Script classici
con globali condivise, caricati in quest'ordine:
`base.js` (el, esc, html`` con escape, chiama, toast, conferme, giri contro le
risposte vecchie) → `componenti.js` (pulsanti tondi, swipe `scorrevoli`, menu
della riga `menuDellaRiga`, foglio dal basso) → `prenota.js` (wizard, sposta)
→ `mie.js` → `iscrizione.js` → `inventario.js` → `aggiungi-bene.js` →
`tessera.js` → `quote.js` (Contributi, pagamenti, incassi) → `gestione.js`
(staff) → `task.js` (scheda Task) → `avvio.js` (mostra, indietro, avvia).

Scelte UX già decise:
- swipe: un'azione per lato (sinistra distruttiva, destra alternativa);
  la scritta resta ancorata al bordo e si stira al massimo del 50%;
- un tocco sulla riga apre il menu contestuale sotto la riga, con icone a sinistra;
- filtri senza numeri, con l'etichetta a sinistra;
- scritte accanto ai pulsanti tondi solo con la pagina in cima (scorrendo
  spariscono, classe `scorsa` su `<html>`);
- in Biblioteca l'etichetta di stato c'è solo per i beni non disponibili; niente pulsanti "scorciatoia"
  che sembrano filtri (es. tolti "Questo mese"/"Tutto l'anno" in Tessera);
- "Crea" sul pulsante tondo in Attività;
- "Stripe" non si mostra mai: si scrive "Carta".

Il calendario pubblico è una pagina a parte (`public/index.html`, `app.js`).

## Demo
Artifact claude.ai "Crocevia app demo" (slug
8ebbcaf9-96ce-4d0c-8d3b-dfe93c72d087): un file unico costruito da uno script
che inserisce un'API finta (`finto.js`) al posto delle chiamate vere e
sostituisce le due `fetch` di `base.js` con `window.apiDemo`. Non usa
l'immagine della tessera (`sfondo-tessera.jpg` resta per la build vera).
Script di build e test Playwright non sono nel repo: se servono, vanno rifatti.

## Aperto
- Caso "Da rimettere": lo staff annulla una data, il socio riceve una notifica
  e sceglie quando rimetterla (nessun promemoria).
- Decidere se lo staff di una sede può agire sulle altre sedi.
- Data spostata su un'altra sede: diventa una data singola e non porta con sé
  chi apre (da confermare).
- IBAN e link PayPal/carta (costanti vuote in `tessera.js`).
- "Tutti quelli che mancano" in Contributi: toglierlo come in Tessera?
- Scheda Task: aprirla a tutto lo staff (fuori dal link debug) e riattivare
  il riepilogo del lunedì.
- Da provare dal vivo (Google, Telegram, Odoo): cambio d'ora, spostamento su
  un'altra sede, pagamento doppio, annullamento del prestito.
