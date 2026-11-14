// Anki .apkg export with our own cloze note type, designed so revealing the answer moves nothing.
// Front: grammar chip, sentence(s) with a blank, up to three French senses with the answer's word
// family masked, synonyms, and an Indice. Back: exactly the same layout with the blanks filled in
// place (each blank already holds the hidden word, so lines never re-wrap), then, below Anki's
// <hr id="answer"> divider, the word with its article, any further senses, and the book.

import { answerWords, entryLabel, escapeHtml, maskWord, maskWordHtml } from "./export.js";
import { zip } from "./zip.js";

// Fixed so that re-importing a newer deck reuses the note type instead of creating a copy.
// Bump it whenever FIELDS change, so Anki doesn't try to merge incompatible note types.
export const NOTE_TYPE_ID = 1731600000003;
export const NOTE_TYPE_NAME = "Cloze Reader";
// "Indice" is also the label Anki shows on the hint link, so it stays French.
// Kind and Gender only feed CSS classes, which set the card's colour.
export const FIELDS = [
  "Text", "Blanked", "Grammar", "Definition", "Synonyms", "Indice", "Word", "MoreSenses", "Source", "Kind", "Gender",
];
// The front is a clue, not a dictionary page; further senses are only shown below the divider.
const FRONT_SENSES = 3;

// Shared by both sides so everything above the divider is laid out identically.
const TOP = (sentences) => `
  {{#Grammar}}<div class="chips"><span class="chip">{{Grammar}}</span></div>{{/Grammar}}
  <div class="sentences">${sentences}</div>
  {{#Definition}}<div class="panel">{{Definition}}</div>{{/Definition}}
  {{#Synonyms}}<div class="synonyms"><span class="label">Synonymes</span>{{Synonyms}}</div>{{/Synonyms}}`;

// The front shows "Blanked", whose blanks hold the answer invisibly so they're exactly as wide as
// the revealed word. {{cloze:Text}} must still appear for Anki to generate the card, so it's hidden.
const FRONT = `<div class="cr front k-{{Kind}} g-{{Gender}}">${TOP("{{Blanked}}")}
  {{#Indice}}<div class="hint">{{hint:Indice}}</div>{{/Indice}}
  <div hidden>{{cloze:Text}}</div>
</div>`;

// The Indice row keeps its space (hidden) so the divider lands where the front ended.
const BACK = `<div class="cr back k-{{Kind}} g-{{Gender}}">${TOP("{{cloze:Text}}")}
  {{#Indice}}<div class="hint placeholder" aria-hidden="true">{{Indice}}</div>{{/Indice}}
  <hr id="answer">
  <div class="headword">{{Word}}</div>
  {{#MoreSenses}}<div class="more"><div class="label">Autres sens</div>{{MoreSenses}}</div>{{/MoreSenses}}
  {{#Source}}<div class="source">{{Source}}</div>{{/Source}}
</div>`;

