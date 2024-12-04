
import datetime
import re

class Evento:
    event_mapping = None 

    def __init__(self, nome, isActivity, data, orainizio, orafine, description=None):
        """
        Inizializza un'istanza di Evento, analizzando la descrizione per determinare il tipo, i tag e la posizione.

        :param nome: Nome dell'evento.
        :param isActivity: Indica se l'evento è ricorrente (True/False).
        :param data: Data dell'evento (formato stringa).
        :param orainizio: Orario di inizio dell'evento (formato stringa).
        :param orafine: Orario di fine dell'evento (formato stringa).
        :param description: Descrizione dell'evento (opzionale). Se fornita, viene utilizzata per determinare tipo, tag e posizione.
        :param immagine_profilo: Immagine di profilo dell'evento (opzionale).
        :param immagine_sfondo: Immagine di sfondo dell'evento (opzionale).
        """
        self.nome = nome  
        self.isActivity = isActivity  

        self.data = self._parse_date(data)  
        self.orainizio = self._parse_time(orainizio)  
        self.orafine = self._parse_time(orafine) 
        self.event_type, self.tags, self.position = Evento._parse_description(description)


    @classmethod
    def load_event_types(cls, file_path="event_types.txt"):
        """
        Carica i tipi di eventi e le relative parole chiave da un file e le salva come attributo di classe.
        """
        if cls.event_mapping is None:
            cls.event_mapping = {}
            try:
                with open(file_path, "r") as f:
                    for line in f:
                        line = line.strip()
                        if not line or ":" not in line:
                            continue
                        event_type, keywords = line.split(":", 1)
                        cls.event_mapping[event_type.strip()] = [kw.strip() for kw in keywords.split(",")]
                # print(f"Tipi di eventi caricati: {cls.event_mapping}")
            except FileNotFoundError:
                raise FileNotFoundError(f"Il file {file_path} non è stato trovato.")
        return cls.event_mapping

    @staticmethod
    def _parse_date(date_str):
        """
        Converte una stringa di data nel formato "YYYY-MM-DD" in un oggetto datetime.date.
        """
        if isinstance(date_str, str):
            return datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
        elif isinstance(date_str, datetime.date):
            return date_str
        raise ValueError("Il formato della data deve essere una stringa 'YYYY-MM-DD' o un oggetto datetime.date.")
    


    @staticmethod
    def _parse_description(description):
        """
        Determina il tipo di evento, i tag e la posizione dalla descrizione.
        Restituisce il tipo di evento, i tag e la posizione.
        """
        # Carica i tipi di evento se non sono già caricati
        event_mapping = Evento.load_event_types()
        DEFAULT = "default"
        
        if description is None:
            return DEFAULT, [], None

        # Dividi la descrizione in parole chiave e tag
        parts = re.split(r"\s#", description)
        
        # Il primo elemento è il tipo di evento
        event_type = parts[0].strip().lower()
        
        # Cerca se il tipo di evento corrisponde a uno degli eventi noti
        if event_type not in event_mapping:
            event_type = DEFAULT
        
        tags = []
        position = None
        
        # Analizza i tag e le posizioni (se esistono)
        for part in parts[1:]:
            part = part.strip()
            if part.startswith("pos:"):
                # Estrai la posizione
                position = part.split("pos:")[1].strip()
            else:
                # Aggiungi i tag
                tags.append(part)

        return event_type, tags, position


    @staticmethod
    def _parse_time(time_str):
        """
        Converte una stringa di orario nel formato "HH:MM" in un oggetto datetime.time.
        """
        if isinstance(time_str, str):
            return datetime.datetime.strptime(time_str, "%H:%M").time()
        elif isinstance(time_str, datetime.time):
            return time_str
        raise ValueError("Il formato dell'orario deve essere una stringa 'HH:MM' o un oggetto datetime.time.")

    def is_full_day_event(self):
        """
        Determina se l'evento dura l'intera giornata.
        """
        return self.orainizio == self.orafine

    def to_dict(self):
        """
        Converte l'evento in un dizionario per la serializzazione.
        """
        return {
            "nome": self.nome,
            "isActivity": self.isActivity,
            "data": self.data.isoformat(),
            "orainizio": self.orainizio.strftime("%H:%M"),
            "orafine": self.orafine.strftime("%H:%M"),
            "tags": self.tags,
        }

    def __str__(self):
        """
        Rappresentazione leggibile di un evento.
        """
        return (
            f"Evento: {self.nome}\n"
            f"Ricorrente: {'Sì' if self.isActivity else 'No'}\n"
            f"Data: {self.data}\n"
            f"Orario: {self.orainizio} - {self.orafine}\n"
            f"Tag: {', '.join(self.tags) if self.tags else 'Nessuno'}\n"
        )

    def render(self):
        """
        Metodo per il rendering dell'evento singolo in formato HTML.
        """
        # Definisci il contenuto HTML dell'evento
        return f"<div class='evento'><h3>{self.nome}</h3><p>{self.data} - {self.orainizio} - {self.orafine}</p></div>"

class SuperEvento(Evento):
    def __init__(self, nome, data, orainizio, eventi:list):
        """
        Inizializza un'istanza di SuperEvento, che contiene più eventi.
        """
        # Aggiungi attributi specifici per SuperEvento
        super().__init__(nome, reoccurring=False, data=data, orainizio=orainizio, orafine=None)
        self.eventi = eventi  

    def render(self):
        """
        Sovrascrive il metodo render per gestire il rendering di più eventi.
        """
        eventi_html = ''.join([evento.render() for evento in self.eventi])
        return f"<div class='superevento' style='background: {self.background};'><h2>{self.nome}</h2>{eventi_html}</div>"