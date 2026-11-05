// Un file JSON in dati/, tenuto anche in memoria. Si legge dal disco la
// prima volta e poi solo dalla memoria: eBloccato e richiestaDi stanno su
// quasi ogni chiamata, e rileggere e riparsare il file ogni volta non serve,
// perche' a scriverlo e' solo questo processo. Ogni scrittura va prima su un
// file provvisorio e poi lo rinomina, cosi' un crash a meta' non lascia un
// file mezzo scritto.
//
// leggi() da' l'oggetto in memoria: va solo letto. Per cambiare qualcosa si
// prende copia(), la si modifica e la si passa a scrivi(). Tutto sincrono:
// fra una lettura e la scrittura che la segue non si infila nessun'altra
// richiesta.

import fs from 'fs';
import path from 'path';

export function creaStore(file, { vuoto = () => ({}), normalizza = (d) => d } = {}) {
  let dati = null;

  function leggi() {
    if (dati) return dati;
    try {
      dati = normalizza(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`${path.basename(file)} illeggibile:`, err.message);
      dati = normalizza(vuoto());
    }
    return dati;
  }

  function copia() {
    return structuredClone(leggi());
  }

  function scrivi(nuovi) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const provvisorio = file + '.tmp';
    fs.writeFileSync(provvisorio, JSON.stringify(nuovi, null, 2));
    fs.renameSync(provvisorio, file);
    // In memoria va solo dopo che il disco l'ha preso: se la scrittura
    // fallisce, quello che si legge resta quello che c'e' sul disco.
    dati = nuovi;
  }

  return { leggi, copia, scrivi };
}
