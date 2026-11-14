// Dev tool: run the card pipeline against a real vocab.db without the browser.
// Usage: node scripts/check-db.mjs path/to/vocab.db [lang]   (needs the sqlite3 CLI)
// If dict/<lang>/ has been built (npm run build-dict), definitions are looked up too.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { LOOKUPS_SQL, normalizeLookup } from "../src/kindle.js";
import { buildCards } from "../src/cloze.js";
import { addDefinitions, createDictionary } from "../src/dictionary.js";

const [dbPath, lang = "fr"] = process.argv.slice(2);
if (!dbPath) {
  console.error("Usage: node scripts/check-db.mjs path/to/vocab.db [lang]");
  process.exit(1);
}

const json = execFileSync("sqlite3", ["-json", dbPath, LOOKUPS_SQL], { maxBuffer: 1 << 28 }).toString();
const lookups = JSON.parse(json || "[]").map(normalizeLookup);
const { cards, failed, skipped } = buildCards(lookups, { lang });

console.log(`${lookups.length} lookups -> ${cards.length} cards, ${failed.length} unmatched, ${skipped.length} function words skipped\n`);

const dictDir = `dict/${lang}`;
if (existsSync(`${dictDir}/meta.json`)) {
  let gzippedBytes = 0;
  const files = new Set();
  const dictionary = createDictionary(dictDir, async (path) => {
    const text = readFileSync(path, "utf8");
    if (!files.has(path)) gzippedBytes += gzipSync(text).length;
    files.add(path);
    return JSON.parse(text);
  });
  await addDefinitions(cards, dictionary);
  const missing = cards.filter((c) => !c.definition);
  console.log(`Definitions: ${cards.length - missing.length}/${cards.length} cards`);
  console.log(`Would download ${files.size} dictionary files, ${(gzippedBytes / 1e6).toFixed(1)} MB gzipped`);
  console.log(`No definition: ${missing.map((c) => c.stem).join(", ")}\n`);
}

for (const card of cards.slice(0, 10)) {
  console.log(`  ${card.stem}: ${card.sentences.map((s) => `${s.before}[${s.answer}]${s.after}`).join("  |  ")}`);
  for (const entry of card.definition?.entries ?? []) console.log(`      ${entry.pos} ${entry.gender}: ${entry.senses.join(" / ")}`.slice(0, 220));
}
if (failed.length) {
  console.log("\nUnmatched:");
  for (const lookup of failed) console.log(`  ${lookup.word} (${lookup.stem}): ${lookup.usage.slice(0, 100)}`);
}
