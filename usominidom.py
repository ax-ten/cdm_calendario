import datetime
import locale
import re
from api import GoogleCreds


def load_event_types():
    event_mapping = {}
    file_path="event_types.txt"
    with open(file_path, "r") as f:
        for line in f:
            line = line.strip()
            if not line or ":" not in line:
                continue
            event_type, keywords = line.split(":", 1)
            event_mapping[event_type.strip()] = [kw.strip() for kw in keywords.split(",")]
    return event_mapping

def getItemsFromDescription(description):
    event_mapping = load_event_types()
    DEFAULT = "default"
    if description is None:
        return DEFAULT, []
    
    tags = re.split(r"\s#", description)
    keyword = tags[0].lower()

    for event_type, keywords in event_mapping.items():
        if keyword in keywords:
            return event_type, tags[1:]

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
    

def getContenutoFinale(daysforward=2):
    locale.setlocale(locale.LC_ALL, 'it_IT.utf8')

    start_day = datetime.date.today() + datetime.timedelta(days=daysforward)
    epd = GoogleCreds.get_events_per_day(day=start_day)

    return getContenuto(epd)

import pprint
if __name__ == "__main__":
    locale.setlocale(locale.LC_ALL, 'it_IT.utf8')
    pprint.pprint(GoogleCreds.get_events_per_day())
