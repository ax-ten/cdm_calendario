import datetime
import locale
import os
import asyncio
import re

import time
from dotenv import load_dotenv
from google.oauth2 import service_account
from googleapiclient.discovery import build

def query(service, day=datetime.date.today()):
    # Ottieni la data di inizio e fine per la settimana in cui day appartiene, default today
    start_of_week = day - datetime.timedelta(days=day.weekday())
    end_of_week = start_of_week + datetime.timedelta(days=6)

    # Formatta le date per la query
    start_date = start_of_week.isoformat() + "T00:00:00Z"
    end_date = end_of_week.isoformat() + "T23:59:59Z"

    # Elenca gli eventi del calendario per la settimana corrente
    events_result = service.events().list(
        calendarId=os.getenv("calendar_id"),
        timeMin=start_date,
        timeMax=end_date,
        singleEvents=True,
        orderBy="startTime",
    ).execute()
    return events_result


def getEventsPerDay(events_result):
    events = events_result.get("items", [])
    # Crea un dizionario per organizzare gli eventi per giorno
    events_per_day = {}

    # Popola il dizionario con gli eventi divisi per giorno
    for event in events:
        start = event["start"].get("dateTime", event["start"].get("date"))
        event_date = datetime.datetime.fromisoformat(start).date()

        if event_date in events_per_day:
            events_per_day[event_date].append(event)
        else:
            events_per_day[event_date] = [event]

    # Ordina gli eventi all'interno di ciascun giorno in base all'orario di inizio
    for events_list in events_per_day.values():
        events_list.sort(key=lambda x: x["start"].get("dateTime", x["start"].get("date")))
    return events_per_day


def getItemsFromDescription(description):
    GDR = "gdr"
    GDT = "gdt"
    ROLL = "roll"
    TWITCH = "twitch"
    MANA_VAULT = "mana"
    BOOK_CLUB = "libro"
    WRITE_CLUB = "penna"
    DRAW_CLUB = "disegno"
    RIUNIONE = "riunione"
    ESTERNO = "esterno"
    FRULLATORI = "frullatori"
    GAMING = "gaming"
    DEFAULT = "default"

    #Altri eventi sporadici
    HARRYPOTTER = "harry"
    PRIDE = "pride"
    NINTENDO = 'nintendo'
    HALLOWEEN = 'halloween'

    if description is None:
        return DEFAULT, []
    tags = re.split("\s#", description)
    match tags[0].lower():
        case "allouin"|"halloween":
            return HALLOWEEN, tags[1:]
        case "frullatori"|"3d"|"blender":
            return FRULLATORI, tags[1:]
        case "nintendo":
            return NINTENDO, tags[1:]
        case "gaming"|'game'|'videgiochi'|'vg':
            return GAMING, tags[1:]
        case "pride":
            return PRIDE, tags[1:]
        case "hogwarts"|"harry"|"potterheads"|"harrypotter":
            return HARRYPOTTER, tags[1:]
        case "roll"|"dark"|"rollinthedark"|"roll in the dark":
            return ROLL, tags[1:]
        case "gdr"|"rpg":
            return GDR, tags[1:]
        case "gdt":
            return GDT, tags[1:]
        case "riunione":
            return RIUNIONE, tags[1:]
        case "mana"|"mana vault":
            return MANA_VAULT, tags[1:]
        case "live"|"twitch":
            return TWITCH, tags[1:]
        case "esterno"|"open":
            return ESTERNO, tags[1:]
        case "lettura"|"bookclub"|"book"|"club del libro"|"mondi tra le righe":
            return BOOK_CLUB, tags[1:]
        case "disegno"|"matitozze"|"tecniche"|"tm":
            return DRAW_CLUB, tags[1:]
        case "scrittura"|"scritturacreativa"|"scrittura creativa":
            return WRITE_CLUB, tags[1:]
    return DEFAULT, tags[1:]