// Okabe–Ito colours (distinguishable with the common colour-vision deficiencies), darkened in
// light mode to keep text contrast at 4.5:1 or better. Masculine blue vs feminine vermillion is the
// pair that stays most distinct; the chip text and article always repeat the gender, so colour is
// never the only cue. Blanks and revealed words share one box style, so the reveal is a fill-in,
// not a re-layout.
const CSS = `.card {
  --bg: #ffffff; --text: #1d1d1f; --muted: #5f6368; --panel: #f5f6f8; --line: #e3e5e8;
  background: var(--bg); color: var(--text);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 18px; line-height: 1.6; text-align: left;
}
.card.nightMode, .night_mode .card {
  --bg: #17181a; --text: #ececee; --muted: #a2a6ad; --panel: #222427; --line: #33363b;
}
@media (min-width: 720px) { .card { font-size: 20px; } }

.cr { --accent: #4b5563; --tint: rgba(75, 85, 99, 0.1);
  max-width: 680px; margin: 0 auto; padding: 20px 16px 28px; overflow-wrap: break-word; }
.cr.k-verb { --accent: #007a5a; --tint: rgba(0, 158, 115, 0.13); }
.cr.k-adj  { --accent: #a3417a; --tint: rgba(204, 121, 167, 0.16); }
.cr.g-m    { --accent: #0068a8; --tint: rgba(0, 114, 178, 0.11); }
.cr.g-f    { --accent: #b34700; --tint: rgba(213, 94, 0, 0.11); }
.nightMode .cr, .night_mode .cr { --accent: #b4bac3; --tint: rgba(180, 186, 195, 0.14); }
.nightMode .cr.k-verb, .night_mode .cr.k-verb { --accent: #3fd0a4; --tint: rgba(0, 158, 115, 0.22); }
.nightMode .cr.k-adj,  .night_mode .cr.k-adj  { --accent: #ef9fcc; --tint: rgba(204, 121, 167, 0.24); }
.nightMode .cr.g-m,    .night_mode .cr.g-m    { --accent: #6cc0f2; --tint: rgba(86, 180, 233, 0.2); }
.nightMode .cr.g-f,    .night_mode .cr.g-f    { --accent: #ff9d5c; --tint: rgba(230, 120, 40, 0.22); }

.chips { margin-bottom: 0.9em; }
.chip { display: inline-block; padding: 0.15em 0.75em; border-radius: 999px; background: var(--tint);
  color: var(--accent); font-size: 0.78em; font-weight: 650; letter-spacing: 0.02em; }

.sentences { font-size: 1.12em; }
.sentences p { margin: 0 0 0.9em; }
.sentences p:last-child { margin-bottom: 0; }

.cloze, .mask { color: var(--accent); background: var(--tint); border-bottom: 2px solid var(--accent);
  border-radius: 4px; padding: 0 0.2em; }
.cloze { font-weight: 700; }
.mask { font-weight: 650; }
.front .cloze > span, .front .mask > span { visibility: hidden; }

.panel { margin-top: 1.3em; padding: 0.85em 1.1em; background: var(--panel);
  border-left: 4px solid var(--accent); border-radius: 8px; font-size: 0.92em; }
.panel .pos, .more .pos { color: var(--accent); font-size: 0.85em; font-weight: 650; }
.panel ol, .more ol { margin: 0.15em 0 0; padding-left: 1.3em; }
.panel li + li, .more li + li { margin-top: 0.35em; }
.panel li::marker, .more li::marker { color: var(--accent); font-weight: 650; }
.panel .entry + .entry, .more .entry + .entry { margin-top: 0.8em; }

.synonyms { margin-top: 1em; font-size: 0.9em; }
.synonyms .label, .more .label { color: var(--muted); font-size: 0.85em; font-weight: 650; margin-right: 0.5em; }
.syn { display: inline-block; margin: 0.15em 0.3em 0.15em 0; padding: 0.05em 0.6em;
  border: 1px solid var(--line); border-radius: 6px; }

.hint { margin-top: 1.1em; min-height: 2em; font-size: 0.95em; color: var(--muted); }
.hint a { color: var(--accent); font-weight: 650; text-decoration: none;
  padding: 0.3em 0.8em; border: 1px solid var(--accent); border-radius: 999px; }
.hint.placeholder { visibility: hidden; }

hr#answer { border: 0; border-top: 1px solid var(--line); margin: 1.2em 0 1em; }
.headword { font-size: 1.5em; font-weight: 750; line-height: 1.25; color: var(--accent); }
.headword .article { font-weight: 450; opacity: 0.75; white-space: pre; }
.more { margin-top: 0.9em; font-size: 0.92em; }
.source { margin-top: 1.1em; color: var(--muted); font-size: 0.8em; }`;

const KINDS = [
  [/^nom/i, "noun"],
  [/^verbe/i, "verb"],
  [/^adjectif/i, "adj"],
  [/^adverbe/i, "adv"],
  [/^locution/i, "expr"],
];

export function kindOf(pos = "") {
  return KINDS.find(([pattern]) => pattern.test(pos))?.[1] ?? "other";
}

