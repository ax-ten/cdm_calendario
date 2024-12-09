from google.oauth2 import service_account
from googleapiclient.discovery import build
from dotenv import load_dotenv
import asyncio
import os
import datetime, logging
from datetime import timezone
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

LAST_CALL_FILE = "last_gmail_call.txt"

class GoogleCreds:
    """Classe per gestire credenziali Google e servizi API."""
    CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]
    BUSINESS_SCOPES = ["https://www.googleapis.com/auth/business.manage"]
    GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
    LOCATION = "DUH/230239029302",  # Es: "locations/1234567890"
    LAST_CALL_FILE = "last_gmail_call.txt"
    CREDENTIALS_FILE = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")  # Path al file JSON delle credenziali di servizio
    TOKEN_FILE = "token.json" 
    CLIENT_SECRETS_FILE = "credentials.json"

    @staticmethod
    async def get_creds(scopes):
        """Carica le credenziali da un file di servizio."""
        creds = service_account.Credentials.from_service_account_file(
            os.getenv("GOOGLE_APPLICATION_CREDENTIALS"),
            scopes=scopes,
            subject="croceviadeimondi@gmail.com"
        )
        return creds


    ##################################################
    #                                                #
    #                GMAIL  SERVICES                 #
    #                                                #
    ##################################################


    @staticmethod
    def get_gmail_creds():
        """
        Ottiene le credenziali per Gmail API.
        Usa prima le credenziali di Account di Servizio (con delega), altrimenti le credenziali OAuth User.
        """
        creds = None

        # Verifica se esistono credenziali OAuth salvate (token.json)
        if os.path.exists(GoogleCreds.TOKEN_FILE):
            creds = Credentials.from_authorized_user_file(GoogleCreds.TOKEN_FILE, GoogleCreds.GMAIL_SCOPES)

        # Se non sono disponibili credenziali OAuth valide, avvia il login manuale
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                # Avvia il login manuale tramite OAuth
                flow = InstalledAppFlow.from_client_secrets_file(
                    GoogleCreds.CLIENT_SECRETS_FILE, GoogleCreds.SCOPES
                )
                creds = flow.run_local_server(port=0)

                # Salva le credenziali per il prossimo utilizzo
                with open(GoogleCreds.TOKEN_FILE, "w") as token:
                    token.write(creds.to_json())

        return creds

    @staticmethod
    def get_last_call_timestamp() -> str:
        """Legge il timestamp dell'ultima chiamata."""
        if os.path.exists(GoogleCreds.LAST_CALL_FILE):
            with open(GoogleCreds.LAST_CALL_FILE, "r") as file:
                return file.read().strip()
        return None

    @staticmethod
    def save_last_call_timestamp():
        """Salva il timestamp corrente come ultima chiamata."""
        current_timestamp = datetime.now(timezone.utc).strftime("%s")
        with open(GoogleCreds.LAST_CALL_FILE, "w") as file:
            file.write(current_timestamp)

    @staticmethod
    async def get_gmail_service():
        """Inizializza il servizio Gmail."""
        creds = await GoogleCreds.get_creds(GoogleCreds.GMAIL_SCOPES)
        return build('gmail', 'v1', credentials=creds)
    

    # @staticmethod
    # async def get_new_mails() -> list[dict]:
    #     """Recupera le nuove email come una lista di dizionari."""
    #     service = await GoogleCreds.get_gmail_service()
    #     last_call = GoogleCreds.get_last_call_timestamp()
    #     query = f"after:{last_call}" if last_call else None

    #     try:
    #         if query:
    #             result = service.users().messages().list(userId="me", q=query, maxResults=10).execute()
    #         else:
    #             result = service.users().messages().list(userId="me", maxResults=10).execute()
    #         return result
    #     except Exception as e:
    #         print(f"Errore HTTP durante la chiamata a Gmail: {e}")
    #         return []

    @staticmethod
    def get_new_mails():
        """
        Recupera le email ricevute dopo l'ultimo timestamp registrato.
        Questo metodo utilizza le credenziali generate in `get_creds`.
        """
        try:
            # Inizializza il servizio Gmail
            creds = GoogleCreds.get_creds()
            service = build("gmail", "v1", credentials=creds)

            # Ottieni il timestamp dell'ultima chiamata
            last_call_timestamp = GoogleCreds.get_last_call_timestamp()

            # Costruisci la query per email successive all'ultimo timestamp
            query = ""
            if last_call_timestamp:
                query = f"after:{int(last_call_timestamp.timestamp())}"

            # Recupera le email corrispondenti
            response = service.users().messages().list(userId="me", q=query, maxResults=10).execute()
            messages = response.get("messages", [])
            if not messages:
                logging.info("Nessuna nuova email trovata.")
                return []

            # Ottieni i dettagli di ogni email
            emails = []
            for message in messages:
                msg = service.users().messages().get(userId="me", id=message["id"]).execute()
                headers = {h["name"]: h["value"] for h in msg["payload"]["headers"]}
                email_data = {
                    "mittente": headers.get("From", "Sconosciuto"),
                    "oggetto": headers.get("Subject", "Senza Oggetto"),
                    "data": headers.get("Date", "Sconosciuta"),
                    "ora": headers.get("Date", "Sconosciuta"),  # La data contiene anche l'orario
                }
                emails.append(email_data)

            # Salva il timestamp corrente
            GoogleCreds.save_last_call_timestamp(datetime.now())

            logging.info(f"Recuperate {len(emails)} email.")
            return emails
        except Exception as error:
            logging.error(f"Errore durante il recupero delle email: {error}")
            raise


    ##################################################

    #               CALENDAR SERVICES                #

    ##################################################

    @staticmethod
    def get_calendar_service():
        """Ritorna un'istanza del servizio Google Calendar."""
        load_dotenv()  # Carica variabili di ambiente
        credentials = asyncio.run(
            GoogleCreds.get_creds(scopes=GoogleCreds.CALENDAR_SCOPES)
        )
        return build("calendar", "v3", credentials=credentials)


    @staticmethod
    def get_week_events(day=datetime.date.today()):
        """
        Esegue una query per gli eventi di calendario della settimana corrente.

        Args:
            day: Giorno di riferimento (default: oggi).

        Returns:
            Lista degli eventi del calendario per la settimana corrente.
        """
        # Calcola l'inizio e la fine della settimana
        start_of_week = day - datetime.timedelta(days=day.weekday())
        end_of_week = start_of_week + datetime.timedelta(days=6)

        # Formatta le date per la query
        start_date = start_of_week.isoformat() + "T00:00:00Z"
        end_date = end_of_week.isoformat() + "T23:59:59Z"

        # Query sugli eventi del calendario
        events_result = GoogleCreds.get_calendar_service().events().list(
            calendarId=os.getenv("calendar_id"),  # ID del calendario
            timeMin=start_date,
            timeMax=end_date,
            singleEvents=True,
            orderBy="startTime",
        ).execute()
        return events_result


    @staticmethod
    def get_events_per_day(day=datetime.date.today()):
        """
        Organizza gli eventi di calendario per giorno.

        Args:
            day: Giorno di riferimento (default: oggi).

        Returns:
            Dizionario in cui le chiavi sono date e i valori sono liste di eventi per quel giorno.
        """
        events = GoogleCreds.get_week_events(day=day).get("items", [])
        
        # Crea un dizionario per organizzare gli eventi per giorno
        events_per_day = {}

        # Popola il dizionario con gli eventi divisi per giorno
        for event in events:
            # Ottieni la data di inizio evento
            start = event["start"].get("dateTime", event["start"].get("date"))
            event_date = datetime.datetime.fromisoformat(start).date()

            if event_date in events_per_day:
                events_per_day[event_date].append(event)
            else:
                events_per_day[event_date] = [event]

        # Ordina gli eventi all'interno di ciascun giorno
        for events_list in events_per_day.values():
            events_list.sort(key=lambda x: x["start"].get("dateTime", x["start"].get("date")))

        return events_per_day



    ##################################################

    #               BUSINESS SERVICES                #

    ##################################################


    @staticmethod
    def get_business_service():
        """Ritorna un'istanza del servizio Google Business Information."""
        load_dotenv()  # Carica variabili di ambiente
        credentials = asyncio.run(
            GoogleCreds.get_creds(scopes=GoogleCreds.BUSINESS_SCOPES)
        )
        return build("mybusinessbusinessinformation", "v1", credentials=credentials)
    

    @staticmethod
    def updateBusinessHours(service):
        request_body = GoogleCreds.get_business_hours()
        request = service.locations().patch(
            name=GoogleCreds.LOCATION,  # Es: "locations/1234567890"
            updateMask="regularHours",
            body=request_body,
        )
        response = request.execute()
        print("Orari aggiornati con successo:", response)


    # Funzione per ottenere gli orari di apertura e chiusura
    @staticmethod
    def get_business_hours():
        events = GoogleCreds.get_events_per_day()
        business_hours = {}

        for date, events_list in events.items():
            # Lista per gli orari di apertura e chiusura
            open_time = None
            close_time = None
            
            for event in events_list:
                start_time = format_time(event['start']['dateTime'])
                end_time = format_time(event['end']['dateTime'])

                # Se l'orario di apertura non è definito, settalo al primo evento
                if open_time is None or start_time < open_time:
                    open_time = start_time

                # Se l'orario di chiusura non è definito, settalo al primo evento
                if close_time is None or end_time > close_time:
                    close_time = end_time

            # Aggiungi l'orario complessivo per la data nel dizionario
            day_of_week = date.strftime("%A").upper()  # Ottieni il giorno della settimana in formato stringa
            business_hours[day_of_week] = {
                "openTime": open_time,
                "closeTime": close_time
            }

        return business_hours
    

# Funzione per formattare l'orario

def format_time(time_str):
    return datetime.datetime.strptime(time_str, "%Y-%m-%dT%H:%M:%S%z").strftime("%H:%M")


# vogliono essere pagati, vabbè
# import googlemaps
# if __name__ == '__main__':
#    # Replace with your actual API key
#     api_key = ""

#     # Create a Google Maps client
#     gmaps = googlemaps.Client(key=api_key)

#     # Replace with your business name or a related keyword
#     query = "Crocevia dei Mondi, Barletta"

#     # Search for places matching the query
#     places = gmaps.places(query=query)

#     # Filter results to find your locations (you might need to add logic here)
#     for place in places['results']:
#         print(f"Place ID: {place['place_id']}")
#         print(f"Name: {place['name']}")
#         print(f"Address: {place['formatted_address']}")
#         # ... other attributes