def getContenuto(events_per_day):
    date = list(events_per_day.keys())
    # se il mese del giorno iniziale e finale non coincidono, specifica entrambi
    startday = date[0].strftime('%d '+("" if date[0].month == date[-1].month else " %B"))
    endday = date[-1].strftime('%d %B')
    contenuto = f"<p class='header'>{startday} - {endday}</p><hr>"

    #per ogni lista di eventi di giornata
    for event_date, events_list in events_per_day.items():

        contenuto += openDayDiv(event_date, events_list[0])        

        #per ogni evento nella lista della giornata
        for event in events_list:
            if isFullDayEvent(event):
                continue

            starts_at, ends_at = eventTime(event)
            summary = event['summary']
            type, tags = getItemsFromDescription(event.get('description'))
            contenuto += getAppuntamentoSlotDiv(starts_at, ends_at, summary, type, tags)
        
        if isFullDayEvent(events_list[0]):
            pass#contenuto += "dudidadada </div>"

        contenuto += "</div></div>" # Chiudi appuntamenti
    contenuto += "</div>" # Chiudi Day
    return contenuto

def eventTime(event):
        start = event["start"].get("dateTime", event["start"].get("date"))
        end = event["end"].get("dateTime", event["end"].get("date"))
        starttime = datetime.datetime.fromisoformat(start).strftime("%H:%M")
        endtime = datetime.datetime.fromisoformat(end).strftime("%H:%M")
        return starttime, endtime

def isFullDayEvent(event):
        return eventTime(event)[0] == eventTime(event)[1]

def openDayDiv(event_date, starting_event):
    daydiv = f"<div class=\"day\">\
        <div class=\"day_div\">\
            <p class=\"day_name\">{event_date.strftime('%a')}</p>\
            <p class=\"day_num\">{event_date.strftime('%#d')}</p>\
        </div>"
    
    if isFullDayEvent(starting_event): #Placeholder pride month, sostituisci quando ci sono altri eventi giornalieri
        type, tags = getItemsFromDescription(starting_event.get('description'))
        return daydiv + f"<div class=\"fullday_appuntamenti {type}\"> <h4>{starting_event['summary']}</h4>"
    else:
        return daydiv + "<div class=\"appuntamenti\">"

def getAppuntamentoSlotDiv(starttime, endtime, summary, type, tags):
    slotdiv = f"<div class=\"appuntamento_slot\">\
                <div class=\"img {type}-img\"></div>\
                <div class=\"appuntamento {type}\">\
                    <p class=\"appuntamento_name\">{summary}</p>\
                    <div class=\"sub-items_wrapper\">"
                            
    if starttime != endtime: ## Se non è un evento che dura una giornata intera     
        slotdiv+=f"<span class=\"sub_item orario\">{starttime} - {endtime}</span>"
    
    for tag in tags:
        innertext = tag
        if tag == "Pride":
            slotdiv+=f"<span class=\"sub_item pride\">{innertext}</span>"
            continue
        if "pos:" in tag:
            tag = tag.split("pos:")[1]
            innertext = f"<span style=\"font-size: 12px;\">📍</span>{tag}"
        slotdiv+=f"<span class=\"sub_item {type}-tag\">{innertext}</span>"

    return slotdiv + f"</div></div></div>"
    
async def getCreds():
    creds = service_account.Credentials.from_service_account_file(
        os.getenv("GOOGLE_APPLICATION_CREDENTIALS"),
        scopes=["https://www.googleapis.com/auth/calendar.readonly"],
    )  
    time.sleep(1) # Dormi due secondi così carica correttamente
    return creds

def getContenutoFinale(daysforward=2):
    locale.setlocale(locale.LC_ALL, 'it_IT.utf8')

    # Carica le variabili di ambiente da un file .env
    load_dotenv()

    credentials = asyncio.run(getCreds())

    # Crea un'istanza del servizio del calendario
    service = build("calendar", "v3", credentials=credentials)

    events_result = query(service, day=datetime.date.today() + datetime.timedelta(days=daysforward))
    epd = getEventsPerDay(events_result)

    return getContenuto(epd)

import pprint
if __name__ == "__main__":
    locale.setlocale(locale.LC_ALL, 'it_IT.utf8')

    # Carica le variabili di ambiente da un file .env
    load_dotenv()

    credentials = asyncio.run(getCreds())

    # Crea un'istanza del servizio del calendario
    service = build("calendar", "v3", credentials=credentials)

    events_result = query(service)
    epd = getEventsPerDay(events_result)
    pprint.pprint(epd)


    #TODO output immagine
    #TODO differenziare eventi fuorisede
    