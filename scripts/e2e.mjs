// End-to-end test of the built site in headless Chrome, with no npm dependencies: it drives Chrome
// over the DevTools Protocol using Node's built-in WebSocket.
//
// It serves the site the way GitHub Pages serves a project site (under /cloze-reader/), loads a
// synthetic vocab.db, waits for the Wiktionary definitions, clicks both download buttons and
// checks the downloaded files.
//
// Usage: npm run e2e   (needs dict/fr built, python3 and Chrome)
// Env:   SITE_DIR     directory to serve (default: the repo root)
//        CHROME_PATH  Chrome binary (default: macOS Google Chrome, else google-chrome on PATH)
//        E2E_HEADFUL=1 to watch the browser

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_LOOKUPS, makeFixtureDb } from "./make-fixture-db.mjs";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const SITE_DIR = resolve(process.env.SITE_DIR ?? ROOT);
const BASE_PATH = "/cloze-reader/";
const TIMEOUT_MS = 60_000;

const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");

const work = mkdtempSync(join(tmpdir(), "cloze-reader-e2e-"));
const children = [];
function cleanup() {
  for (const child of children) child.kill("SIGKILL");
  // Chrome may still be flushing its profile for a moment after the kill, so retry, and never
  // let a leftover temp folder fail a run that passed.
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (err) {
    console.warn(`[e2e] couldn't remove ${work}: ${err.code}`);
  }
}
process.on("exit", cleanup);

function log(message) {
  console.log(`[e2e] ${message}`);
}

function freePort() {
  return new Promise((done, fail) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
    server.on("error", fail);
  });
}

async function waitFor(what, check, timeout = TIMEOUT_MS) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

// Static server: python's http.server over a directory that holds the site at /cloze-reader/.
async function serveSite() {
  assert.ok(existsSync(join(SITE_DIR, "index.html")), `No index.html in ${SITE_DIR}`);
  assert.ok(existsSync(join(SITE_DIR, "dict/fr/meta.json")), `No dict/fr in ${SITE_DIR}; run npm run build-dict first`);
  const webroot = join(work, "www");
  mkdirSync(webroot);
  symlinkSync(SITE_DIR, join(webroot, "cloze-reader"));
  const port = await freePort();
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", webroot], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  children.push(server);
  const errors = [];
  server.stderr.on("data", (d) => {
    // Log 404s and errors; ignore the access log for successful requests.
    for (const line of d.toString().split("\n")) if (!line.includes("/favicon.ico") && /" [45]\d\d |Traceback|Error/.test(line)) errors.push(line);
  });
  const url = `http://127.0.0.1:${port}${BASE_PATH}`;
  await waitFor("the static server", () => fetch(url).then((r) => r.ok, () => false), 10_000);
  return { url, errors };
}

// Minimal DevTools Protocol client over one browser-level WebSocket (flattened sessions).
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id && this.pending.has(message.id)) {
        const { done, fail, method } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) fail(new Error(`${method}: ${message.error.message}`));
        else done(message.result);
      } else if (message.method) {
        for (const listener of this.listeners) listener(message);
      }
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((done, fail) => {
      ws.addEventListener("open", done, { once: true });
      ws.addEventListener("error", () => fail(new Error(`Couldn't connect to ${url}`)), { once: true });
    });
    return new Cdp(ws);
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((done, fail) => this.pending.set(id, { done, fail, method }));
  }
  on(listener) {
    this.listeners.push(listener);
  }
}

async function launchChrome() {
  const args = [
    process.env.E2E_HEADFUL ? "" : "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${join(work, "profile")}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    // GitHub's Ubuntu 24.04 runners restrict unprivileged user namespaces, which Chrome's sandbox needs.
    process.env.CI ? "--no-sandbox" : "",
    "about:blank",
  ].filter(Boolean);
  const chrome = spawn(CHROME, args, { stdio: ["ignore", "ignore", "pipe"] });
  children.push(chrome);
  const wsUrl = await new Promise((done, fail) => {
    let output = "";
    chrome.stderr.on("data", (d) => {
      output += d;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) done(match[1]);
    });
    chrome.on("error", (err) => fail(new Error(`Couldn't start Chrome (${CHROME}): ${err.message}`)));
    chrome.on("exit", (code) => fail(new Error(`Chrome exited (${code}):\n${output}`)));
  });
  return Cdp.connect(wsUrl);
}

