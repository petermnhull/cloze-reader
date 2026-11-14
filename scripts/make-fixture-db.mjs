// Writes a small synthetic Kindle vocab.db for tests: same tables and columns as the device's
// system/vocabulary/vocab.db, with invented French sentences (never real book text).
// Usage: node scripts/make-fixture-db.mjs out/vocab.db   (needs Node 22.13+ for node:sqlite)

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

// [word as looked up, Kindle stem, book id, invented sentence]
export const FIXTURE_LOOKUPS = [
  ["buvette", "buvette", "b1", "Après la course, nous avons pris un citron pressé à la buvette du stade."],
  ["défiait", "défier", "b1", "Le petit chat défiait le chien du voisin depuis le haut du mur."],
  ["auvent", "auvent", "b1", "Il attendait la fin de l'averse sous l'auvent de la boulangerie."],
  ["ruelle", "ruelle", "b1", "La ruelle derrière la mairie sentait le pain chaud et la lessive."],
  ["chuchotait", "chuchoter", "b2", "Pendant le film, elle chuchotait des commentaires à son frère."],
  ["lueur", "lueur", "b2", "Une faible lueur passait sous la porte du grenier."],
  ["grimpa", "grimper", "b2", "Le garçon grimpa sur la chaise pour atteindre le bocal de biscuits."],
  ["brouillard", "brouillard", "b2", "Le brouillard couvrait encore la vallée quand le train arriva."],
  ["tiroir", "tiroir", "b2", "Elle rangea les vieilles cartes postales dans le tiroir de la commode."],
  ["défiaient", "défier", "b2", "Les deux équipes se défiaient du regard avant le match."],
];

export const FIXTURE_BOOKS = [
  ["b1", "B0FIXTURE1", "Un été au village (French Edition)", "Auteur Inventé"],
  ["b2", "B0FIXTURE2", "Carnets de pluie", "Autrice Imaginaire"],
];

export function makeFixtureDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) rmSync(path);
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE WORDS (id TEXT PRIMARY KEY NOT NULL UNIQUE, word TEXT, stem TEXT, lang TEXT,
      category INTEGER DEFAULT 0, timestamp INTEGER DEFAULT 0, profileid TEXT);
    CREATE TABLE LOOKUPS (id TEXT PRIMARY KEY NOT NULL, word_key TEXT, book_key TEXT, dict_key TEXT,
      pos TEXT, usage TEXT, timestamp INTEGER DEFAULT 0);
    CREATE TABLE BOOK_INFO (id TEXT PRIMARY KEY NOT NULL, asin TEXT, guid TEXT, lang TEXT,
      title TEXT, authors TEXT);
  `);
  const book = db.prepare("INSERT INTO BOOK_INFO VALUES (?, ?, ?, 'fr', ?, ?)");
  for (const [id, asin, title, authors] of FIXTURE_BOOKS) book.run(id, asin, `guid-${id}`, title, authors);

  const word = db.prepare("INSERT INTO WORDS VALUES (?, ?, ?, 'fr', 0, ?, '')");
  const lookup = db.prepare("INSERT INTO LOOKUPS VALUES (?, ?, ?, 'Dictionnaire', ?, ?, ?)");
  const start = Date.UTC(2026, 0, 1);
  FIXTURE_LOOKUPS.forEach(([form, stem, bookId, usage], i) => {
    const timestamp = start + i * 3_600_000;
    word.run(`fr:${form}`, form, stem, timestamp);
    lookup.run(`${bookId}:${i}`, `fr:${form}`, bookId, String(100 * (i + 1)), usage, timestamp);
  });
  db.close();
  return path;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2] ?? "vocab.db";
  makeFixtureDb(out);
  console.log(`Wrote ${out} (${FIXTURE_LOOKUPS.length} lookups)`);
}
