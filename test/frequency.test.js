import { test } from "node:test";
import assert from "node:assert/strict";
import { examplesBetween, isKept, levelSummaries, sortCards, studyTime } from "../src/frequency.js";

const card = (lemma, zipf) => ({ id: lemma, definition: zipf === undefined ? undefined : { lemma, zipf } });
const cards = [
  card("buvette", 2.85), card("cahoter", 0), card("sous-fifre", null), card("maison", 5.4),
  card("auvent", 2.73), card("vriller", 1.6), card("poutre", 3.4), card("loading"),
];

test("isKept keeps words at or above the threshold, and unknown frequencies", () => {
  assert.deepEqual(cards.filter((c) => isKept(c, 2.8)).map((c) => c.id), ["buvette", "sous-fifre", "maison", "poutre", "loading"]);
  assert.equal(cards.filter((c) => isKept(c, 0)).length, cards.length);
});

test("levelSummaries counts each level and shows the words it adds to the cut", () => {
  const levels = levelSummaries(cards);
  assert.deepEqual(levels.map((l) => l.kept), [8, 7, 6, 4, 3]);
  assert.deepEqual(levels.map((l) => l.newlySkipped), [[], ["cahoter"], ["vriller"], ["auvent", "buvette"], ["poutre"]]);
  assert.equal(levels[2].title, "Skip rare words");
});

test("examplesBetween spreads its picks across the band", () => {
  const many = Array.from({ length: 9 }, (_, i) => card(`w${i}`, 1 + i / 10));
  assert.deepEqual(examplesBetween(many, 1, 2), ["w1", "w4", "w7"]);
});

test("studyTime at 20 new cards a day", () => {
  assert.deepEqual([0, 1, 20, 21, 279, 1800, 4000].map((n) => studyTime(n)), [
    "no new cards", "1 day", "1 day", "2 days", "about 2 weeks", "about 13 weeks", "about 7 months",
  ]);
});

test("sortCards orders by frequency with unknowns last, or keeps recency", () => {
  assert.deepEqual(sortCards(cards, "rare").map((c) => c.id).slice(0, 3), ["cahoter", "vriller", "auvent"]);
  assert.deepEqual(sortCards(cards, "common").map((c) => c.id).slice(0, 2), ["maison", "poutre"]);
  assert.deepEqual(sortCards(cards, "rare").slice(-2).map((c) => c.id), ["sous-fifre", "loading"]);
  assert.equal(sortCards(cards, "recent"), cards);
});
