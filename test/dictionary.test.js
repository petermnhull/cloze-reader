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
      { p: "Nom commun", g: "m", s: ["Avancée dans la mer.", "Direction.", "Étape."] },
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

// Patterns from a backtest over real Kindle lookups, rewritten as invented sentences.
import { hyphenCompound, matchesLocution, tokens, verbSignal } from "../src/dictionary.js";
import { locutionWords } from "../scripts/build-dictionary.mjs";

const matches = (locution, sentence, answer) => {
  const words = tokens(sentence);
  return matchesLocution(locution, words, words.indexOf(answer));
};

test("matchesLocution finds locutions the sentence really uses", () => {
  assert.ok(matches("au bout du rouleau", "Après la randonnée, nous étions au bout du rouleau.", "rouleau"));
  assert.ok(matches("ne pas quitter d’une semelle", "Mon frère ne me quitte jamais d’une semelle.", "semelle"));
  assert.ok(matches("sonner le glas", "Ce scandale sonnera bientôt le glas du projet.", "glas"));
  assert.ok(matches("au sein de", "Le débat continue au sein des syndicats.", "sein"));
  assert.ok(matches("éclater en sanglots", "Le témoin éclata soudainement en sanglots.", "sanglots"));
  assert.ok(matches("abattre ses cartes", "Elle hésite à abattre enfin ses cartes.", "abattre"));
  assert.ok(matches("en un tournemain", "Le cuisinier prépara la sauce en un tournemain.", "tournemain"));
});

test("matchesLocution rejects false matches", () => {
  assert.ok(!matches("ocre rouge", "Elle choisit de l’ocre, puis du rouge.", "ocre"));
  assert.ok(!matches("ne pas laisser de", "Il faut laisser le temps de réfléchir.", "laisser"));
  assert.ok(!matches("regarder de côté", "Le guetteur regarde de chaque côté.", "regardait"));
  assert.ok(!matches("trouver son jour", "Nous trouvons chaque jour du nouveau.", "trouve"));
  assert.ok(!matches("pas de parade", "Le boxeur prépare des parades.", "parades"));
  assert.ok(!matches("avoir sujet de", "Le sujet de la conférence était flou.", "sujet"));
  assert.ok(!matches("100 premiers jours", "Ses premiers jours de stage furent doux.", "premiers"));
  assert.ok(!matches("poupée de son", "Une poupée de laine traînait par terre.", "poupée"));
  assert.ok(!matches("faire la bête", "Il veut faire la grosse bête.", "bête"));
});

test("hyphenCompound returns the whole hyphenated word", () => {
  assert.equal(hyphenCompound({ before: "au bord d’un à-", answer: "pic", after: "." }), "à-pic");
  assert.equal(hyphenCompound({ before: "un ", answer: "trop", after: "-plein d’eau" }), "trop-plein");
  assert.equal(hyphenCompound({ before: "le ", answer: "pic", after: " vert" }), null);
});

test("verbSignal spots verbs from pronouns, auxiliaries and gerunds", () => {
  assert.ok(verbSignal({ before: "– Te ", answer: "bile" }));
  assert.ok(verbSignal({ before: "Comme elle s’", answer: "escrime" }));
  assert.ok(verbSignal({ before: "Le mur était ", answer: "criblé" }));
  assert.ok(verbSignal({ before: "nous l'avions ", answer: "écumé" }));
  assert.ok(verbSignal({ before: "elle en avait vraiment ", answer: "bavé" }));
  assert.ok(verbSignal({ before: "il arriva en ", answer: "haletant" }));
  assert.ok(!verbSignal({ before: "Le voisin sortit en ", answer: "pantoufles" }));
  assert.ok(!verbSignal({ before: "le cheval secouait sa ", answer: "croupe" }));
});

test("locutionWords indexes a locution under its meaningful words", () => {
  assert.deepEqual(locutionWords("être au bout du rouleau"), ["bout", "rouleau"]);
  assert.deepEqual(locutionWords("ne pas quitter d’une semelle"), ["quitter", "semelle"]);
});

test("define prefers a locution the sentence uses, then the hyphenated word, then a verb", async () => {
  const { dictionary } = fakeDictionary({
    rouleau: [{ p: "Nom commun", s: ["Objet cylindrique."] }, { x: ["au bout du rouleau"] }],
    "au bout du rouleau": [{ p: "Locution adjectivale", s: ["Épuisé."] }],
    pic: [{ p: "Nom commun", s: ["Oiseau."] }],
    "à-pic": [{ p: "Nom commun", s: ["Paroi verticale."] }],
    bile: [{ p: "Nom commun", s: ["Humeur du foie."] }, { p: "Forme de verbe", f: ["biler"] }],
    biler: [{ p: "Verbe", s: ["S’inquiéter."] }],
  });
  const card = (before, answer, after) => ({ stem: answer, sentences: [{ before, answer, after }] });
  assert.equal((await define(dictionary, card("Nous étions au bout du ", "rouleau", "."))).lemma, "au bout du rouleau");
  assert.equal((await define(dictionary, card("au bord d’un à-", "pic", "."))).lemma, "à-pic");
  assert.equal((await define(dictionary, card("– Te ", "bile", " pas !"))).lemma, "biler");
  assert.equal((await define(dictionary, card("Le foie produit la ", "bile", "."))).lemma, "bile");
});
