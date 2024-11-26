from google.oauth2 import service_account
from googleapiclient.discovery import build
from dotenv import load_dotenv
import asyncio
import os
import datetime


class GoogleCreds:
    """Classe per gestire credenziali Google e servizi API."""

    CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]
    BUSINESS_SCOPES = ["https://www.googleapis.com/auth/business.manage"]

    @staticmethod
    async def get_creds(scopes):
        """Carica le credenziali da un file di servizio."""
        creds = service_account.Credentials.from_service_account_file(
            os.getenv("GOOGLE_APPLICATION_CREDENTIALS"),
            scopes=scopes,
        )
        return creds


    @staticmethod
    def get_calendar_service():
        """Ritorna un'istanza del servizio Google Calendar."""
        load_dotenv()  # Carica variabili di ambiente
        credentials = asyncio.run(
            GoogleCreds.get_creds(scopes=GoogleCreds.CALENDAR_SCOPES)
        )
        return build("calendar", "v3", credentials=credentials)


    @staticmethod
    def get_business_service():
        """Ritorna un'istanza del servizio Google Business Information."""
        load_dotenv()  # Carica variabili di ambiente
        credentials = asyncio.run(
            GoogleCreds.get_creds(scopes=GoogleCreds.BUSINESS_SCOPES)
        )
        return build("mybusinessbusinessinformation", "v1", credentials=credentials)


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
