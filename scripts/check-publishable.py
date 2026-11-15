# Checks that the committed files are safe to publish. Exits non-zero if any check fails.
#
# Usage: python3 scripts/check-publishable.py [--books path/to/vocab.db ...] [--ref HEAD]
#
#   --books  Kindle vocab.db files whose sentences and book titles must not appear in the repo
#            (copyrighted text and a personal reading list). Only read locally.
#   --ref    the commit to check (default HEAD), so a snapshot is checked exactly as it'll be pushed.
#
# Words that must never appear (one per line) can be listed in .publish-blocklist, kept out of the
# repo (e.g. via .git/info/exclude), so the list itself is never published.

import argparse
import re
import sqlite3
import subprocess
import sys
import unicodedata

FORBIDDEN_FILES = re.compile(r"(\.db|\.sqlite|\.apkg|\.colpkg|\.jsonl(\.gz)?)$|(^|/)(dict|kaikki|_site)/")
SECRETS = re.compile(r"sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{32,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY")
BLOCKLIST = ".publish-blocklist"
SHINGLE = 32  # characters of book text that count as a copied passage
MIN_TITLE = 12  # shorter titles ("Le Pont") are too likely to appear by coincidence


def git(*args):
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def norm(text):
    text = unicodedata.normalize("NFC", text).replace("’", "'").replace(" ", " ").replace(" ", " ")
    return re.sub(r"\s+", " ", text).lower()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--books", nargs="*", default=[])
    parser.add_argument("--ref", default="HEAD")
    args = parser.parse_args()

    try:
        blocked = [w.strip() for w in open(BLOCKLIST, encoding="utf-8") if w.strip() and not w.startswith("#")]
    except FileNotFoundError:
        blocked = []
    unwanted = re.compile("|".join(map(re.escape, blocked)), re.IGNORECASE) if blocked else None

    paths = git("ls-tree", "-r", "--name-only", args.ref).splitlines()
    files = {path: git("show", f"{args.ref}:{path}") for path in paths}
    problems = []

    problems += [f"{path}: data file that shouldn't be published" for path in paths if FORBIDDEN_FILES.search(path)]
    for path, text in files.items():
        if SECRETS.search(text):
            problems.append(f"{path}: looks like it contains a secret")
        match = unwanted and unwanted.search(text)
        if match:
            problems.append(f"{path}: contains blocked word '{match.group(0)}'")

    if args.books:
        sentences, titles = set(), set()
        for db in args.books:
            connection = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            sentences |= {norm(u) for (u,) in connection.execute("SELECT usage FROM LOOKUPS") if u}
            titles |= {norm(t) for (t,) in connection.execute("SELECT title FROM BOOK_INFO") if t}
        for path, text in files.items():
            body = norm(text)
            shingles = {body[i : i + SHINGLE] for i in range(len(body) - SHINGLE)}
            copied = next((s for s in sentences if any(s[i : i + SHINGLE] in shingles for i in range(0, max(1, len(s) - SHINGLE), 4))), None)
            if copied:
                problems.append(f"{path}: contains text from a book: “{copied[:60]}…”")
            for title in titles:
                core = re.sub(r"\s*\([^)]*\)\s*$", "", title)
                if len(core) >= MIN_TITLE and core in body:
                    problems.append(f"{path}: mentions a book from your library: “{core}”")
        print(f"Checked against {len(sentences)} sentences and {len(titles)} titles from {len(args.books)} database(s).")

    print(f"Checked {len(files)} files at {args.ref} against {len(blocked)} blocked words.")
    for problem in problems:
        print(f"  ✖ {problem}")
    if problems:
        sys.exit(1)
    print("  ✔ nothing found that shouldn't be published")


if __name__ == "__main__":
    main()
