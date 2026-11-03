// Titolo, autore, editore e anno di un libro dal suo ISBN, per riempire il
// form quando lo staff aggiunge un libro. Prima Open Library, poi Google
// Books: Open Library e' aperta e senza chiavi, ma dei libri italiani ne
// conosce meno. Se nessuno dei due lo sa, il form resta da riempire a mano.

export function normalizza(isbn) {
  return String(isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function valido(isbn) {
  const n = normalizza(isbn);
  if (n.length === 13 && /^\d{13}$/.test(n)) {
    const somma = [...n].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0);
    return somma % 10 === 0;
  }
  if (n.length === 10 && /^\d{9}[\dX]$/.test(n)) {
    const somma = [...n].reduce((s, c, i) => s + (c === 'X' ? 10 : Number(c)) * (10 - i), 0);
    return somma % 11 === 0;
  }
  return false;
}

async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`${new URL(url).host} HTTP ${r.status}`);
  return r.json();
}

// L'anno arriva in forme diverse ("2004", "March 2004", "2004-03-01").
function anno(testo) {
  const m = String(testo || '').match(/\b(1[5-9]\d\d|20\d\d)\b/);
  return m ? Number(m[1]) : null;
}

async function daOpenLibrary(n) {
  const dati = await json(`https://openlibrary.org/api/books?bibkeys=ISBN:${n}&format=json&jscmd=data`);
  const libro = dati[`ISBN:${n}`];
  if (!libro?.title) return null;
  return {
    titolo: libro.subtitle ? `${libro.title}. ${libro.subtitle}` : libro.title,
    autore: (libro.authors || []).map(a => a.name).join(', ') || null,
    editore: (libro.publishers || []).map(p => p.name).join(', ') || null,
    anno: anno(libro.publish_date),
    fonte: 'Open Library',
  };
}

async function daGoogle(n) {
  const dati = await json(`https://www.googleapis.com/books/v1/volumes?q=isbn:${n}`);
  const v = dati.items?.[0]?.volumeInfo;
  if (!v?.title) return null;
  return {
    titolo: v.subtitle ? `${v.title}. ${v.subtitle}` : v.title,
    autore: (v.authors || []).join(', ') || null,
    editore: v.publisher || null,
    anno: anno(v.publishedDate),
    fonte: 'Google Books',
  };
}

export async function cerca(isbn) {
  const n = normalizza(isbn);
  for (const fonte of [daOpenLibrary, daGoogle]) {
    try {
      const trovato = await fonte(n);
      if (trovato) return trovato;
    } catch (err) {
      console.error('isbn:', err.message);
    }
  }
  return null;
}
