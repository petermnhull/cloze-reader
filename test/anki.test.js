import { test } from "node:test";
import assert from "node:assert/strict";
import { frequencyTag, hintFor, kindOf, noteFields, withArticle } from "../src/anki.js";
import { crc32 } from "../src/zip.js";

const card = {
  id: "fr:dératé",
  stem: "dératé",
  bookTitles: ["Vie & mort"],
  sentences: [{ before: "Il courait comme un ", answer: "dératé", after: ".", bookTitle: "Vie & mort" }],
  definition: {
    lemma: "dératé",
    entries: [{ pos: "Nom commun", gender: "m", senses: ["Personne dératée, à laquelle on a ôté la rate."] }],
  },
};

test("front and back share fields; blanks keep the hidden word so the reveal fills in place", () => {
  const fields = noteFields(card);
  assert.equal(fields.Text, "<p>Il courait comme un {{c1::dératé}}.</p>");
  assert.equal(fields.Blanked, '<p>Il courait comme un <span class="cloze"><span>dératé</span></span>.</p>');
  assert.equal(fields.Grammar, "Nom commun, masculin");
  assert.equal(
    fields.Definition,
    '<div class="entry"><ol><li>Personne <span class="mask"><span>dératée</span></span>, à laquelle on a ôté la rate.</li></ol></div>',
  );
  assert.equal(fields.MoreSenses, "");
  assert.equal(fields.Word, '<span class="article">le </span>dératé');
  assert.equal(fields.Indice, "d…");
  assert.equal(fields.Source, "Vie &amp; mort");
  assert.equal(fields.Kind, "noun");
  assert.equal(fields.Gender, "m");
});

test("senses beyond the first three go below the divider and keep their numbering", () => {
  const fields = noteFields({
    ...card,
    definition: { lemma: "x", entries: [{ pos: "Nom commun", gender: "f", senses: ["Un.", "Deux.", "Trois.", "Quatre.", "Cinq."] }] },
  });
  assert.equal(fields.Definition.match(/<li>/g).length, 3);
  assert.equal(fields.MoreSenses, '<div class="entry"><ol start="4"><li>Quatre.</li><li>Cinq.</li></ol></div>');
});

test("synonyms that share the answer's root are dropped; gender only colours nouns", () => {
  const fields = noteFields({
    ...card,
    definition: {
      lemma: "rapide",
      entries: [{ pos: "Adjectif", gender: "mf", senses: ["Qui va vite."] }],
      synonyms: ["véloce", "rapidement", "prompt"],
    },
  });
  assert.equal(fields.Synonyms, '<span class="syn">véloce</span> <span class="syn">prompt</span>');
  assert.equal(fields.Kind, "adj");
  assert.equal(fields.Gender, "");
  assert.equal(fields.Word, "rapide");
});

test("multiple entries are labelled inside the definition", () => {
  const fields = noteFields({
    ...card,
    definition: { lemma: "x", entries: [{ pos: "Nom commun", gender: "f", senses: ["Un."] }, { pos: "Verbe", senses: ["Deux."] }] },
  });
  assert.match(fields.Definition, /<div class="pos">Nom commun, féminin<\/div>.*<div class="pos">Verbe<\/div>/);
  assert.equal(fields.MoreSenses, "");
});

test("withArticle and kindOf", () => {
  assert.equal(withArticle("buvette", "f"), "la");
  assert.equal(withArticle("pic", "m"), "le");
  assert.equal(withArticle("auvent", "m"), "l’");
  assert.equal(withArticle("héros", "m"), null);
  assert.equal(withArticle("élève", "mf"), null);
  assert.equal(kindOf("Nom commun"), "noun");
  assert.equal(kindOf("Verbe"), "verb");
  assert.equal(kindOf("Locution adverbiale"), "expr");
  assert.equal(kindOf(undefined), "other");
});

test("cards without a definition still work", () => {
  const fields = noteFields({ ...card, definition: undefined });
  assert.equal(fields.Definition, "");
  assert.equal(fields.Grammar, "");
  assert.equal(fields.Word, "dératé");
  assert.equal(fields.Kind, "other");
});

test("hintFor gives the first letter", () => {
  assert.equal(hintFor("sous-fifre"), "s…");
  assert.equal(hintFor("à tue-tête"), "à…");
});

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("frequencyTag bands", () => {
  assert.deepEqual(
    [3.02, 2.85, 1.8, 0.4, 0, null, undefined].map(frequencyTag),
    ["freq::3+", "freq::2-3", "freq::1-2", "freq::below-1", "freq::below-1", "freq::unknown", "freq::unknown"],
  );
});