// "la buvette", "le pic", "l’auvent". Words starting with h are left bare, since an aspirated h
// ("le héros") can't be told apart from a mute one ("l’homme") without more data.
export function withArticle(word, gender) {
  if (gender !== "m" && gender !== "f") return null;
  if (/^h/i.test(word)) return null;
  if (/^[aeiouyàâäéèêëîïôöùûü]/i.test(word)) return "l’";
  return gender === "m" ? "le" : "la";
}

// Splits the senses into the first `count` (shown above the divider) and the rest, keeping each
// sense's number within its entry so the list below the divider continues the numbering.
function splitSenses(definition, count) {
  const shown = [];
  const rest = [];
  let seen = 0;
  for (const entry of definition.entries) {
    entry.senses.forEach((sense, i) => (seen++ < count ? shown : rest).push({ entry, sense, number: i + 1 }));
  }
  return { shown, rest };
}

function sensesHtml(items, senseHtml, labelled) {
  const groups = [];
  for (const item of items) {
    if (groups.at(-1)?.entry !== item.entry) groups.push({ entry: item.entry, items: [] });
    groups.at(-1).items.push(item);
  }
  return groups
    .map(({ entry, items: group }) => {
      const label = labelled ? `<div class="pos">${escapeHtml(entryLabel(entry))}</div>` : "";
      const start = group[0].number > 1 ? ` start="${group[0].number}"` : "";
      return `<div class="entry">${label}<ol${start}>${group.map((s) => `<li>${senseHtml(s.sense)}</li>`).join("")}</ol></div>`;
    })
    .join("");
}

// Frequency bands as tags, so learners can build filtered decks per band in Anki.
export function frequencyTag(zipf) {
  if (typeof zipf !== "number") return "freq::unknown";
  return `freq::${zipf >= 3 ? "3+" : zipf >= 2 ? "2-3" : zipf >= 1 ? "1-2" : "below-1"}`;
}

// The answer's first letter; the blank itself already shows the length.
export function hintFor(word) {
  return `${[...word][0]}…`;
}

export function noteFields(card) {
  const words = answerWords(card);
  const definition = card.definition;
  const lemma = definition?.lemma ?? card.stem;
  const first = definition?.entries[0];
  const kind = kindOf(first?.pos);
  const gender = kind === "noun" ? first.gender : "";
  const article = kind === "noun" ? withArticle(lemma, gender) : null;
  // A synonym that shares the answer's root would give it away, so it's dropped rather than masked.
  const synonyms = (definition?.synonyms ?? []).filter((s) => maskWord(s, words) === s);
  // With a single entry the chip above already says what it is.
  const labelled = (definition?.entries.length ?? 0) > 1;
  const { shown, rest } = definition ? splitSenses(definition, FRONT_SENSES) : { shown: [], rest: [] };
  const sentence = (s, blank) => `<p>${escapeHtml(s.before)}${blank(escapeHtml(s.answer))}${escapeHtml(s.after)}</p>`;
  return {
    Text: card.sentences.map((s) => sentence(s, (answer) => `{{c1::${answer}}}`)).join(""),
    Blanked: card.sentences.map((s) => sentence(s, (answer) => `<span class="cloze"><span>${answer}</span></span>`)).join(""),
    Grammar: first ? escapeHtml(entryLabel(first)) : "",
    // The same field on both sides: masked words are hidden on the front and shown on the back.
    Definition: sensesHtml(shown, (sense) => maskWordHtml(sense, words), labelled),
    Synonyms: synonyms.map((s) => `<span class="syn">${escapeHtml(s)}</span>`).join(" "),
    Indice: escapeHtml(hintFor(card.sentences[0].answer)),
    Word: `${article ? `<span class="article">${article === "l’" ? article : `${article} `}</span>` : ""}${escapeHtml(lemma)}`,
    MoreSenses: sensesHtml(rest, escapeHtml, labelled),
    Source: escapeHtml(card.bookTitles.join(", ")),
    Kind: kind,
    Gender: gender ?? "",
  };
}

