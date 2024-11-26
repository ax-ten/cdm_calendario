# Per cominciare
Installa i `requirements.txt`

## per avviare
devi possedere i file .env e keys.json con le credenziali (mettili nella main directory)
- esegui bot.py per avviare il bot telegram
    - /calendario mostra la prossima settimana
    - aggiorna automaticamente gli orari della sede su gmaps
- esegui background_browser per creare screenshot.png con la settimana corrente (3 giorni da oggi)
- esegui app.py per avviare il browser di visualizzazione

## per aggiungere un evento:
aggiungi un nome e tutti i tag che ne farebbero riferimento in event_types.txt:
```
harry: hogwarts, harry, potterheads, harrypotter
roll: roll, dark, rollinthedark, roll in the dark
gdr: gdr, rpg
```
aggiungi in colori_appuntamenti.css tutti gli stili relativi
```
/* HARRY POTTER */
.harry{background:#754da8;}
.harry-tag{background:#4b2977}
div.fullday_appuntamenti.harry > h4{
  font-size:37px;
  font-family: harry;
  letter-spacing: 0.1em;}
```

### per lamentarsi
dont
