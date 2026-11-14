// Page wiring: load vocab.db with sql.js, let the user pick books, preview and export cards.

import { readLookups } from "./kindle.js";
import { buildCards } from "./cloze.js";
import { addDefinitions, createDictionary } from "./dictionary.js";
import { buildApkg, kindOf } from "./anki.js";
import { entryLabel, toClozemasterTsv } from "./export.js";
import { LEVELS, isKept, levelSummaries, sortCards, studyTime } from "./frequency.js";

const SQL_JS_BASE = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/";
const PREVIEW_LIMIT = 300;
const PREVIEW_SENSES = 2;
const DICTIONARY_LANGS = new Set(["fr"]);

const $ = (id) => document.getElementById(id);
const languageNames = new Intl.DisplayNames(["en"], { type: "language" });
const sqlReady = initSqlJs({ locateFile: (file) => SQL_JS_BASE + file });

const state = {
  lookups: [],
  lang: "",
  bookKeys: new Set(),
  excluded: new Set(),
  result: { cards: [], failed: [], skipped: [] },
  // Definitions by card id, kept across book changes so each word is only looked up once.
  definitions: new Map(),
  // Cards whose lemma is rarer than this Zipf frequency are left out (0 keeps everything).
  minZipf: 0,
  sort: "recent",
  // The previewed cards and their <li>s, so changing the word level only toggles classes.
  previewItems: [],
  lookup: { generation: 0, done: 0, total: 0, error: "" },
};

const dictionaries = new Map();
function dictionaryFor(lang) {
  if (!DICTIONARY_LANGS.has(lang)) return null;
  if (!dictionaries.has(lang)) dictionaries.set(lang, createDictionary(`dict/${lang}`));
  return dictionaries.get(lang);
}

function showError(message) {
  $("error").textContent = message;
  $("error").hidden = !message;
}

async function loadFile(file) {
  showError("");
  try {
    const SQL = await sqlReady;
    const db = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
    try {
      state.lookups = readLookups(db);
    } finally {
      db.close();
    }
  } catch (err) {
    showError(err.message);
    return;
  }
  if (!state.lookups.length) {
    showError("This vocab.db has no lookups yet. Look up a few words on your Kindle first.");
    return;
  }
  state.excluded.clear();
  renderLanguages();
  $("setup").hidden = false;
}

