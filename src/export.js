// Helpers shared by the exporters, and the Clozemaster file format.

const GENDERS = { m: "masculin", f: "féminin", mf: "masculin et féminin" };

export function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function entryLabel(entry) {
  return [entry.pos, GENDERS[entry.gender]].filter(Boolean).join(", ");
}

const fold = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Matchers for the word family. Long words match by prefix ("dératé" -> "derat" catches
// "dératée", "rebut" -> "rebu" catches "rebuter"); short ones only as themselves plus e/s.
function familyMatchers(words) {
  const matchers = new Map();
  for (const word of words) {
    for (const part of fold(word).split(/[^\p{L}]+/u)) {
      if (part.length < 3) continue;
      if (part.length <= 4) {
        matchers.set(`=${part}`, (t) => t === part || t === `${part}s` || t === `${part}e` || t === `${part}es`);
      } else {
        const root = part.slice(0, part.length === 5 ? 4 : Math.max(5, part.length - 2));
        matchers.set(`^${root}`, (t) => t.startsWith(root));
      }
    }
  }
  return [...matchers.values()];
}

// Hides the answer and its relatives in a definition, so the definition is a clue rather than
// a giveaway (Wiktionary defines "dératé" as "Personne dératée, à laquelle on a ôté la rate.").
export function maskWord(text, words) {
  const matchers = familyMatchers(words);
  return text.replace(/\p{L}+/gu, (token) => (matchers.some((matches) => matches(fold(token))) ? "___" : token));
}

// HTML version for Anki: each masked word is kept inside <span class="mask"><span>…</span></span>,
// which the card hides on the front and shows on the back, so the blank is exactly as wide as the
// word it hides.
export function maskWordHtml(text, words) {
  const matchers = familyMatchers(words);
  let html = "";
  let last = 0;
  for (const match of text.matchAll(/\p{L}+/gu)) {
    if (!matchers.some((matches) => matches(fold(match[0])))) continue;
    html += `${escapeHtml(text.slice(last, match.index))}<span class="mask"><span>${escapeHtml(match[0])}</span></span>`;
    last = match.index + match[0].length;
  }
  return html + escapeHtml(text.slice(last));
}

// Every form and lemma of a card, used to mask definitions.
export function answerWords(card) {
  return [card.definition?.lemma, card.stem, ...card.sentences.map((s) => s.answer)].filter(Boolean);
}

function tsvField(value) {
  const flat = String(value ?? "").replace(/[\t\r\n]+/g, " ");
  return flat.includes('"') ? `"${flat.replace(/"/g, '""')}"` : flat;
}

function tsvRow(fields) {
  return fields.map(tsvField).join("\t");
}

// Clozemaster custom-collection upload: Sentence, Translation, Cloze, Pronunciation, Note.
// One row per sentence. The cloze column is the plain word as it appears in the sentence;
// Clozemaster adds the blank. For French immersion the "Translation" hint is the first
// French definition (with the answer masked) rather than an English translation.
export function toClozemasterTsv(cards) {
  const rows = cards.flatMap((card) => {
    const sense = card.definition?.entries[0]?.senses[0];
    const hint = sense ? maskWord(sense, answerWords(card)) : "";
    return card.sentences.map((s) => tsvRow([`${s.before}${s.answer}${s.after}`, hint, s.answer, "", s.bookTitle]));
  });
  return rows.join("\n") + "\n";
}
