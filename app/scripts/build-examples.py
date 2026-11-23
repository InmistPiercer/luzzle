import bz2
import csv
import json
import os
import re
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'raw')
OUT = os.path.join(ROOT, 'public', 'ex')
PER_WORD = 2


def lexicon():
    lemma_of = {}
    keep = set()
    with open(os.path.join(RAW, 'ecdict.csv'), encoding='utf-8') as f:
        r = csv.reader(f)
        next(r)
        for row in r:
            w = row[0]
            if not re.fullmatch(r'[a-z]+', w) or not row[3]:
                continue
            common = (row[8] and row[8] != '0') or (row[9] and row[9] != '0') or row[7]
            if common:
                keep.add(w)
            lemma_of.setdefault(w, w)
            for part in (row[10] or '').split('/'):
                if ':' not in part:
                    continue
                k, v = part.split(':', 1)
                if k in ('p', 'd', 'i', '3', 's') and re.fullmatch(r'[a-z]+', v):
                    lemma_of.setdefault(v, w)
    return lemma_of, keep


def main():
    lemma_of, keep = lexicon()
    picks = defaultdict(list)
    with bz2.open(os.path.join(RAW, 'eng_sentences.tsv.bz2'), 'rt', encoding='utf-8') as f:
        for line in f:
            parts = line.rstrip('\n').split('\t')
            if len(parts) < 3:
                continue
            s = parts[2].strip()
            if not re.fullmatch(r"[A-Za-z0-9 ,.;:'’?!-]+", s) or not s[0].isupper():
                continue
            toks = re.findall(r"[A-Za-z]+", s)
            if not 7 <= len(toks) <= 18 or any(t[0].isupper() for t in toks[1:]):
                continue
            seen = set()
            for t in toks:
                lw = lemma_of.get(t.lower())
                if not lw or lw not in keep or lw in seen or len(lw) < 4:
                    continue
                seen.add(lw)
                if len(picks[lw]) < PER_WORD:
                    picks[lw].append(s)
    shards = defaultdict(dict)
    for w, ss in picks.items():
        shards[w[0]][w] = ss
    os.makedirs(OUT, exist_ok=True)
    size = 0
    for k, v in shards.items():
        data = json.dumps(v, ensure_ascii=False, separators=(',', ':'))
        size += len(data.encode())
        open(os.path.join(OUT, f'{k}.json'), 'w', encoding='utf-8').write(data)
    print('words', len(picks), 'MB', round(size / 1048576, 1))


main()
