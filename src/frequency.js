// "Which words do you want to learn?": a few named levels instead of raw frequency scores.
// Frequencies are wordfreq Zipf values (3+ everyday, below 1 very rare); compounds and locutions
// have none and are always kept.

export const LEVELS = [
  { min: 0, title: "Every word" },
  { min: 1, title: "Skip the rarest words" },
  { min: 2, title: "Skip rare words" },
  { min: 3, title: "Common words only" },
  { min: 4, title: "Everyday words only" },
];

// Anki's default number of new cards a day.
export const NEW_CARDS_PER_DAY = 20;

export function zipfOf(card) {
  const zipf = card.definition?.zipf;
  return typeof zipf === "number" ? zipf : null;
}

export function isKept(card, minZipf) {
  const zipf = zipfOf(card);
  return zipf === null || zipf >= minZipf;
}

// A few words spread across [from, to), so a level is illustrated by typical words rather than
// only the extremes.
export function examplesBetween(cards, from, to, count = 3) {
  const words = cards
    .filter((card) => {
      const zipf = zipfOf(card);
      return zipf !== null && zipf >= from && zipf < to;
    })
    .sort((a, b) => zipfOf(a) - zipfOf(b))
    .map((card) => card.definition.lemma);
  if (words.length <= count) return words;
  return Array.from({ length: count }, (_, i) => words[Math.floor(((i + 0.5) * words.length) / count)]);
}

// For each level: how many cards it keeps, and examples of the words it adds to the cut
// (those between the previous level and this one).
export function levelSummaries(cards) {
  return LEVELS.map((level, i) => ({
    ...level,
    kept: cards.filter((card) => isKept(card, level.min)).length,
    newlySkipped: i === 0 ? [] : examplesBetween(cards, LEVELS[i - 1].min, level.min),
  }));
}

// "about 13 weeks", "9 days": how long the new cards take at Anki's default pace.
export function studyTime(cardCount, perDay = NEW_CARDS_PER_DAY) {
  const days = Math.ceil(cardCount / perDay);
  if (days === 0) return "no new cards";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 120) return `about ${Math.round(days / 7)} weeks`;
  return `about ${Math.round(days / 30)} months`;
}

// Preview order. Unknown frequencies go last when sorting by frequency.
export function sortCards(cards, order) {
  if (order === "recent") return cards;
  const sign = order === "rare" ? 1 : -1;
  return [...cards].sort((a, b) => {
    const za = zipfOf(a);
    const zb = zipfOf(b);
    if (za === null || zb === null) return (za === null) - (zb === null);
    return sign * (za - zb);
  });
}
