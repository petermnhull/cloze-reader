// Builds the bucketed French dictionary served under dict/fr/ from a kaikki.org extract of
// the French-language Wiktionary (https://kaikki.org/frwiktionary/Français/).
// Usage: node scripts/build-dictionary.mjs kaikki.org-dictionary-Français.jsonl.gz [outDir] [buckets] [--freq freq-fr.tsv]
// --freq adds each word's Zipf frequency (from scripts/export-wordfreq.py) to its entries as `z`.
//
// The output is derived from Wiktionary and is licensed CC BY-SA 4.0 like its source.

import { createReadStream, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { pathToFileURL } from "node:url";
import { bucketFile, bucketOf } from "../src/dictionary.js";

const MAX_SENSES_PER_ENTRY = 6;
const MAX_GLOSS_CHARS = 300;

const SKIP_POS = new Set(["name", "character", "symbol", "punct", "romanization"]);

// Wiktextract sense tags are English; these are the labels a French dictionary would print.
const TAG_LABELS = {
  familiar: "Familier",
  figuratively: "Figuré",
  dated: "Vieilli",
  obsolete: "Désuet",
  archaic: "Archaïque",
  literary: "Littéraire",
  pejorative: "Péjoratif",
  slang: "Argot",
  vulgar: "Vulgaire",
  informal: "Familier",
  rare: "Rare",
  "Anglicism": "Anglicisme",
  regional: "Régionalisme",
};
// Senses with these tags go after the current ones.
const OLD_TAGS = new Set(["dated", "obsolete", "archaic"]);
// Synonyms a learner shouldn't be steered towards.
const SKIP_SYNONYM_TAGS = new Set([...OLD_TAGS, "Anglicism", "rare"]);
const MAX_SYNONYMS = 6;

function synonymsOf(raw) {
  const words = (raw.synonyms ?? [])
    .filter((s) => s.word && s.word.toLowerCase() !== raw.word.toLowerCase() && !s.tags?.some((t) => SKIP_SYNONYM_TAGS.has(t)))
    .map((s) => s.word);
  return [...new Set(words)].slice(0, MAX_SYNONYMS);
}

function formatSense(sense) {
  const gloss = sense.glosses.at(-1).trim();
  const labels = [
    ...new Set([...(sense.tags ?? []).map((t) => TAG_LABELS[t]).filter(Boolean), ...(sense.raw_tags ?? []).slice(0, 2)]),
  ];
  const text = labels.length ? `(${labels.join(", ")}) ${gloss}` : gloss;
  return text.length > MAX_GLOSS_CHARS ? `${text.slice(0, MAX_GLOSS_CHARS - 1)}…` : text;
}

function gender(tags = []) {
  const m = tags.includes("masculine");
  const f = tags.includes("feminine");
  return m && f ? "mf" : m ? "m" : f ? "f" : undefined;
}

// One raw wiktextract line -> { key, entry } or null. An entry is either
// { p: part of speech, g?: gender, s: [senses], y?: [synonyms] } or, for inflected forms, { p, f: [lemmas] }.
export function compactEntry(raw) {
  if (raw.lang_code !== "fr" || SKIP_POS.has(raw.pos) || !raw.word) return null;
  if (/^(Nom propre|Prénom|Nom de famille)/.test(raw.pos_title ?? "")) return null;

  const pos = (raw.pos_title ?? raw.pos).replace(/\s+\d+$/, "");
  const senses = (raw.senses ?? []).filter((s) => s.glosses?.length);
  // "Pluriel de …" (form_of) and "Variante orthographique de …" (alt_of) both just point elsewhere.
  const links = (s) => [...(s.form_of ?? []), ...(s.alt_of ?? [])];
  const definitions = senses.filter((s) => !links(s).length);
  const key = raw.word.toLowerCase();

  if (definitions.length) {
    const ordered = [
      ...definitions.filter((s) => !s.tags?.some((t) => OLD_TAGS.has(t))),
      ...definitions.filter((s) => s.tags?.some((t) => OLD_TAGS.has(t))),
    ];
    const synonyms = synonymsOf(raw);
    const entry = { p: pos, g: gender(raw.tags), s: ordered.slice(0, MAX_SENSES_PER_ENTRY).map(formatSense) };
    return { key, entry: synonyms.length ? { ...entry, y: synonyms } : entry };
  }
  const lemmas = [...new Set(senses.flatMap((s) => links(s).map((f) => f.word)).filter(Boolean))];
  return lemmas.length ? { key, entry: { p: pos, f: lemmas } } : null;
}

function readFrequencies(path) {
  const frequencies = new Map();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [word, zipf] = line.split("\t");
    if (word && zipf) frequencies.set(word, Number(zipf));
  }
  return frequencies;
}

async function build(input, outDir, buckets, frequencies) {
  const data = Array.from({ length: buckets }, () => ({}));
  let lines = 0;
  let kept = 0;
  const lineReader = createInterface({ input: createReadStream(input).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lineReader) {
    if (++lines % 200000 === 0) console.log(`${lines} lines, ${kept} entries`);
    const result = compactEntry(JSON.parse(line));
    if (!result) continue;
    if (result.entry.s && frequencies) {
      // A single word missing from wordfreq is genuinely rare (0). Compounds and locutions
      // ("sous-fifre", "à tue-tête") aren't in its list at all, so their frequency stays unknown.
      const zipf = frequencies.get(result.key) ?? (/^\p{L}+$/u.test(result.key) ? 0 : undefined);
      if (zipf !== undefined) result.entry.z = zipf;
    }
    const bucket = data[bucketOf(result.key, buckets)];
    (bucket[result.key] ??= []).push(result.entry);
    kept++;
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  data.forEach((bucket, i) => writeFileSync(`${outDir}/${bucketFile(i)}`, JSON.stringify(bucket)));
  writeFileSync(
    `${outDir}/meta.json`,
    JSON.stringify({
      buckets,
      entries: kept,
      builtAt: new Date().toISOString(),
      source: "French-language Wiktionary via kaikki.org (wiktextract)",
      license: "CC BY-SA 4.0",
    }),
  );
  console.log(`Done: ${lines} lines, ${kept} entries in ${buckets} buckets -> ${outDir}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const freqAt = args.indexOf("--freq");
  const frequencies = freqAt >= 0 ? readFrequencies(args.splice(freqAt, 2)[1]) : null;
  const [input, outDir = "dict/fr", buckets = "32768"] = args;
  if (!input) {
    console.error("Usage: node scripts/build-dictionary.mjs kaikki.org-dictionary-Français.jsonl.gz [outDir] [buckets] [--freq freq-fr.tsv]");
    process.exit(1);
  }
  await build(input, outDir, Number(buckets), frequencies);
}
