# Exports word frequencies on the Zipf scale (log10 of uses per billion words: 7 = "de",
# 3 = everyday, 1 = rare) from wordfreq, for scripts/build-dictionary.mjs --freq.
# Usage: python3 scripts/export-wordfreq.py [lang] > freq-fr.tsv   (needs `pip install wordfreq`)
# wordfreq's data is CC BY-SA 4.0, like the Wiktionary definitions it is combined with.
import math
import sys

from wordfreq import get_frequency_dict

lang = sys.argv[1] if len(sys.argv) > 1 else "fr"
for word, frequency in get_frequency_dict(lang, wordlist="large").items():
    print(f"{word}\t{math.log10(frequency) + 9:.2f}")
