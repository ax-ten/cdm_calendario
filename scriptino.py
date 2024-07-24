import datetime
import locale
import os
import asyncio
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

# # Stampa gli eventi divisi per giorno in ordine
# for event_date, events_list in events_per_day.items():
#     print(f"Eventi del {event_date.strftime('%a')}:")
#     for event in events_list:
#         start = event["start"].get("dateTime", event["start"].get("date"))
#         starttime = datetime.datetime.fromisoformat(start).strftime("%H:%M")
#         print(f"{starttime} - {event['summary']}")
#     print()

def getItemsFromDescription(description):
    COLORE_GDR = "#E3583B"
    COLORE_GDT = "#6E71C2"
    COLORE_MANA = "#b365db"
    COLORE_CLUB = "#68a5a8"
    COLORE_RIUNIONE = "#EF6C00"
    COLORE_ESTERNO = "#0B8043"
    COLORE_DEFAULT = "#EF6C00"

    SRC = "/static/src/"
    IMMAGINE_GDR = SRC+"GdR.png"
    IMMAGINE_GDT = SRC+"GdT.png"
    IMMAGINE_MANA = SRC+"Mana.png"
    IMMAGINE_BOOK = SRC+"Book.png"
    IMMAGINE_ESTERNO = SRC+"Canale.png"
    IMMAGINE_DEFAULT = SRC+"Fenice.png"
    IMMAGINE_RIUNIONE = IMMAGINE_DEFAULT
    IMMAGINE_TECNICHEMISTE = SRC+"Tecniche.png"
    IMMAGINE_SCRITTURACREATIVA = SRC+"Scrittura.png"

    if description is None:
        return COLORE_DEFAULT, IMMAGINE_DEFAULT

    match description.lower():
        case "gdr"|"rpg":
            return COLORE_GDR, IMMAGINE_GDR
        case "gdt":
            return COLORE_GDT, IMMAGINE_GDT
        case "riunione":
            return COLORE_RIUNIONE, IMMAGINE_RIUNIONE
        case "mana"|"mana vault":
            return COLORE_MANA, IMMAGINE_MANA
        case "esterno"|"open":
            return COLORE_ESTERNO, IMMAGINE_ESTERNO
        case "lettura"|"bookclub"|"book"|"club del libro"|"mondi tra le righe":
            return COLORE_CLUB, IMMAGINE_BOOK
        case "tecnichemiste"|"tecniche miste"|"tecniche"|"tm":
            return COLORE_CLUB, IMMAGINE_TECNICHEMISTE
        case "scrittura"|"scritturacreativa"|"scrittura creativa":
            return COLORE_CLUB, IMMAGINE_SCRITTURACREATIVA
    
    return COLORE_DEFAULT, IMMAGINE_DEFAULT

def getContenuto(events_per_day):
    date = list(events_per_day.keys())
    startday = date [0].strftime('%d '+("" if date[0].month == date[-1].month else " %B"))
    endday =   date[-1].strftime('%d %B')
    contenuto = f"<p class='header'>{startday} - {endday}</p><hr>"
    for event_date, events_list in events_per_day.items():
        contenuto += getDayDiv(event_date)
        for event in events_list:
            start = event["start"].get("dateTime", event["start"].get("date"))
            end   = event["end"].  get("dateTime", event["end"].  get("date"))
            starttime = datetime.datetime.fromisoformat(start).strftime("%H:%M")
            endtime   = datetime.datetime.fromisoformat(end).  strftime("%H:%M")
            summary   = event['summary']
            color, icon = getItemsFromDescription(event.get('description'))
            contenuto  += getAppuntamentoSlotDiv (starttime, endtime, summary, color, icon)
        contenuto += "</div></div>" # Chiudi appuntamenti
    contenuto += "</div>" # Chiudi Day
    return contenuto

def getDayDiv(event_date):
    

    return f"<div class=\"day\">\
        <div class=\"day_div\">\
            <p class=\"day_name\">{event_date.strftime('%a')}</p>\
            <p class=\"day_num\">{event_date.strftime('%#d')}</p>\
        </div>\
        <div class=\"appuntamenti\">"

def getAppuntamentoSlotDiv(starttime, endtime, summary, color, icon):
    slotdiv = f"<div class=\"appuntamento_slot\">\
                <img src=\"{icon}\" height=\"60\" width=\"auto\" alt=\"\">\
                <div class=\"appuntamento\" style=\"background:{color}\">\
                    <p class=\"appuntamento_name\">{summary}</p>"
    
    if starttime != endtime: ## Se non è un evento che dura una giornata intera              
        slotdiv+=f"<p class=\"appuntamento_orario\">{starttime} - {endtime}</p>"

    return slotdiv + f"</div></div>"
    
async def getCreds():
    creds = service_account.Credentials.from_service_account_file(
        os.getenv("GOOGLE_APPLICATION_CREDENTIALS"),
        scopes=["https://www.googleapis.com/auth/calendar.readonly"],
    )  
    time.sleep(1) # Dormi due secondi così carica correttamente tutto
    return creds

def getContenutoFinale():
    locale.setlocale(locale.LC_ALL, 'it_IT')

    # Carica le variabili di ambiente da un file .env
    load_dotenv()

    credentials = asyncio.run(getCreds())

    # Crea un'istanza del servizio del calendario
    service = build("calendar", "v3", credentials=credentials)

    events_result = query(service, day=datetime.date.today() + datetime.timedelta(days=2))
    epd = getEventsPerDay(events_result)

    return getContenuto(epd)

import pprint
if __name__ == "__main__":
    locale.setlocale(locale.LC_ALL, 'it_IT')

    # Carica le variabili di ambiente da un file .env
    load_dotenv()

    credentials = asyncio.run(getCreds())

    # Crea un'istanza del servizio del calendario
    service = build("calendar", "v3", credentials=credentials)

    events_result = query(service)
    epd = getEventsPerDay(events_result)
    pprint.pprint(epd)


    #TODO output immagine
    