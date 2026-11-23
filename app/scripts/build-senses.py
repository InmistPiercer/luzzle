import csv, json, os, re, sys
from collections import defaultdict

csv.field_size_limit(10**9)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
PUB = os.path.join(ROOT, 'public')
RAW = os.path.join(ROOT, 'raw', 'ecdict.csv')


def tsv(name):
    with open(os.path.join(DATA, name), encoding='utf-8') as f:
        rows = [l.rstrip('\n').split('\t') for l in f if l.strip()]
    return [dict(zip(rows[0], r)) for r in rows[1:]]


def dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(json.dumps(obj, ensure_ascii=False, separators=(',', ':'), sort_keys=True))


def shards(dirname, table):
    out = defaultdict(dict)
    for k, v in table.items():
        out[k[0] if 'a' <= k[0] <= 'z' else '_'][k] = v
    for l, m in out.items():
        dump(os.path.join(PUB, dirname, f'{l}.json'), m)
    return sum(len(m) for m in out.values())


senses = defaultdict(list)
for r in tsv('senses.tsv'):
    senses[r['word']].append([r['sid'], r['pos'], int(r['core']), r['zh_short'], r['zh_def'], r['en_short'], r['en_def'], r['ex1'], r['ex2']])
print('senses', shards('sense', senses), 'words')

phrases = {}
for r in tsv('phrases.tsv'):
    phrases[r['phrase']] = [r['head'], r['head_sid'], r['zh_short'], r['zh_def'], r['en_short'], r['en_def'], r['ex1']]
print('phrases', shards('phrase', phrases))

ecd = {}
if os.path.exists(RAW):
    with open(RAW, encoding='utf-8') as f:
        rd = csv.reader(f)
        next(rd)
        for row in rd:
            w = row[0].lower()
            ex = dict(p.split(':', 1) for p in row[10].replace('\\n', '').split('/') if ':' in p)
            rank = int(row[9] or 0) or int(row[8] or 0)
            ecd[w] = (ex.get('0'), rank, row[2], row[4])

infl = {}
for r in tsv('inflections.tsv'):
    for f in r['form'].split('/'):
        f = f.strip()
        if not f or ' ' in f or "'" in f or f == r['word']:
            continue
        known = ecd.get(f)
        if known and known[0]:
            continue
        infl.setdefault(f, r['word'])
print('inflections', shards('infl', infl))

POS = {'n': 'n.', 'v': 'v.', 'a': 'adj.', 's': 'adj.', 'adj': 'adj.', 'r': 'adv.', 'adv': 'adv.'}
defs = {}
for w, (_, rank, d, _p) in ecd.items():
    if w in senses or not rank or not re.fullmatch(r'[a-z][a-z-]*', w) or not d:
        continue
    out = []
    for line in d.replace('\\n', '\n').split('\n'):
        m = re.match(r'^([a-z]+)\.?\s+(.*)$', line.strip())
        if not m or m.group(1) not in POS:
            continue
        p = POS[m.group(1)]
        if any(x[0] == p for x in out):
            continue
        out.append([p, m.group(2).split(';')[0].strip()])
        if len(out) >= 3:
            break
    if out:
        defs[w] = out
print('dictionary definitions', shards('def', defs))

spell = {r['uk']: r['us'] for r in tsv('spelling_uk_us.tsv')}
dump(os.path.join(ROOT, 'src', 'lang', 'ukus.json'), spell)
print('spelling', len(spell))

ety = {}
for line in open(os.path.join(ROOT, 'scripts', 'etym_special.tsv'), encoding='utf-8'):
    a = line.rstrip('\n').split('\t')
    if len(a) == 5 and a[0] and a[1] in ('x', 'o'):
        ety[a[0]] = [a[1], a[3], a[4]]
old = json.load(open(os.path.join(PUB, 'morph', 'etym.json'), encoding='utf-8'))
for w, v in old.items():
    if len(v) == 1 and w not in ety:
        ety[w] = v
dump(os.path.join(PUB, 'morph', 'etym.json'), ety)
print('etym', len(ety))

men = {}
table = json.load(open(os.path.join(ROOT, 'src', 'morph', 'table.json'), encoding='utf-8'))
by_main = {(m['t'], m['main']): m['id'] for m in table}
for line in open(os.path.join(ROOT, 'scripts', 'morphemes.tsv'), encoding='utf-8'):
    a = line.rstrip('\n').split('\t')
    if len(a) >= 6 and a[5] and (a[0], a[1]) in by_main:
        men[by_main[(a[0], a[1])]] = a[5]
dump(os.path.join(ROOT, 'src', 'morph', 'morph_en.json'), men)
print('morpheme english', len(men))