function countBy(items, key) {
  const counts = new Map();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

function languageName(code) {
  try {
    return languageNames.of(code);
  } catch {
    return code;
  }
}

function renderLanguages() {
  const counts = [...countBy(state.lookups, (l) => l.lang)].sort((a, b) => b[1] - a[1]);
  const select = $("lang");
  select.replaceChildren(
    ...counts.map(([code, count]) => new Option(`${languageName(code)} (${count} lookups)`, code)),
  );
  select.value = counts.some(([code]) => code === "fr") ? "fr" : counts[0][0];
  selectLanguage(select.value);
}

function selectLanguage(lang) {
  state.lang = lang;
  state.bookKeys = new Set(state.lookups.filter((l) => l.lang === lang).map((l) => l.bookKey));
  renderBooks();
  refresh();
}

// Samples and different editions of one book get separate keys, so the list is grouped by title.
function renderBooks() {
  const lookups = state.lookups.filter((l) => l.lang === state.lang);
  const keysByTitle = new Map();
  for (const l of lookups) {
    if (!keysByTitle.has(l.title)) keysByTitle.set(l.title, new Set());
    keysByTitle.get(l.title).add(l.bookKey);
  }
  const counts = [...countBy(lookups, (l) => l.title)].sort((a, b) => b[1] - a[1]);

  $("books").replaceChildren(
    ...counts.map(([title, count]) => {
      const keys = keysByTitle.get(title);
      const checkbox = Object.assign(document.createElement("input"), {
        type: "checkbox",
        checked: [...keys].some((key) => state.bookKeys.has(key)),
      });
      checkbox.addEventListener("change", () => {
        for (const key of keys) {
          if (checkbox.checked) state.bookKeys.add(key);
          else state.bookKeys.delete(key);
        }
        refresh();
      });
      const label = document.createElement("label");
      label.append(
        checkbox,
        title,
        Object.assign(document.createElement("span"), { className: "count", textContent: count }),
      );
      const item = document.createElement("li");
      item.append(label);
      return item;
    }),
  );
}

// Cards that pass the chosen word level. Words whose frequency isn't known (compounds, or
// definitions still loading) are kept.
function keptCards() {
  return state.result.cards.filter((card) => isKept(card, state.minZipf));
}

function selectedCards() {
  return keptCards().filter((card) => !state.excluded.has(card.id));
}

function renderStats() {
  const { cards, failed, skipped } = state.result;
  const kept = keptCards().length;
  const selected = selectedCards().length;
  const parts = [`<strong>${selected}</strong> cards selected`];
  if (selected !== kept) parts.push(`${kept - selected} unticked`);
  if (kept !== cards.length) parts.push(`${cards.length - kept} rare words left out`);
  if (skipped.length) parts.push(`${skipped.length} function words skipped`);
  if (failed.length) parts.push(`${failed.length} couldn't be matched`);
  const { done, total, error } = state.lookup;
  const lookingUp = done < total;
  if (lookingUp) parts.push(`looking up definitions… ${done}/${total}`);
  else if (error) parts.push(error);
  else if (dictionaryFor(state.lang)) {
    const undefinedCount = cards.filter((c) => !c.definition).length;
    if (undefinedCount) parts.push(`${undefinedCount} without a definition`);
  }
  $("stats").innerHTML = parts.join(" · ");
  $("export-anki").disabled = $("export-clozemaster").disabled = selected === 0 || lookingUp;
}

function renderDefinition(card) {
  const definition = document.createElement("p");
  definition.className = "definition";
  if (!card.definition) {
    definition.textContent = state.lookup.done < state.lookup.total ? "…" : "No definition found";
    return definition;
  }
  const [entry] = card.definition.entries;
  const label = Object.assign(document.createElement("span"), { className: "pos", textContent: entryLabel(entry) });
  const senses = entry.senses.slice(0, PREVIEW_SENSES).map((sense, n) => `${n + 1}. ${sense}`);
  definition.append(label, senses.join("  "));
  return definition;
}

// The same colour coding as the Anki card: gender for nouns, otherwise the word kind.
function colourClass(card) {
  const entry = card.definition?.entries[0];
  const kind = kindOf(entry?.pos);
  if (kind === "noun" && (entry.gender === "m" || entry.gender === "f")) return `g-${entry.gender}`;
  return `k-${kind === "verb" || kind === "adj" ? kind : "other"}`;
}

function renderCard(card) {
  const checkbox = Object.assign(document.createElement("input"), {
    type: "checkbox",
    checked: !state.excluded.has(card.id),
  });
  const item = document.createElement("li");
  item.className = colourClass(card);
  item.classList.toggle("excluded", !checkbox.checked);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) state.excluded.delete(card.id);
    else state.excluded.add(card.id);
    item.classList.toggle("excluded", !checkbox.checked);
    renderStats();
  });

  const sentences = card.sentences.map((s) => {
    const sentence = document.createElement("p");
    sentence.className = "sentence";
    sentence.append(s.before, Object.assign(document.createElement("mark"), { textContent: s.answer }), s.after);
    return sentence;
  });

  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = `${card.definition?.lemma ?? card.stem} · ${card.bookTitles.join(", ")}`;

  const body = document.createElement("div");
  body.append(...sentences, meta);
  if (dictionaryFor(state.lang)) body.append(renderDefinition(card));
  const label = document.createElement("label");
  label.append(checkbox, body);
  item.append(label);
  return item;
}

const ORDER_NAMES = { recent: "most recent", rare: "rarest", common: "most common" };

function render() {
  const { failed } = state.result;
  const cards = sortCards(state.result.cards, state.sort).slice(0, PREVIEW_LIMIT);

  state.previewItems = cards.map((card) => ({ card, item: renderCard(card) }));
  $("cards").replaceChildren(...state.previewItems.map(({ item }) => item));
  $("more").textContent =
    state.result.cards.length > PREVIEW_LIMIT
      ? `Showing your ${PREVIEW_LIMIT} ${ORDER_NAMES[state.sort]} words. Every word that isn't skipped or unticked is in the download.`
      : "";

  $("failed-box").hidden = failed.length === 0;
  $("failed-summary").textContent = `${failed.length} words couldn't be found in their sentence`;
  $("failed").replaceChildren(
    ...failed.map((l) => Object.assign(document.createElement("li"), { textContent: `${l.word}: ${l.usage}` })),
  );

  renderFrequency();
}

function frequencyLoading() {
  return state.lookup.done < state.lookup.total;
}

