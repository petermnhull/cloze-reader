// Client side of the Wiktionary definitions built by scripts/build-dictionary.mjs.
// The dictionary is split into hashed bucket files so a deck only fetches the buckets it needs.

export const MAX_SENSES = 5;
export const MAX_SYNONYMS = 6;

// FNV-1a over UTF-16 code units. The build script uses this same function.
export function bucketOf(key, buckets) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % buckets;
}

export function bucketFile(bucket) {
  return `${bucket.toString(16).padStart(4, "0")}.json`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't load ${url} (${response.status})`);
  return response.json();
}

export function createDictionary(baseUrl, load = fetchJson) {
  let meta;
  const buckets = new Map();
  return {
    async meta() {
      meta ??= load(`${baseUrl}/meta.json`);
      return meta;
    },
    async lookup(word) {
      const key = word.toLowerCase();
      const { buckets: count } = await this.meta();
      const bucket = bucketOf(key, count);
      if (!buckets.has(bucket)) buckets.set(bucket, load(`${baseUrl}/${bucketFile(bucket)}`));
      return (await buckets.get(bucket))[key] ?? [];
    },
  };
}

function definitionFrom(lemma, entries) {
  const result = [];
  let remaining = MAX_SENSES;
  for (const entry of entries) {
    if (remaining === 0) break;
    const senses = entry.s.slice(0, remaining);
    remaining -= senses.length;
    result.push({ pos: entry.p, gender: entry.g ?? "", senses });
  }
  const synonyms = [...new Set(entries.flatMap((entry) => entry.y ?? []))].slice(0, MAX_SYNONYMS);
  // Zipf frequency of the lemma: 3+ everyday, below 1 very rare, null when unknown (compounds).
  const zipf = entries.find((entry) => entry.z !== undefined)?.z ?? null;
  return { lemma, entries: result, synonyms, zipf };
}

function candidatesFor(card) {
  const words = [card.stem, ...card.sentences.map((s) => s.answer)].map((w) => w.toLowerCase());
  // Books and Kindle stems sometimes write "oe" where Wiktionary uses "œ" (écoeuré -> écœuré).
  const ligatures = words.map((w) => w.replace(/oe/g, "œ").replace(/ae/g, "æ"));
  // Some words only exist inside a locution: "tue-tête" -> "à tue-tête".
  return [...new Set([...words, ...ligatures, `à ${words[0]}`])];
}

// Tries the Kindle stem, then each form that was looked up, following "form of" and
// "variant of" links (e.g. "défiait" -> "défier") when a form has no definitions of its own.
export async function define(dictionary, card) {
  const candidates = candidatesFor(card);
  for (const candidate of candidates) {
    const entries = await dictionary.lookup(candidate);
    const lemmaEntries = entries.filter((e) => e.s);
    if (lemmaEntries.length) return definitionFrom(candidate, lemmaEntries);
    for (const lemma of new Set(entries.flatMap((e) => e.f ?? []))) {
      const target = (await dictionary.lookup(lemma)).filter((e) => e.s);
      if (target.length) return definitionFrom(lemma, target);
    }
  }
  return null;
}

// Adds `definition` to each card, a few lookups at a time.
export async function addDefinitions(cards, dictionary, { concurrency = 24, onProgress } = {}) {
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < cards.length) {
      const card = cards[next++];
      card.definition = await define(dictionary, card);
      onProgress?.(++done, cards.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, cards.length) }, worker));
  return cards;
}