async function main() {
  const dbPath = makeFixtureDb(join(work, "vocab.db"));
  const downloads = join(work, "downloads");
  const { url, errors: serverErrors } = await serveSite();
  log(`serving ${SITE_DIR} at ${url}`);

  const cdp = await launchChrome();
  const { targetInfos } = await cdp.send("Target.getTargets");
  const page = targetInfos.find((t) => t.type === "page");
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);

  const pageErrors = [];
  const completed = new Map(); // guid -> state
  const suggested = new Map(); // guid -> filename
  cdp.on((message) => {
    if (message.method === "Runtime.exceptionThrown") pageErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      pageErrors.push(message.params.args.map((a) => a.value ?? a.description).join(" "));
    }
    if (message.method === "Browser.downloadWillBegin") suggested.set(message.params.guid, message.params.suggestedFilename);
    if (message.method === "Browser.downloadProgress" && message.params.state !== "inProgress") {
      completed.set(message.params.guid, message.params.state);
    }
  });
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true });
  await send("Runtime.enable");
  await send("Page.enable");

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (exceptionDetails) throw new Error(`${expression}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result.value;
  };

  await send("Page.navigate", { url });
  await waitFor("the page to load", () => evaluate("document.readyState === 'complete' && !!document.getElementById('file')"));
  log("page loaded");

  // Same as choosing the file in the picker: sets the input's files and fires "change".
  const { root } = await send("DOM.getDocument");
  const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: "#file" });
  await send("DOM.setFileInputFiles", { nodeId, files: [dbPath] });

  await waitFor("the cards to show", () => evaluate("!document.getElementById('setup').hidden"));
  const errorText = await evaluate("document.getElementById('error').hidden ? '' : document.getElementById('error').textContent");
  assert.equal(errorText, "", "the page showed an error");

  // Definitions are fetched from dict/fr; the buttons stay disabled until the lookups finish.
  await waitFor("the definitions", () =>
    evaluate(`!document.getElementById('export-anki').disabled && !/looking up/.test(document.getElementById('stats').textContent)`),
  );
  const preview = await evaluate(`[...document.querySelectorAll('#cards li')].map((li) => ({
    marks: [...li.querySelectorAll('mark')].map((m) => m.textContent),
    meta: li.querySelector('.meta')?.textContent ?? '',
    definition: li.querySelector('.definition')?.textContent ?? '',
  }))`);
  const stats = await evaluate("document.getElementById('stats').textContent");
  log(`stats: ${stats}`);

  const stems = new Set(FIXTURE_LOOKUPS.map(([, stem]) => stem));
  assert.equal(preview.length, stems.size, `expected ${stems.size} cards in the preview`);
  assert.match(stats, new RegExp(`^${stems.size} cards selected`));
  for (const card of preview) {
    assert.ok(card.definition && card.definition !== "No definition found" && card.definition !== "…", `no definition for ${card.meta}`);
  }
  const byLemma = (lemma) => preview.find((c) => c.meta.startsWith(`${lemma} ·`));
  assert.match(byLemma("buvette")?.definition ?? "", /Nom commun/);
  assert.match(byLemma("auvent")?.definition ?? "", /toit/i);
  const defier = byLemma("défier");
  assert.ok(defier, "défiait/défiaient should be one card under défier");
  assert.deepEqual(defier.marks.sort(), ["défiaient", "défiait"]);
  assert.match(defier.definition, /Verbe/);
  log(`preview: ${preview.length} cards, all with definitions`);

  // Downloads, one at a time so each file can be matched to its button.
  const files = {};
  for (const button of ["export-clozemaster", "export-anki"]) {
    const before = new Set(completed.keys());
    await evaluate(`document.getElementById('${button}').click()`);
    const guid = await waitFor(`the ${button} download`, () => [...completed.keys()].find((g) => !before.has(g)), 15_000);
    assert.equal(completed.get(guid), "completed", `${button} download ${completed.get(guid)}`);
    files[button] = join(downloads, suggested.get(guid));
    log(`${button}: downloaded ${suggested.get(guid)} (${statSync(files[button]).size} bytes)`);
  }
  log(`download folder: ${readdirSync(downloads).join(", ")}`);

  // Anki: only check the name and that it isn't empty; the .apkg format has its own unit tests.
  assert.match(files["export-anki"], /[/\\]cloze-reader-anki\.[a-z]+$/);
  assert.ok(statSync(files["export-anki"]).size > 0, "Anki download is empty");

  // Clozemaster TSV: Sentence, Translation (first French sense), Cloze, Pronunciation, Note (book).
  assert.match(files["export-clozemaster"], /[/\\]cloze-reader-clozemaster\.tsv$/);
  const rows = readFileSync(files["export-clozemaster"], "utf8").trimEnd().split("\n").map((line) => line.split("\t"));
  assert.equal(rows.length, FIXTURE_LOOKUPS.length, "one Clozemaster row per sentence");
  for (const [sentence, hint, cloze, pronunciation, note] of rows) {
    assert.ok(sentence.includes(cloze), `cloze "${cloze}" not in "${sentence}"`);
    assert.ok(hint.length > 0, `no hint for ${cloze}`);
    assert.equal(pronunciation, "");
    assert.ok(["Un été au village", "Carnets de pluie"].includes(note), `unexpected note "${note}"`);
  }
  for (const [form, , , usage] of FIXTURE_LOOKUPS) {
    assert.ok(rows.some(([sentence, , cloze]) => cloze === form && sentence === usage), `no row for ${form}`);
  }
  const buvette = rows.find(([, , cloze]) => cloze === "buvette");
  assert.match(buvette[1], /boit/, "buvette hint should be its first sense");
  log(`clozemaster: ${rows.length} rows OK`);

  assert.deepEqual(pageErrors, [], "errors in the page console");
  assert.deepEqual(serverErrors, [], "failed requests to the static server");
  log("PASS");
}

try {
  await main();
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
