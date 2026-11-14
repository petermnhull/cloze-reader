import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTitle, normalizeLookup } from "../src/kindle.js";

test("cleanTitle drops the edition suffix", () => {
  assert.equal(cleanTitle("La Maison du phare (French Edition)"), "La Maison du phare");
  assert.equal(cleanTitle("La saga du port (Tome 1) - Marée basse (French Edition)"), "La saga du port (Tome 1) - Marée basse");
  assert.equal(cleanTitle(null), "Unknown book");
});

test("cleanTitle drops imprints, collections and prize subtitles", () => {
  assert.equal(cleanTitle("Les Jardins d'hiver (Folio) (French Edition)"), "Les Jardins d'hiver");
  assert.equal(cleanTitle("Le Silence des pierres (LITT.GENERALE) (French Edition)"), "Le Silence des pierres");
  assert.equal(cleanTitle("Mimosa : Prix des Lecteurs 2024 (Littérature Française) (French Edition)"), "Mimosa");
  assert.equal(cleanTitle("Le vent sur la jetée - Prix du premier roman 2025. (French Edition)"), "Le vent sur la jetée");
  assert.equal(cleanTitle("Moi, Léon, 11 ans, détective (Milan Poche Junior t. 4) (French Edition)"), "Moi, Léon, 11 ans, détective");
  assert.equal(cleanTitle("L'art du voyage (Poches littérature) (French Edition)"), "L'art du voyage");
});

test("cleanTitle turns file names into titles without the author", () => {
  assert.equal(cleanTitle("dupont_la_riviere", "Claire Dupont"), "La riviere");
  assert.equal(cleanTitle("tchekhoviev_le_verger", "Anton Tchekhov"), "Le verger");
  assert.equal(cleanTitle("le_rouge_et_le_noir", "Stendhal"), "Le rouge et le noir");
});

test("normalizeLookup falls back to the word key for language and to the word for stem", () => {
  const lookup = normalizeLookup({ wordKey: "fr:auvent", word: "auvent", stem: null, lang: "", timestamp: "12" });
  assert.equal(lookup.lang, "fr");
  assert.equal(lookup.stem, "auvent");
  assert.equal(lookup.timestamp, 12);
});
