import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCards, cleanUsage, makeCloze, MAX_SENTENCES } from "../src/cloze.js";

// Sentences here are invented: don't commit text copied from real books.

test("matches the looked-up form case-insensitively", () => {
  const cloze = makeCloze({ usage: "Épouvante et colère se mêlaient dans son regard fatigué.", word: "épouvante" });
  assert.deepEqual(cloze, { before: "", answer: "Épouvante", after: " et colère se mêlaient dans son regard fatigué." });
});

test("does not match inside a longer word", () => {
  const cloze = makeCloze({ usage: "Il a définitivement tort, mais il défie son père sans hésiter.", word: "défie" });
  assert.equal(cloze.before, "Il a définitivement tort, mais il ");
  assert.equal(cloze.answer, "défie");
});

test("handles elision and curly apostrophes", () => {
  assert.equal(makeCloze({ usage: "Il y avait presque de l’épouvante dans son regard.", word: "épouvante" }).before, "Il y avait presque de l’");
  assert.equal(makeCloze({ usage: "Aujourd’hui, il pleut beaucoup sur toute la ville.", word: "aujourd'hui" }).answer, "Aujourd’hui");
});

test("falls back to the stem, then gives up", () => {
  assert.equal(makeCloze({ usage: "Le sous-fifre attendait dans le couloir sombre.", word: "sous-fifres", stem: "sous-fifre" }).answer, "sous-fifre");
  assert.equal(makeCloze({ usage: "Rien à voir ici, vraiment rien du tout.", word: "buvette", stem: "buvette" }), null);
});

test("keeps only the sentence containing the word", () => {
  const cloze = makeCloze({
    usage: "Il pleuvait depuis le matin sur la ville. Elle ouvrit la buvette du quai sans un mot. Personne ne vint.",
    word: "buvette",
  });
  assert.deepEqual(cloze, { before: "Elle ouvrit la ", answer: "buvette", after: " du quai sans un mot." });
});

test("adds a neighbouring sentence when the sentence is very short", () => {
  const cloze = makeCloze({
    usage: "Il attendait devant la porte depuis longtemps. Quelle aubaine ! Tout le monde riait.",
    word: "aubaine",
  });
  assert.equal(cloze.before, "Il attendait devant la porte depuis longtemps. Quelle ");
  assert.equal(cloze.after, " !");
});

test("treats each em-dash dialogue turn as a sentence", () => {
  const cloze = makeCloze({
    usage: "Tu arrives d’où, au juste ? — D’une maison perchée en haut d’une falaise. — Ah, je vois.",
    word: "falaise",
  });
  assert.equal(cloze.before, "— D’une maison perchée en haut d’une ");
  assert.equal(cloze.after, ".");
});

test("cleans Kindle artefacts", () => {
  assert.equal(cleanUsage("» Il  sortit<br/>vite ; enfin."), "… Il sortit vite ; enfin.");
});

test("keeps quotes and punctuation outside the cloze", () => {
  // Regression: punctuation after the word, and HTML entities at export, stay outside the cloze.
  const cloze = makeCloze({ usage: 'Il se retourna : "Nous passerons demain au guichet."', word: "guichet" });
  assert.equal(cloze.answer, "guichet");
  assert.equal(cloze.after, '."');
});

const lookup = (overrides) => ({
  wordKey: "fr:buvette",
  word: "buvette",
  stem: "buvette",
  lang: "fr",
  bookKey: "book-a",
  title: "Livre A",
  timestamp: 1,
  usage: "Elle ouvrit la buvette du quai sans dire un seul mot.",
  ...overrides,
});

test("buildCards groups lookups by stem, newest sentence first, without duplicates", () => {
  const { cards } = buildCards([
    lookup({ timestamp: 1 }),
    lookup({ timestamp: 2 }),
    lookup({ timestamp: 5, wordKey: "fr:buvettes", word: "buvettes", title: "Livre B", usage: "Les buvettes du port fermaient toutes avant minuit." }),
  ]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, "fr:buvette");
  assert.deepEqual(cards[0].sentences.map((s) => s.answer), ["buvettes", "buvette"]);
  assert.deepEqual(cards[0].bookTitles, ["Livre B", "Livre A"]);
});

test("buildCards keeps at most MAX_SENTENCES sentences", () => {
  const usages = ["Une buvette ici, au bord de la route.", "Une buvette là-bas, près du vieux port.", "Une buvette partout, même dans la gare.", "Une buvette encore, au fond de la cour."];
  const { cards } = buildCards(usages.map((usage, i) => lookup({ usage, timestamp: i })));
  assert.equal(cards[0].sentences.length, MAX_SENTENCES);
  assert.match(cards[0].sentences[0].after, /cour/);
});

test("buildCards filters by language and book, and reports skips", () => {
  const { cards, failed, skipped } = buildCards(
    [
      lookup({}),
      lookup({ wordKey: "fr:et", word: "Et", stem: "et" }),
      lookup({ wordKey: "fr:auvent", word: "auvent", stem: "auvent" }),
      lookup({ wordKey: "fr:rebut", word: "rebut", stem: "rebut", bookKey: "book-b" }),
      lookup({ wordKey: "en:awning", word: "awning", stem: "awning", lang: "en" }),
    ],
    { lang: "fr", bookKeys: new Set(["book-a"]) },
  );
  assert.deepEqual(cards.map((c) => c.id), ["fr:buvette"]);
  assert.deepEqual(failed.map((l) => l.wordKey), ["fr:auvent"]);
  assert.deepEqual(skipped.map((l) => l.wordKey), ["fr:et"]);
});
