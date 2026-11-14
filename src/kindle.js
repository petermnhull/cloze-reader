// Reads lookups out of a Kindle vocab.db (system/vocabulary/vocab.db on the device).

export const LOOKUPS_SQL = `
  SELECT
    L.id        AS lookupId,
    W.id        AS wordKey,
    W.word      AS word,
    W.stem      AS stem,
    W.lang      AS lang,
    L.usage     AS usage,
    L.timestamp AS timestamp,
    L.book_key  AS bookKey,
    B.title     AS title,
    B.authors   AS authors
  FROM LOOKUPS L
  JOIN WORDS W ON W.id = L.word_key
  LEFT JOIN BOOK_INFO B ON B.id = L.book_key
  ORDER BY L.timestamp DESC
`;

const fold = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Trailing "(…)" groups that are edition, imprint or collection names rather than part of the title.
const PUBLISHER_NOTE = /\s*\((?:[^()]*\bEdition|Folio|Poches?\b[^()]*|Littérature[^()]*|LITT\.[^()]*|Annoté[^()]*|[^()]*Junior[^()]*)\)\s*$/i;

// Sideloaded books often have a file name as their title: "dupont_la_riviere" -> "La riviere",
// dropping leading words that match the author's name.
function fromFileName(title, authors) {
  const authorWords = fold(authors).split(/[^a-z]+/).filter((w) => w.length > 2);
  const words = title.split("_").filter(Boolean);
  while (words.length > 1 && authorWords.some((a) => a.slice(0, 5) === fold(words[0]).slice(0, 5))) words.shift();
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// "Mimosa : Prix des Lecteurs 2024 (Littérature Française) (French Edition)" -> "Mimosa".
// This also merges samples and full editions, which share the cleaned title.
export function cleanTitle(title, authors = "") {
  let text = (title ?? "").trim();
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(text)) text = fromFileName(text, authors);
  for (let previous; previous !== text; ) {
    previous = text;
    text = text.replace(PUBLISHER_NOTE, "").trim();
  }
  text = text.replace(/\s*[-–:]\s*Prix\b.*$/i, "").trim();
  return text || "Unknown book";
}

export function normalizeLookup(row) {
  const wordKey = row.wordKey ?? "";
  const word = row.word ?? "";
  return {
    lookupId: row.lookupId,
    wordKey,
    word,
    stem: row.stem || word,
    // Word keys look like "fr:auvent"; fall back to that prefix when lang is empty.
    lang: row.lang || wordKey.split(":")[0],
    usage: row.usage ?? "",
    timestamp: Number(row.timestamp) || 0,
    bookKey: row.bookKey ?? "",
    title: cleanTitle(row.title, row.authors ?? ""),
    authors: row.authors ?? "",
  };
}

// `db` is a sql.js Database.
export function readLookups(db) {
  let tables;
  try {
    tables = new Set(
      db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values.flat() ?? [],
    );
  } catch {
    throw new Error("That file isn't a SQLite database. Look for vocab.db in your Kindle's system/vocabulary folder.");
  }
  if (!tables.has("LOOKUPS") || !tables.has("WORDS")) {
    throw new Error("That database doesn't look like a Kindle vocab.db (no LOOKUPS/WORDS tables).");
  }

  const statement = db.prepare(LOOKUPS_SQL);
  const lookups = [];
  while (statement.step()) lookups.push(normalizeLookup(statement.getAsObject()));
  statement.free();
  return lookups;
}