// The level choices are built once; renderFrequency only updates their text, so a selected or
// focused option is never replaced mid-interaction.
const levelOptions = LEVELS.map((level) => {
  const input = Object.assign(document.createElement("input"), { type: "radio", name: "level", value: level.min });
  input.checked = level.min === 0;
  input.addEventListener("change", () => {
    state.minZipf = level.min;
    renderFrequency();
  });
  const title = Object.assign(document.createElement("span"), { className: "level-title", textContent: level.title });
  const count = Object.assign(document.createElement("span"), { className: "level-count" });
  const detail = Object.assign(document.createElement("span"), { className: "level-detail" });
  const label = Object.assign(document.createElement("label"), { className: "level" });
  label.append(input, title, count, detail);
  $("levels").append(label);
  return { level, label, count, detail };
});

function formatCount(n) {
  return n.toLocaleString("en");
}

// Everything the level choice affects: the counts and examples on each option, the dimmed
// preview cards and the summary line.
function renderFrequency() {
  const cards = state.result.cards;
  $("freq-box").hidden = !dictionaryFor(state.lang);
  const loading = frequencyLoading();

  for (const option of levelOptions) option.label.classList.toggle("selected", option.level.min === state.minZipf);
  levelSummaries(cards).forEach((level, i) => {
    const { count, detail } = levelOptions[i];
    count.textContent = loading ? "…" : `${formatCount(level.kept)} cards · ${studyTime(level.kept)} at 20 new a day`;
    if (i === 0) detail.textContent = "Everything you looked up.";
    else if (loading) detail.textContent = "";
    else if (!level.newlySkipped.length) detail.textContent = "Leaves out nothing more for your books.";
    else {
      const examples = Object.assign(document.createElement("i"), { textContent: level.newlySkipped.join(", ") });
      detail.replaceChildren(i === 1 ? "Leaves out words like " : "Also leaves out words like ", examples, ".");
    }
  });

  const unknown = cards.filter((card) => card.definition && card.definition.zipf === null).length;
  $("freq-help").textContent = loading
    ? `Working out how common each word is… ${state.lookup.done}/${state.lookup.total}`
    : unknown
      ? `Expressions like “sous-fifre” or “à tue-tête” (${unknown} in your books) are always kept.`
      : "";

  for (const { card, item } of state.previewItems) item.classList.toggle("skipped", !isKept(card, state.minZipf));
  renderStats();
}

async function refresh() {
  state.result = buildCards(state.lookups, { lang: state.lang, bookKeys: state.bookKeys });
  for (const card of state.result.cards) card.definition = state.definitions.get(card.id);

  const dictionary = dictionaryFor(state.lang);
  const missing = dictionary ? state.result.cards.filter((c) => !state.definitions.has(c.id)) : [];
  const generation = ++state.lookup.generation;
  state.lookup = { generation, done: 0, total: missing.length, error: "" };
  render();
  if (!missing.length) return;

  try {
    await addDefinitions(missing, dictionary, {
      onProgress: (done) => {
        if (generation !== state.lookup.generation) return;
        state.lookup.done = done;
        if (done % 50 === 0) renderFrequency();
      },
    });
    for (const card of missing) state.definitions.set(card.id, card.definition);
  } catch (err) {
    if (generation === state.lookup.generation) state.lookup.error = `definitions unavailable (${err.message})`;
  }
  if (generation !== state.lookup.generation) return;
  state.lookup.done = state.lookup.total;
  render();
}

function download(filename, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("demo-reveal").addEventListener("click", (event) => {
  const revealed = $("demo").classList.toggle("revealed");
  event.target.textContent = revealed ? "Masquer" : "Révéler";
  event.target.setAttribute("aria-pressed", String(revealed));
});

$("file").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) loadFile(file);
});

const drop = $("drop");
drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.classList.remove("over");
  const [file] = event.dataTransfer.files;
  if (file) loadFile(file);
});

$("lang").addEventListener("change", (event) => selectLanguage(event.target.value));
$("sort").addEventListener("change", (event) => {
  state.sort = event.target.value;
  render();
});
$("books-all").addEventListener("click", () => {
  state.bookKeys = new Set(state.lookups.filter((l) => l.lang === state.lang).map((l) => l.bookKey));
  renderBooks();
  refresh();
});
$("books-none").addEventListener("click", () => {
  state.bookKeys.clear();
  renderBooks();
  refresh();
});

$("export-anki").addEventListener("click", async () => {
  const deck = $("deck").value.trim() || "Kindle cloze";
  const apkg = await buildApkg(await sqlReady, selectedCards(), { deck, subdecks: $("subdecks").checked });
  download("cloze-reader-anki.apkg", apkg, "application/octet-stream");
});
$("export-clozemaster").addEventListener("click", () => {
  download("cloze-reader-clozemaster.tsv", toClozemasterTsv(selectedCards()), "text/tab-separated-values;charset=utf-8");
});
