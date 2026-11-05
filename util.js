// Attrezzi piccoli che servono in piu' posti: una cache con scadenza e
// tetto, un lucchetto per chiave, un Promise.all che non parte tutto
// insieme, e un filtro per le richieste ripetute. Niente dipendenze: sono
// venti righe l'uno, e una libreria in piu' e' una cosa in piu' da aggiornare.

// Una mappa con il momento in cui si e' scritta ogni voce, e un tetto: oltre
// `max` voci se ne va la piu' vecchia. Senza tetto una mappa tenuta per
// "chi ha aperto l'app" cresce con ogni persona che l'abbia mai aperta.
export class Cache {
  constructor(max = 5000) {
    this.max = max;
    this.mappa = new Map();
  }

  // La voce { valore, quando } se c'e' ed e' piu' giovane di validaPerMs,
  // se no undefined. Senza validaPerMs va bene anche vecchia: serve a chi
  // ripiega sull'ultima risposta quando il servizio non risponde.
  cerca(chiave, validaPerMs = Infinity) {
    const voce = this.mappa.get(String(chiave));
    if (!voce || Date.now() - voce.quando >= validaPerMs) return undefined;
    return voce;
  }

  metti(chiave, valore) {
    const k = String(chiave);
    // Tolta e rimessa: cosi' finisce in fondo, e la prima della mappa e'
    // davvero la piu' vecchia.
    this.mappa.delete(k);
    this.mappa.set(k, { valore, quando: Date.now() });
    while (this.mappa.size > this.max) this.mappa.delete(this.mappa.keys().next().value);
  }

  togli(chiave) {
    this.mappa.delete(String(chiave));
  }

  svuota() {
    this.mappa.clear();
  }
}

// Un valore calcolato una volta e tenuto per un po'. Chi lo chiede mentre lo
// si sta calcolando aspetta lo stesso calcolo invece di rifarlo: alla
// scadenza arrivano in tanti insieme, ed e' proprio li' che un calcolo
// doppio costa. Gli errori non si tengono.
export function memoria(validaPerMs, max = 100) {
  const fatti = new Cache(max);
  const inCorso = new Map();
  const fn = async (chiave, calcola) => {
    const k = String(chiave);
    const visto = fatti.cerca(k, validaPerMs);
    if (visto) return visto.valore;
    if (inCorso.has(k)) return inCorso.get(k);
    const promessa = (async () => calcola())()
      .then((valore) => { fatti.metti(k, valore); return valore; })
      .finally(() => inCorso.delete(k));
    inCorso.set(k, promessa);
    return promessa;
  };
  // Per chi sa che il valore e' cambiato (un bene aggiunto, per esempio).
  fn.dimentica = (chiave) => (chiave === undefined ? fatti.svuota() : fatti.togli(chiave));
  // Per chi vuole tenere solo certi risultati (una risposta con un errore
  // dentro non si tiene).
  fn.togli = (chiave) => fatti.togli(chiave);
  return fn;
}

// Un lucchetto per chiave: chi arriva con la stessa chiave aspetta che il
// precedente abbia finito. Serve dove si controlla e poi si scrive (c'e'
// posto? allora prenoto): senza, due richieste insieme vedono tutte e due il
// posto libero e lo prendono tutte e due. Vale per questo processo solo, che
// e' l'unico che scrive.
const code = new Map();

export async function inFila(chiave, azione) {
  const prima = code.get(chiave) || Promise.resolve();
  let libera;
  const mia = new Promise((r) => { libera = r; });
  const coda = prima.then(() => mia);
  // La coda si scrive subito, prima di qualsiasi await: e' questo che la
  // rende un lucchetto.
  code.set(chiave, coda);
  try {
    await prima;
    return await azione();
  } finally {
    libera();
    if (code.get(chiave) === coda) code.delete(chiave);
  }
}

// Come Promise.all(lista.map(fn)), ma al massimo `quanti` per volta: un
// elenco di duecento persone non diventa duecento domande a Telegram nello
// stesso istante. L'ordine dei risultati e' quello della lista.
export async function mappaConLimite(lista, quanti, fn) {
  const fuori = new Array(lista.length);
  let prossimo = 0;
  const lavora = async () => {
    while (prossimo < lista.length) {
      const i = prossimo++;
      fuori[i] = await fn(lista[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(quanti, lista.length) }, lavora));
  return fuori;
}

// La stessa richiesta due volte in pochi minuti e' un doppio tocco, o una
// rete che ha ritrasmesso: la seconda riceve la risposta della prima invece
// di rifare la cosa. Se la prima e' ancora in corso, la seconda la aspetta.
// Una richiesta andata male non si ricorda: si puo' riprovare subito.
export function senzaDoppioni(validaPerMs, max = 1000) {
  const viste = new Map();   // chiave -> { quando, promessa }
  return async (chiave, azione) => {
    const ora = Date.now();
    for (const [k, v] of viste) {
      if (ora - v.quando >= validaPerMs) viste.delete(k);
    }
    const gia = viste.get(chiave);
    if (gia) return { valore: await gia.promessa, ripetuta: true };
    while (viste.size >= max) viste.delete(viste.keys().next().value);
    const promessa = (async () => azione())();
    viste.set(chiave, { quando: ora, promessa });
    try {
      return { valore: await promessa, ripetuta: false };
    } catch (err) {
      if (viste.get(chiave)?.promessa === promessa) viste.delete(chiave);
      throw err;
    }
  };
}

// Un testo che finisce in un messaggio o in un campo: oltre `max` si taglia.
export function taglia(testo, max) {
  const t = String(testo ?? '');
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
