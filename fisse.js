// Le attivita' periodiche: la richiesta allo staff e l'approvazione. Lo
// fanno il bot (dal gruppo staff) e l'app (dalle prenotazioni dello staff).

import * as prenotazioni from './prenotazioni.js';
import { CATEGORIE, calendarioDi } from './config.js';
import { getAuthScrittura, componiDescrizione } from './calendario.js';
import { telegram, nomeTelegram } from './telegram.js';

// Un errore da mostrare cosi' com'e' a chi ha premuto.
const perUtente = (messaggio, stato) => Object.assign(new Error(messaggio), { perUtente: true, stato });

// Il messaggio nel gruppo staff con i due pulsanti. Se non parte, la
// richiesta si toglie: senza il messaggio nessuno la deciderebbe mai.
// Restituisce false se non e' partito (il motivo va nel log).
export async function chiediAlloStaff(idRichiesta, chatStaff, righe, utente) {
  try {
    const messaggio = await telegram('sendMessage', {
      chat_id: chatStaff,
      text: [...righe, `Chiede ${nomeTelegram(utente)}`].join('\n'),
      reply_markup: {
        inline_keyboard: [[
          { text: 'Approva', callback_data: `fissa:si:${idRichiesta}` },
          { text: 'Rifiuta', callback_data: `fissa:no:${idRichiesta}` },
        ]],
      },
    });
    prenotazioni.aggiornaRichiesta(idRichiesta, { messaggio: { chat: chatStaff, id: messaggio.message_id } });
    return true;
  } catch (err) {
    prenotazioni.chiudiRichiesta(idRichiesta);
    console.error('attivita periodica: staff non avvisato:', err.message);
    return false;
  }
}

// Approvare un'attivita' periodica: l'evento nasce, e si ripete con la
// cadenza chiesta. Errore con perUtente: da mostrare cosi' com'e'.
export async function approvaFissa(id, daChi) {
  // Si segna subito, prima di parlare con Google: due "Approva" insieme
  // (uno dal gruppo, uno dall'app) farebbero due serie uguali.
  const presa = prenotazioni.prendiInCaricoRichiesta(id, daChi);
  if (presa.esito === 'sparita') throw perUtente('Qualcuno ha già deciso questa richiesta.', 404);
  if (presa.esito === 'occupata') throw perUtente(`Ci sta già pensando ${presa.daChi}.`, 409);
  const richiesta = presa.richiesta;

  const calendarId = calendarioDi(richiesta.sede);
  const tipo = CATEGORIE.find((c) => c.slug === richiesta.categoria);
  const { inizio, fine } = prenotazioni.estremi(
    richiesta.data, richiesta.oraInizio, richiesta.oraFine);
  // Le richieste rimaste in sospeso da prima delle cadenze non ce l'hanno.
  const ricorrenza = richiesta.ricorrenza || 'settimanale';

  const descrizione = componiDescrizione({
    parola: tipo ? tipo.parola : '',
    vetrina: richiesta.vetrina,
    note: richiesta.note,
    firma: `Attivita periodica proposta da ${nomeTelegram(richiesta.utente)}` +
           ` e approvata da ${daChi || 'staff'}.`,
  });

  let evento;
  try {
    evento = await prenotazioni.creaPrenotazione(getAuthScrittura(), calendarId, {
      titolo: richiesta.titolo,
      descrizione,
      inizio,
      fine,
      utente: richiesta.utente,
      serveApertura: richiesta.serveApertura,
      fissa: true,
      ricorrenza,
    });
  } catch (err) {
    // Non e' nata: la richiesta torna libera, e si puo' riprovare.
    prenotazioni.rilasciaRichiesta(id);
    throw err;
  }
  prenotazioni.chiudiRichiesta(id);

  // Se la richiesta nasce da una prenotazione gia' fatta, quella se ne va:
  // la serie comincia dallo stesso giorno, e in due sullo stesso posto ci
  // sarebbe la stessa attivita' scritta due volte. Se la cancellazione non
  // riesce la serie resta buona lo stesso: si dice, non si annulla tutto.
  if (richiesta.daEvento) {
    try {
      await prenotazioni.annullaPrenotazione(getAuthScrittura(), calendarId, richiesta.daEvento);
    } catch (err) {
      console.error('approva: la prenotazione singola e rimasta:', err.message);
    }
  }

  return {
    eventId: evento.id,
    richiesta: { id, ...richiesta },
    quando: `${inizio.setLocale('it').toFormat('cccc')} ` +
            `${inizio.toFormat('HH:mm')}-${fine.toFormat('HH:mm')}`,
    // La frase intera, cadenza compresa: "quando" da solo il bot lo
    // leggeva come settimanale.
    cadenza: `${prenotazioni.testoRicorrenza(ricorrenza, inizio)}, ` +
             `${inizio.toFormat('HH:mm')}-${fine.toFormat('HH:mm')}`,
  };
}
