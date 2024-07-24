import datetime
from bs4 import BeautifulSoup
import html
from googleapiclient.discovery import build
from google.oauth2 import service_account

def get_giornata_div_elem(weekday, daynum):
    html = f"<div class=\"day\">\
            <div class=\"day_div\">\
              <p class=\"day_name\">{weekday}</p>\
              <p class=\"day_num\">{daynum}</p>\
            </div>\
            <div class=\"appuntamenti\">"

    settimana = list_weekly_appuntamenti()
    for app in settimana[0]:
        html += app.get_appuntamento_slot()

    return html + "</div></div>"

class Appuntamento:
    def __init__(self, summary, start, end, type):
        self.summary = summary
        self.start = start
        self.end = end
        self.type = type

    def get_color(self):
        return "#73AD21"

    def get_icon(self):
        if self.type.lower() == "gdr":
            return "GdR 2.png"
        elif self.type.lower() == "gdt":
            return "GdT.png"
        elif self.type.lower() == "mana":
            return "Mana Vault 2.png"
        else:
            return ""

    def get_appuntamento_slot(self):
        return f"""
        <div class="appuntamento_slot">
            <img src="{self.get_icon()}" height="60" width="auto" alt="">
            <div class="appuntamento" style="background:{self.get_color()}">
                <p class="appuntamento_name">{self.summary}</p>
                <p class="appuntamento_orario">{self.start} - {self.end}</p>
            </div>
        </div>
      """


def append_to_week(html_file_path):
    with open(html_file_path, 'r') as file:
        soup = BeautifulSoup(file, 'html.parser')

    div = None
    nomigiorni = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"]
    weekdiv = soup.find(id="week")

    for i in range(6):
        div = soup.new_tag("div")
        html = get_giornata_div_elem(nomigiorni[i], i)
        div.append(BeautifulSoup(html, 'html.parser'))
        weekdiv.append(div)

    # Domenica
    div = soup.new_tag("div")
    html = get_giornata_div_elem(nomigiorni[6], -1)
    div.append(BeautifulSoup(html, 'html.parser'))
    weekdiv.append(div)

    with open(html_file_path, 'w') as file:
        file.write(soup.prettify())

def get_week_start():
    today = datetime.date.today()
    day = today.weekday()  # Ottieni il giorno della settimana (0 = Lunedì, 1 = Martedì, ..., 6 = Domenica)
    diff = today.day - day + (day == 0 and -6 or 1)  # Calcola la differenza per ottenere la data di inizio settimana

    week_start = datetime.date(today.year, today.month, diff)  # Crea una nuova istanza di oggetto Date utilizzando la data di input
    return week_start

def get_week_end():
    week_end = get_week_start() + datetime.timedelta(days=6)  # Aggiungi 6 giorni per ottenere la data di fine settimana (l'ultimo giorno della settimana)
    return week_end

def fetch_events():
    week_start = get_week_start()
    week_end = get_week_end()
    
    
    SCOPES = ['https://www.googleapis.com/auth/calendar.events.readonly']
    SERVICE_ACCOUNT_FILE = 'path/to/service-account.json'  # Specifica il percorso al tuo file delle credenziali del servizio
    
    credentials = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    
    service = build('calendar', 'v3', credentials=credentials)
    
    response = service.events().list(
        calendarId='your-calendar-id',
        timeMin=week_start.isoformat(),
        timeMax=week_end.isoformat()
    ).execute()
    
    return response.get('items', [])


def list_weekly_appuntamenti():
    weekly = []
    events = fetch_events()
    for item in events:
        startdatetime = datetime.datetime.strptime(item['start']['dateTime'], "%Y-%m-%dT%H:%M:%S%z")
        enddatetime = datetime.datetime.strptime(item['end']['dateTime'], "%Y-%m-%dT%H:%M:%S%z")
        weekly.append([
            startdatetime.weekday() - 1,
            Appuntamento(
                item['summary'],
                f"{startdatetime.hour}:{startdatetime.minute}0",
                f"{enddatetime.hour}:{enddatetime.minute}0",
                item['type']
            ),
        ])
    
    return weekly


def init():
    append_to_week()


if __name__ == "__main__":
    init()