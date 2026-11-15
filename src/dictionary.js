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

// Lowercase words and numbers of a text, split on everything else ("d’une" -> "d", "une").
export function tokens(text) {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// The hyphenated word a looked-up part belongs to: "un à-[pic]" -> "à-pic".
export function hyphenCompound({ before, answer, after }) {
  const left = before.match(/(?:\p{L}+-)+$/u)?.[0] ?? "";
  const right = after.match(/^(?:-\p{L}+)+/u)?.[0] ?? "";
  return left || right ? `${left}${answer}${right}`.toLowerCase() : null;
}

// Words of a locution that the sentence may leave out or change ("se", "son"/"mon", "un"…), plus
// "ne pas" as a pair. "être"/"avoir" stay required: dropping them let "avoir sujet de" match "le
// sujet de la conférence"; a lone "pas" stays too ("pas de parade" isn't "des parades").
const LOCUTION_OPTIONAL = new Set(["se", "s", "quelqu", "un", "une", "qqn", "quelque", "chose", "son", "sa", "ses", "soi"]);

// A locution's last word is always required: in "poupée de son", "son" is bran, not "his".
function requiredWords(locution) {
  const words = tokens(locution);
  return words.filter(
    (t, i) =>
      i === words.length - 1 || (!LOCUTION_OPTIONAL.has(t) && t !== "ne" && !(t === "pas" && words[i - 1] === "ne")),
  );
}

// French contractions: a locution's "de" is "d’", "du" or "des" in a sentence, "à" is "au"/"aux".
const CONTRACTIONS = { de: ["d", "du", "des"], à: ["au", "aux"], le: ["l"], la: ["l"] };
const ADVERBS = new Set(["aussitôt", "soudain", "vite", "toujours", "encore", "déjà", "même", "alors", "donc", "ainsi", "enfin", "souvent", "bientôt", "presque", "assez", "aussi"]);

// Little words that may sit inside a locution in a sentence: after its verb ("il ne me quitte
// jamais d’une semelle", "abattre enfin ses cartes"), and the optional words anywhere.
const VERB_GAP_WORDS = new Set([
  ...LOCUTION_OPTIONAL, ...ADVERBS, "ne", "n", "pas", "plus", "jamais", "rien", "bien", "le", "la", "les", "l", "lui", "leur", "me", "m", "te", "t",
  "nous", "vous", "y", "en", "tout", "tous", "toute", "toutes", "très", "trop", "guère", "point", "mon", "ton", "ma",
  "ta", "mes", "tes", "notre", "votre", "nos", "vos", "leurs",
]);

// A locution word matches a sentence word exactly, as a plural, or, for verbs, by stem
// ("quitter" matches "quittait"). Short words never match as plurals ("de" isn't "des").
function tokenMatches(locutionWord, word) {
  if (!word) return false;
  if (locutionWord === word || CONTRACTIONS[locutionWord]?.includes(word)) return true;
  if (locutionWord.length >= 3 && (word === `${locutionWord}s` || word === `${locutionWord}x`)) return true;
  const stem = locutionWord.replace(/(?:er|ir|re|oir)$/u, "");
  return locutionWord.length >= 5 && stem !== locutionWord && stem.length >= 3 && word.startsWith(stem);
}

// Whether the sentence contains the locution, in order, through the looked-up word. Only little
// words may sit between its parts: pronouns and adverbs after a verbal locution's verb ("il ne me
// quitte jamais d’une semelle"), otherwise just the optional ones ("d’une"). Anything else breaks
// the match, so "laisser le temps de" isn't "ne pas laisser de" and "de l’ocre, puis du rouge"
// isn't "ocre rouge".
export function matchesLocution(locution, sentenceTokens, answerIndex) {
  const required = requiredWords(locution);
  if (required.length < 2) return false;
  const verbal = /^\p{L}{2,}(?:er|ir|re|oir)$/u.test(required[0]);
  for (let start = Math.max(0, answerIndex - 12); start <= answerIndex; start++) {
    if (!tokenMatches(required[0], sentenceTokens[start])) continue;
    const used = [start];
    for (const [i, word] of required.slice(1).entries()) {
      const last = used.at(-1);
      const gapWords = verbal && i === 0 ? VERB_GAP_WORDS : LOCUTION_OPTIONAL;
      let found = -1;
      for (let p = last + 1; p <= last + 3 && p < sentenceTokens.length; p++) {
        if (tokenMatches(word, sentenceTokens[p])) {
          found = p;
          break;
        }
        const gap = sentenceTokens[p];
        if (!gapWords.has(gap) && !(gapWords === VERB_GAP_WORDS && /^\p{L}{3,}ment$/u.test(gap))) break;
      }
      if (found < 0) break;
      used.push(found);
    }
    if (used.length === required.length && used.includes(answerIndex)) return true;
  }
  return false;
}

// The card's first (most recent) sentence, the one the lookup reads for context.
function firstSentence(card) {
  return { before: "", after: "", ...card.sentences[0] };
}

// The longest locution containing the card's word that the sentence actually uses.
async function sentenceLocution(dictionary, card) {
  const sentence = firstSentence(card);
  const sentenceTokens = tokens(`${sentence.before}${sentence.answer}${sentence.after}`);
  const answerIndex = tokens(sentence.before).length;
  const locutions = new Set();
  for (const word of new Set([card.stem.toLowerCase(), sentence.answer.toLowerCase()])) {
    for (const entry of await dictionary.lookup(word)) for (const locution of entry.x ?? []) locutions.add(locution);
  }
  const matches = [...locutions].filter((l) => matchesLocution(l, sentenceTokens, answerIndex));
  return matches.sort((a, b) => tokens(b).length - tokens(a).length)[0] ?? null;
}

// Signs that the looked-up word is used as a verb: a subject or reflexive pronoun right before it
// ("ne te [bile] pas", "elle s’[escrime]"), an auxiliary before a participle ("le mur était
// [criblé]", "elle avait vraiment [bavé]"), or a gerund ("en [courant]").
const CLITIC = /(?:^|[\s'’])(?:je|j|tu|il|elle|on|nous|vous|ils|elles|me|m|te|t|se|s|ne|n)['’]?\s*$/iu;
const AUXILIARY =
  /(?:^|[\s'’])(?:ai|as|a|avons|avez|ont|avais|avait|avions|aviez|avaient|eu|est|es|suis|sommes|êtes|sont|était|étais|étions|étiez|étaient|été|fut|furent|sera|serait|avoir|être)\s+(?:(?:\p{L}+ment|bien|déjà|tout|encore|jamais|toujours|pas|plus)\s+)?$/iu;
const PARTICIPLE = /(?:é|ée|és|ées|i|ie|is|ies|u|ue|us|ues)$/iu;
export function verbSignal({ before, answer }) {
  return (
    CLITIC.test(before) ||
    (AUXILIARY.test(before) && PARTICIPLE.test(answer)) ||
    (/(?:^|\s)en\s+$/iu.test(before) && /ant$/iu.test(answer))
  );
}

async function lemmaDefinition(dictionary, word) {
  const entries = (await dictionary.lookup(word)).filter((e) => e.s);
  return entries.length ? definitionFrom(word, entries) : null;
}

// Tries, in order: the hyphenated word the sentence uses ("à-pic"), a locution the sentence uses
// ("au bout du rouleau"), then the Kindle stem and the forms that were looked up, following "form
// of" and "variant of" links ("défiait" -> "défier"). A noun is swapped for the verb the looked-up
// form belongs to when the sentence clearly uses a verb ("le mur était [criblé]" -> "cribler", not "crible").
export async function define(dictionary, card) {
  const sentence = firstSentence(card);
  const compound = hyphenCompound(sentence);
  if (compound) {
    const definition = await lemmaDefinition(dictionary, compound);
    if (definition) return definition;
  }
  const locution = await sentenceLocution(dictionary, card);
  if (locution) {
    const definition = await lemmaDefinition(dictionary, locution);
    if (definition) return definition;
  }
  const definition = await baseDefinition(dictionary, card);
  if (definition && verbSignal(sentence) && !/^(?:Verbe|Adjectif)/.test(definition.entries[0].pos)) {
    const forms = (await dictionary.lookup(sentence.answer.toLowerCase())).flatMap((e) => e.f ?? []);
    for (const lemma of new Set(forms)) {
      const verb = await lemmaDefinition(dictionary, lemma);
      if (verb && /^Verbe/.test(verb.entries[0].pos)) return verb;
    }
  }
  return definition;
}

async function baseDefinition(dictionary, card) {
  for (const candidate of candidatesFor(card)) {
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
