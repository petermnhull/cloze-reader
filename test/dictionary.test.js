import { test } from "node:test";
import assert from "node:assert/strict";
import { addDefinitions, bucketOf, createDictionary, define, MAX_SENSES } from "../src/dictionary.js";
import { compactEntry } from "../scripts/build-dictionary.mjs";

// A tiny in-memory dictionary laid out exactly like the built files.
function fakeDictionary(words, buckets = 4) {
  const files = { "dict/meta.json": { buckets } };
  for (const [key, entries] of Object.entries(words)) {
    const file = `dict/${bucketOf(key, buckets).toString(16).padStart(4, "0")}.json`;
    files[file] ??= {};
    files[file][key] = entries;
  }
  const loaded = [];
  const dictionary = createDictionary("dict", async (url) => {
    loaded.push(url);
    return files[url] ?? {};
  });
  return { dictionary, loaded };
}

const card = (stem, ...answers) => ({ stem, sentences: answers.map((answer) => ({ answer })) });

test("bucketOf is stable and in range", () => {
  assert.equal(bucketOf("buvette", 8192), bucketOf("buvette", 8192));
  for (const word of ["a", "défier", "aujourd’hui", "sous-fifre"]) {
    const bucket = bucketOf(word, 8192);
    assert.ok(bucket >= 0 && bucket < 8192);
  }
});

test("define uses the stem when it has senses", async () => {
  const { dictionary } = fakeDictionary({ buvette: [{ p: "Nom commun", g: "f", s: ["Petit café."] }] });
  assert.deepEqual(await define(dictionary, card("buvette", "buvettes")), {
    lemma: "buvette",
    entries: [{ pos: "Nom commun", gender: "f", senses: ["Petit café."] }],
    synonyms: [],
    zipf: null,
  });
});

test("define follows form-of links from the looked-up form", async () => {
  const { dictionary } = fakeDictionary({
    défiait: [{ p: "Forme de verbe", f: ["défier"] }],
    défier: [{ p: "Verbe", s: ["Provoquer quelqu’un."] }],
  });
  const definition = await define(dictionary, card("défiait", "défiait"));
  assert.equal(definition.lemma, "défier");
  assert.deepEqual(definition.entries[0].senses, ["Provoquer quelqu’un."]);
});

test("define tries the œ spelling and locutions starting with « à »", async () => {
  const { dictionary } = fakeDictionary({
    écœuré: [{ p: "Adjectif", s: ["Dégoûté."] }],
    "à tue-tête": [{ p: "Locution adverbiale", s: ["De toute la force de sa voix."] }],
  });
  assert.equal((await define(dictionary, card("écoeuré", "écoeurée"))).lemma, "écœuré");
  assert.equal((await define(dictionary, card("tue-tête", "tue-tête"))).lemma, "à tue-tête");
});

test("define reports the lemma's frequency", async () => {
  const { dictionary } = fakeDictionary({ buvette: [{ p: "Nom commun", s: ["Petit café."], z: 2.85 }] });
  assert.equal((await define(dictionary, card("buvette", "buvette"))).zipf, 2.85);
});

test("define collects synonyms across homographs without duplicates", async () => {
  const { dictionary } = fakeDictionary({
    pic: [{ p: "Nom commun", s: ["Sommet."], y: ["sommet", "cime"] }, { p: "Nom commun", s: ["Outil."], y: ["pioche", "cime"] }],
  });
  assert.deepEqual((await define(dictionary, card("pic", "pic"))).synonyms, ["sommet", "cime", "pioche"]);
});

test("define merges homographs, caps senses, and returns null when nothing is found", async () => {
  const { dictionary } = fakeDictionary({
    cap: [
      { p: "Nom commun", g: "m", s: ["Pointe de terre.", "Direction.", "Étape."] },
      { p: "Nom commun", g: "m", s: ["Abréviation de capitaine.", "Autre.", "Encore."] },
    ],
  });
  const definition = await define(dictionary, card("cap", "cap"));
  assert.equal(definition.entries.flatMap((e) => e.senses).length, MAX_SENSES);
  assert.equal(await define(dictionary, card("zzz", "zzz")), null);
});

test("each bucket file is fetched once", async () => {
  const { dictionary, loaded } = fakeDictionary({ buvette: [{ p: "Nom commun", s: ["Petit café."] }] });
  const cards = [card("buvette", "buvette"), card("buvette", "buvettes"), card("auvent", "auvent")];
  await addDefinitions(cards, dictionary);
  assert.equal(loaded.length, new Set(loaded).size);
  assert.equal(cards[0].definition.lemma, "buvette");
});

test("compactEntry keeps definitions, labels senses, and puts old senses last", () => {
  const { key, entry } = compactEntry({
    word: "Accueil",
    lang_code: "fr",
    pos: "noun",
    pos_title: "Nom commun 2",
    tags: ["masculine"],
    synonyms: [{ word: "réception" }, { word: "home", tags: ["Anglicism"] }, { word: "accueil" }, { word: "réception" }],
    senses: [
      { glosses: ["Fait d’accueillir."], tags: ["dated"] },
      { glosses: ["Lieu où l’on reçoit."] },
      { glosses: ["Page d’entrée d’un site."], raw_tags: ["Internet"], tags: ["familiar"] },
    ],
  });
  assert.equal(key, "accueil");
  assert.deepEqual(entry, {
    p: "Nom commun",
    g: "m",
    s: ["Lieu où l’on reçoit.", "(Familier, Internet) Page d’entrée d’un site.", "(Vieilli) Fait d’accueillir."],
    y: ["réception"],
  });
});

test("compactEntry turns inflected forms into links and skips proper nouns", () => {
  assert.deepEqual(
    compactEntry({
      word: "défiait",
      lang_code: "fr",
      pos: "verb",
      pos_title: "Forme de verbe",
      senses: [{ glosses: ["Imparfait de défier."], form_of: [{ word: "défier" }] }],
    }).entry,
    { p: "Forme de verbe", f: ["défier"] },
  );
  assert.deepEqual(
    compactEntry({
      word: "cure-dents",
      lang_code: "fr",
      pos: "noun",
      pos_title: "Nom commun",
      senses: [{ glosses: ["Variante orthographique de cure-dent."], alt_of: [{ word: "cure-dent" }] }],
    }).entry,
    { p: "Nom commun", f: ["cure-dent"] },
  );
  assert.equal(compactEntry({ word: "Paris", lang_code: "fr", pos: "name", pos_title: "Nom propre", senses: [] }), null);
});
