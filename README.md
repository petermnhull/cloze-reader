# Cloze Reader

**[Open Cloze Reader → petermnhull.github.io/cloze-reader](https://petermnhull.github.io/cloze-reader/)**

Turn the words you looked up while reading on a Kindle into fill-in-the-blank (cloze) cards, using
the real sentence from your book. Export to **Anki** or **Clozemaster**.

Everything runs in the browser: `vocab.db` is read locally with [sql.js](https://sql.js.org) and
never uploaded. The site is plain static files, hosted on GitHub Pages.

## Why I made this

I made this because I couldn't find a tool built for full immersion. Most vocabulary tools lean on
English translations, and few let you skip straight to *activating* the complex vocabulary you
actually meet in books. Cloze Reader keeps everything in French, with your own sentences and French
definitions as the clue, so words you once looked up become words you can recall and use.

## Privacy

- Your `vocab.db` is opened in the page with sql.js and never sent anywhere. There's no server,
  no account, no analytics and no cookies.
- The page's Content Security Policy only allows requests to the site itself and to cdnjs (for
  sql.js, which is pinned with a Subresource Integrity hash), so your file *can't* be sent anywhere,
  even by a bug.
- Definitions come from small dictionary files on the same site. Each file holds ~60 unrelated
  words, so the host's logs only show which files were fetched, as with any page load.

## Run locally

ES modules need to be served over HTTP, so opening `index.html` directly won't work:

```sh
npm run serve        # no-cache dev server on http://localhost:8000
npm test             # node --test, no dependencies to install
npm run check-db -- path/to/vocab.db fr   # run the card pipeline on a real file (needs sqlite3)
npm run e2e          # headless-Chrome test of the whole page on a synthetic vocab.db (needs dict/fr)
```

### French definitions

Definitions come from the French-language Wiktionary (Wiktionnaire), via the
[kaikki.org](https://kaikki.org/frwiktionary/Fran%C3%A7ais/) extract. The built files are
generated, not committed (`dict/` is gitignored):

```sh
curl -LO "https://kaikki.org/frwiktionary/Fran%C3%A7ais/kaikki.org-dictionary-Fran%C3%A7ais.jsonl.gz"   # ~400 MB
pip install wordfreq && npm run export-freq                                # word frequencies -> freq-fr.tsv
npm run build-dict -- kaikki.org-dictionary-Fran%C3%A7ais.jsonl.gz --freq freq-fr.tsv   # ~20 s, writes dict/fr/
```

`--freq` is optional. It stores each word's [wordfreq](https://github.com/rspeer/wordfreq) Zipf
frequency (3+ everyday, below 1 very rare), which powers the "Which words do you want to learn?" choice (Every word, Skip the rarest, Skip rare, Common only, Everyday only) and the
`freq::3+` / `freq::2-3` / `freq::1-2` / `freq::below-1` tags on Anki cards. Single words wordfreq
doesn't know count as 0; compounds and locutions (*sous-fifre*, *à tue-tête*) aren't in its list at
all, so they're `freq::unknown` and never filtered out.

The build keeps up to 6 senses per entry, labels them (Familier, Figuré…), puts dated senses
last, and turns inflected forms and spelling variants into links to their lemma. Output is split
into 32,768 hashed files (~230 MB on disk); each word in a library costs one small file, so a
library of 2,000 words downloads about 3 MB gzipped. The data is CC BY-SA 4.0, like Wiktionary: keep the attribution in the page
footer and share the built files under the same licence.

### Deploying

The `e2e` workflow builds the site exactly as it's served (static files plus `dict/`), tests it in
headless Chrome, and keeps it as an artifact. Its `deploy` job publishes to GitHub Pages only when
Pages is set to deploy from GitHub Actions and the repository variable `PAGES_DEPLOY` is `true`.

## Importing the files

**Anki** (`cloze-reader-anki.apkg`): double-click it, or File → Import. It brings its own
*Cloze Reader* note type, so there's no setup:

- **Front:** a chip with the word type and gender, the sentence(s) from your books with the word
  blanked, up to three French senses with the answer and its word family blanked too, synonyms
  that don't share the answer's root, and an *Indice* button that reveals the first letter.
- **Back:** exactly the same layout with every blank filled in place. Each blank already holds the
  hidden word (invisibly), so it's exactly as wide as the answer and nothing re-wraps or moves.
  New information appears only below a divider (Anki's `<hr id="answer">` convention): the word with
  its article (*la buvette*, *l’auvent*), any further senses, and the book.
- **Style:** the site's highlighter look, set in Atkinson Hyperlegible Next, readable on phone and
  desktop, light and dark mode. The blank and the word are highlighter swipes coloured by what the
  word is: masculine nouns blue, feminine nouns orange, verbs mint, adjectives lilac, everything else
  grey. The gender is always also written out, so colour is never the only cue, and text on a swipe
  is always dark ink (10:1 contrast or better).

Each note has a GUID based on the word, so importing a newer `vocab.db` updates existing notes
instead of duplicating them. Cards are tagged `cloze-reader` and `book::<title>`, and can go in one
subdeck per book.

**Clozemaster** (`cloze-reader-clozemaster.tsv`), **beta**: needs Clozemaster Pro. Open a custom collection →
options → *Add Sentences* → *Upload file*. Columns are Sentence, Translation, Cloze, Pronunciation,
Note. The Translation column holds the first French definition, which Clozemaster shows as the hint.

## How it works

- `src/kindle.js` reads lookups from `vocab.db` (`LOOKUPS` ⋈ `WORDS` ⋈ `BOOK_INFO`).
- `src/cloze.js` finds the looked-up word in its sentence. Kindle stores the exact form you tapped,
  so a whole-word match works almost every time; the stem is the fallback. Lookups are grouped by stem (up to 3 sentences per card). The text is trimmed to
  the sentence containing the word (including splitting em-dash dialogue), with a neighbouring
  sentence added when it's very short.
- `src/dictionary.js` looks up definitions, reading the sentence for context: first a hyphenated
  word the sentence uses (*à-pic*), then an expression it uses (*au bout du rouleau*, *ne pas
  quitter d’une semelle*: the build indexes ~82,000 Wiktionary locutions by their words), then the
  Kindle stem and the forms you looked up, following form-of/variant links to the lemma. A noun is
  swapped for the verb when the sentence clearly uses a verb (*le mur était criblé* → *cribler*,
  *ne te bile pas* → *se biler*).
- `src/anki.js` builds the `.apkg` (note type, templates, CSS, SQLite collection via sql.js) and
  `src/zip.js` packs it. `src/export.js` has the Clozemaster file and the masking of the answer in
  definitions.
- `src/app.js` is the page.

## Roadmap

- [x] Cloze cards from your own sentences, grouped by word, for Anki (`.apkg`) and Clozemaster (beta)
- [x] French definitions and synonyms from Wiktionnaire, with the answer masked on the front
- [x] Choose which words to learn by how common they are
- [ ] Pick the meaning that fits your sentence, and a short French paraphrase as the clue (LLM)
- [ ] Sentence audio (TTS)
- [ ] Other sources: Kobo, Kindle highlights, pasted text

## Feedback

Something not working, or an idea? [Open an issue](https://github.com/petermnhull/cloze-reader/issues/new/choose).
Please don't attach your `vocab.db` or paste long passages from books: the word and a short
description are enough.

## Credits and licences

- Code: [GNU AGPL-3.0](LICENSE). If you run a modified copy as a website, share its source too.
- French definitions and synonyms: [Wiktionnaire](https://fr.wiktionary.org), via
  [kaikki.org](https://kaikki.org/frwiktionary/) / wiktextract, licensed
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The generated `dict/` files are
  shared under the same licence.
- Word frequencies: [wordfreq](https://github.com/rspeer/wordfreq) by Robyn Speer, CC BY-SA 4.0.
- [sql.js](https://sql.js.org) (MIT), loaded from cdnjs.
- Typeface: [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next) by the
  Braille Institute, [SIL Open Font License](assets/fonts/OFL.txt). Bundled into the Anki deck so the cards
  use it too.

Not affiliated with Amazon, Anki or Clozemaster. Kindle is a trademark of Amazon.
