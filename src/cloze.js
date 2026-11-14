// Pure card-building logic: no DOM and no sql.js, so it runs in the browser and under `node --test`.

import { STOPWORDS } from "./stopwords.js";

const LETTER = "\\p{L}\\p{M}\\p{N}";
// Sentences shorter than this ("Quelle aubaine !") get a neighbouring sentence for context.
const MIN_CONTEXT_CHARS = 40;

const segmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("fr", { granularity: "sentence" })
    : null;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cleanUsage(text) {
  return (text ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[   ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^»\s*/, "… ");
}

// Kindle stores the exact form that was looked up, so a whole-word, case-insensitive
// search is enough. Straight and curly apostrophes are treated as the same character.
export function findWord(text, word) {
  const trimmed = (word ?? "").trim();
  if (!trimmed) return null;
  const pattern = escapeRegExp(trimmed).replace(/['’]/g, "['’]");
  const match = new RegExp(`(?<![${LETTER}])${pattern}(?![${LETTER}])`, "iu").exec(text);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

// Intl.Segmenter doesn't split French dialogue ("Tu viens d’où ? — De la gare."),
// so each em-dash turn is treated as its own sentence too.
function splitDialogue({ start, end }, text) {
  const spans = [];
  const turn = /\s—\s/g;
  turn.lastIndex = start + 1;
  let from = start;
  for (let m = turn.exec(text); m && m.index < end; m = turn.exec(text)) {
    spans.push({ start: from, end: m.index + 1 });
    from = m.index + 1;
  }
  spans.push({ start: from, end });
  return spans;
}

function sentenceSpans(text) {
  const spans = segmenter
    ? Array.from(segmenter.segment(text), (s) => ({ start: s.index, end: s.index + s.segment.length }))
    : [{ start: 0, end: text.length }];
  return spans.flatMap((span) => splitDialogue(span, text));
}

export function sentenceAround(text, start, end) {
  const spans = sentenceSpans(text);
  let first = spans.findIndex((s) => s.end > start);
  let last = spans.findIndex((s) => s.end >= end);
  while (spans[last].end - spans[first].start < MIN_CONTEXT_CHARS) {
    if (first > 0) first--;
    else if (last < spans.length - 1) last++;
    else break;
  }
  return { start: spans[first].start, end: spans[last].end };
}

export function makeCloze({ usage, word, stem }) {
  const text = cleanUsage(usage);
  const hit = findWord(text, word) ?? (stem && stem !== word ? findWord(text, stem) : null);
  if (!hit) return null;

  const span = sentenceAround(text, hit.start, hit.end);
  const raw = text.slice(span.start, span.end);
  const start = span.start + (raw.length - raw.trimStart().length);
  const end = span.end - (raw.length - raw.trimEnd().length);

  return {
    before: text.slice(start, hit.start),
    answer: text.slice(hit.start, hit.end),
    after: text.slice(hit.end, end),
  };
}

export const MAX_SENTENCES = 3;

// One card per stem ("défie" and "défiait" are both "défier"), with up to MAX_SENTENCES
// distinct sentences, most recent first.
export function buildCards(lookups, { lang, bookKeys } = {}) {
  const byStem = new Map();
  for (const lookup of lookups) {
    if (lang && lookup.lang !== lang) continue;
    if (bookKeys && !bookKeys.has(lookup.bookKey)) continue;
    const key = `${lookup.lang}:${lookup.stem.toLowerCase()}`;
    if (!byStem.has(key)) byStem.set(key, []);
    byStem.get(key).push(lookup);
  }

  const cards = [];
  const failed = [];
  const skipped = [];
  for (const [id, group] of byStem) {
    group.sort((a, b) => b.timestamp - a.timestamp);
    const [latest] = group;
    if (STOPWORDS[latest.lang]?.has(latest.stem.toLowerCase())) {
      skipped.push(latest);
      continue;
    }

    const sentences = [];
    const seen = new Set();
    for (const lookup of group) {
      const cloze = makeCloze(lookup);
      const text = cloze && cloze.before + cloze.answer + cloze.after;
      if (!cloze || seen.has(text)) continue;
      seen.add(text);
      sentences.push({ ...cloze, bookTitle: lookup.title });
      if (sentences.length === MAX_SENTENCES) break;
    }
    if (!sentences.length) {
      failed.push(latest);
      continue;
    }

    cards.push({
      id,
      stem: latest.stem,
      timestamp: latest.timestamp,
      bookTitles: [...new Set(sentences.map((s) => s.bookTitle))],
      sentences,
    });
  }

  cards.sort((a, b) => b.timestamp - a.timestamp);
  return { cards, failed, skipped };
}