const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null,
  ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null,
  models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null,
  usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null,
  flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null,
  mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null,
  ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null,
  odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null,
  ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);`;

function noteType(seconds) {
  return {
    id: NOTE_TYPE_ID,
    name: NOTE_TYPE_NAME,
    type: 1,
    mod: seconds,
    usn: -1,
    sortf: 0,
    did: 1,
    tmpls: [{ name: "Cloze", ord: 0, qfmt: FRONT, afmt: BACK, bqfmt: "", bafmt: "", did: null }],
    flds: FIELDS.map((name, ord) => ({ name, ord, sticky: false, rtl: false, font: "Arial", size: 20, media: [] })),
    css: CSS,
    latexPre: "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\begin{document}\n",
    latexPost: "\\end{document}",
    latexsvg: false,
    req: [[0, "any", [0]]],
    tags: [],
    vers: [],
  };
}

function deck(id, name, seconds) {
  return {
    id, name, mod: seconds, usn: -1, desc: "", dyn: 0, conf: 1, collapsed: false, browserCollapsed: false,
    extendNew: 0, extendRev: 0, newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0],
  };
}

const DECK_OPTIONS = {
  1: {
    id: 1, name: "Default", mod: 0, usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true, dyn: false,
    new: { bury: false, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 0], order: 1, perDay: 20 },
    rev: { bury: false, ease4: 1.3, ivlFct: 1, maxIvl: 36500, perDay: 200, hardFactor: 1.2 },
    lapse: { delays: [10], leechAction: 1, leechFails: 8, minInt: 1, mult: 0 },
  },
};

function stableId(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return 1_600_000_000_000 + hash;
}

const stripHtml = (html) => html.replace(/<[^>]+>/g, "").replace(/\{\{c\d+::(.*?)\}\}/g, "$1");

async function checksum(text) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return parseInt([...new Uint8Array(digest).slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join(""), 16);
}

// `SQL` is the initialised sql.js module. Returns the .apkg bytes.
export async function buildApkg(SQL, cards, { deck: deckName, subdecks = false, now = Date.now() }) {
  const seconds = Math.floor(now / 1000);
  const decks = { 1: deck(1, "Default", seconds) };
  const deckId = (name) => {
    const id = stableId(name);
    decks[id] ??= deck(id, name, seconds);
    return id;
  };
  deckId(deckName);

  const db = new SQL.Database();
  try {
    db.run(SCHEMA);
    const insertNote = db.prepare("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    const insertCard = db.prepare("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const [i, card] of cards.entries()) {
      const fields = noteFields(card);
      const sortField = stripHtml(fields.Text);
      const tags = [
        "cloze-reader",
        ...card.bookTitles.map((t) => `book::${t.trim().replace(/\s+/g, "_")}`),
        frequencyTag(card.definition?.zipf),
      ];
      const did = deckId(subdecks ? `${deckName}::${card.bookTitles[0].replace(/::/g, ":")}` : deckName);
      const id = now + i;
      insertNote.run([
        id, `cloze-reader:${card.id}`, NOTE_TYPE_ID, seconds, -1, ` ${tags.join(" ")} `,
        FIELDS.map((name) => fields[name]).join("\x1f"), sortField, await checksum(sortField), 0, "",
      ]);
      insertCard.run([id, id, did, 0, seconds, -1, 0, 0, i + 1, 0, 0, 0, 0, 0, 0, 0, 0, ""]);
    }
    insertNote.free();
    insertCard.free();

    const conf = { nextPos: cards.length + 1, curDeck: 1, activeDecks: [1], sortType: "noteFld", addToCur: true };
    db.run("INSERT INTO col VALUES (1,?,?,?,11,0,0,0,?,?,?,?,'{}')", [
      seconds, now, now, JSON.stringify(conf), JSON.stringify({ [NOTE_TYPE_ID]: noteType(seconds) }),
      JSON.stringify(decks), JSON.stringify(DECK_OPTIONS),
    ]);
    return zip([
      { name: "collection.anki2", data: db.export() },
      { name: "media", data: new TextEncoder().encode("{}") },
    ]);
  } finally {
    db.close();
  }
}
