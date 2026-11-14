import { test } from "node:test";
import assert from "node:assert/strict";
import { maskWord, maskWordHtml, toClozemasterTsv } from "../src/export.js";

test("maskWord hides the answer and its word family, accent-insensitively", () => {
  assert.equal(maskWord("Personne dératée, à laquelle on a ôté la rate.", ["dératé"]), "Personne ___, à laquelle on a ôté la rate.");
  assert.equal(maskWord("Action de rebuter (rejeter avec rudesse).", ["rebut"]), "Action de ___ (rejeter avec rudesse).");
  assert.equal(maskWord("Le PIC le plus haut ; picorer.", ["pic"]), "Le ___ le plus haut ; picorer.");
  assert.equal(maskWord("De toute la force de sa voix, à tue-tête.", ["à tue-tête"]), "De toute la force de sa voix, à ___-___.");
});

test("maskWordHtml wraps masked words and escapes the rest", () => {
  assert.equal(
    maskWordHtml("Action de rebuter & <rejeter>.", ["rebut"]),
    'Action de <span class="mask"><span>rebuter</span></span> &amp; &lt;rejeter&gt;.',
  );
});

const card = {
  id: "fr:sous-fifre",
  stem: "sous-fifre",
  bookTitles: ["Un roman policier", "Autre livre"],
  sentences: [
    { before: "Les ", answer: "sous-fifres", after: ' ont dit "non".', bookTitle: "Un roman policier" },
    { before: "Un ", answer: "sous-fifre", after: " attendait.", bookTitle: "Autre livre" },
  ],
  definition: { lemma: "sous-fifre", entries: [{ pos: "Nom commun", gender: "m", senses: ["Fifre de rang inférieur ; subalterne."] }] },
};

test("Clozemaster export has one row per sentence with a masked definition as the hint", () => {
  assert.deepEqual(toClozemasterTsv([card]).trimEnd().split("\n").map((r) => r.split("\t")), [
    ['"Les sous-fifres ont dit ""non""."', "___ de rang inférieur ; subalterne.", "sous-fifres", "", "Un roman policier"],
    ["Un sous-fifre attendait.", "___ de rang inférieur ; subalterne.", "sous-fifre", "", "Autre livre"],
  ]);
});
