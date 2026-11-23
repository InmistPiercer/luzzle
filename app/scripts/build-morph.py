import csv
import json
import os
import re
import sys
from collections import defaultdict

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'raw')
OUT = os.path.join(ROOT, 'public', 'morph')
TABLE_OUT = os.path.join(ROOT, 'src', 'morph', 'table.json')


def load_base_lib():
    src = open(os.path.join(ROOT, 'src', 'morph', 'data.ts'), encoding='utf-8').read()
    body = src[src.index('const BASE_LIB: Morpheme[] = [') :]
    body = body[body.index('= [') + 2 : body.index('\n]\n') + 2]
    return json.loads(re.sub(r',\s*]$', ']', body.strip()))


def load_table(base):
    lib = list(base)
    extra = []
    for line in open(os.path.join(ROOT, 'scripts', 'morphemes.tsv'), encoding='utf-8'):
        line = line.rstrip('\n')
        if not line:
            continue
        t, main, zh, vs, *rest = line.split('\t')
        vars_ = [v for v in vs.split(',') if v]
        hist = [v for v in (rest[0] if rest else '').split(',') if v]
        same = [m for m in lib if m['t'] == t and (m['main'] == main or set(vars_) & set(m['vars']))]
        if same:
            for v in vars_:
                if v not in same[0]['vars']:
                    same[0]['vars'].append(v)
            continue
        key = re.sub(r'[^a-z]', '', main)
        mid = {'pre': 'p_', 'suf': 's_', 'root': 'r_'}[t] + key
        m = {'id': mid, 't': t, 'main': main, 'zh': zh, 'vars': vars_, **({'hist': hist} if hist else {})}
        lib.append(m)
        extra.append(m)
    return lib, extra


infl = set()


def etym_table():
    out = {}
    for line in open(os.path.join(ROOT, 'scripts', 'etym_special.tsv'), encoding='utf-8'):
        a = line.rstrip('\n').split('\t')
        if len(a) == 5 and a[0]:
            out[a[0]] = {'cls': a[1], 'split': a[2], 'zh': a[3], 'en': a[4]}
    return out


def ecdict():
    out = {}
    pos = {}
    with open(os.path.join(RAW, 'ecdict.csv'), encoding='utf-8') as f:
        r = csv.reader(f)
        next(r)
        for row in r:
            w = row[0]
            if not re.fullmatch(r'[a-z]+', w) or not row[3]:
                continue
            lines = [l for l in row[3].split('\\n') if l and not l.startswith('[')]
            if not lines:
                continue
            m = re.match(r'^((?:[a-z]+\.\s*(?:[&/,]\s*)?)+)\s*(.*)$', lines[0])
            text = m.group(2) if m else lines[0]
            zh = re.split(r'[,，;；]', re.sub(r'\[[^\]]*\]|[（(][^）)]*[）)]', '', text))[0].strip()
            freq = int(row[9] or 0) or int(row[8] or 0) or 999999
            if re.search(r'(^|/)0:[a-z]', row[10] or '') and re.search(r'(^|/)1:[^/]*[pdi3]', row[10] or ''):
                infl.add(w)
            out[w] = (zh, freq)
            pos[w] = [re.match(r'^([a-z]+)\.', l).group(1) for l in lines if re.match(r'^([a-z]+)\.', l)]
    return out, pos


def morpholex():
    wb = openpyxl.load_workbook(os.path.join(RAW, 'MorphoLEX_en.xlsx'), read_only=True)
    out = {}
    for sn in wb.sheetnames[1:]:
        it = wb[sn].iter_rows(values_only=True)
        h = next(it)
        if 'Word' not in h or 'MorphoLexSegm' not in h:
            continue
        wi, si = h.index('Word'), h.index('MorphoLexSegm')
        for r in it:
            w, s = r[wi], r[si]
            if not w or not s:
                continue
            toks = []
            for m in re.finditer(r'<([a-z]+)<|>([a-z]+)>|\(([a-z]+)\)', str(s)):
                if m.group(1):
                    toks.append((m.group(1), 'pre'))
                elif m.group(2):
                    toks.append((m.group(2), 'suf'))
                else:
                    toks.append((m.group(3), 'root'))
            out[str(w).lower()] = toks
    return out


def morphynet():
    out = {}
    for line in open(os.path.join(RAW, 'eng.derivational.v1.tsv'), encoding='utf-8'):
        a = line.rstrip('\n').split('\t')
        if len(a) < 6:
            continue
        base, derived, _, _, affix, kind = a[:6]
        if re.fullmatch(r'[a-z]+', derived) and re.fullmatch(r'[a-z]+', base) and kind in ('prefix', 'suffix'):
            out.setdefault(derived, (base, affix, 'pre' if kind == 'prefix' else 'suf'))
    return out


def main():
    base = load_base_lib()
    lib, extra = load_table(base)
    by_var = defaultdict(list)
    for m in lib:
        for v in set(m['vars'] + [re.sub(r'[^a-z]', '', m['main'])]):
            by_var[(m['t'], v)].append(m)
    dic, dic_pos = ecdict()
    ml = morpholex()
    mn = morphynet()

    def tokens(w, depth=0):
        if w in ml and len(ml[w]) > 1:
            return list(ml[w])
        if w in mn and depth < 4:
            b, af, t = mn[w]
            inner = tokens(b, depth + 1) or [(b, 'root')]
            return [(af, t)] + inner if t == 'pre' else inner + [(af, t)]
        if w in ml:
            return list(ml[w])
        return None

    roots = {v: ms[0]['id'] for (t, v), ms in by_var.items() if t == 'root' and len(v) >= 3}
    pres = {v: ms[0]['id'] for (t, v), ms in by_var.items() if t == 'pre'}
    sufs = {v: ms[0]['id'] for (t, v), ms in by_var.items() if t == 'suf'}

    def stem_split(stem, alone=False):
        for p in [''] + sorted(pres, key=len, reverse=True):
            if not stem.startswith(p):
                continue
            rest = stem[len(p):]
            for x in [''] + (sorted(sufs, key=len, reverse=True) if alone else []):
                if (not p and not x) or not rest.endswith(x):
                    continue
                core = rest[: len(rest) - len(x)] if x else rest
                if core in roots:
                    out = [(p, 'pre', resolve(p, 'pre', core))] if p else []
                    out.append((core, 'root', roots[core]))
                    if x:
                        out.append((x, 'suf', sufs[x]))
                    return out
        return None

    sister_vars = {'able': ['ible'], 'ence': ['ance', 'ancy'], 'er': ['or']}

    def spellings(canon, t, mid):
        out = {canon}
        if mid:
            m = next(x for x in lib if x['id'] == mid)
            out.update(m['vars'])
            out.update(sister_vars.get(mid, []))
        for s in list(out):
            if s.endswith('e') and len(s) > 2:
                out.add(s[:-1])
            if s.endswith('y'):
                out.add(s[:-1] + 'i')
            if s.endswith('le'):
                out.add(s[:-2] + 'il')
            if t != 'suf' and re.search(r'[bcdfgklmnprstvz]$', s):
                out.add(s + s[-1])
        return sorted(out, key=len, reverse=True)

    def resolve(canon, t, nxt=None):
        if t == 'pre' and canon in ('in', 'im', 'il', 'ir'):
            return 'in_neg' if 'a' in dic_pos.get(nxt or '', []) else 'in_into'
        hit = by_var.get((t, canon)) or (by_var.get(('root', canon)) if t == 'pre' else None)
        return hit[0]['id'] if hit else None

    def align(w, parts, loose=False):
        n = len(parts)

        def go(i, pos):
            if i == n:
                return [] if pos == len(w) else None
            canon, t, mid = parts[i]
            cands = spellings(canon, t, mid)
            if loose and t in ('root', 'base'):
                cands = [w[pos:k] for k in range(len(w), pos + 1, -1) if w[pos:k][:2] == canon[:2]]
            for s in cands:
                if s and w.startswith(s, pos):
                    rest = go(i + 1, pos + len(s))
                    if rest is not None:
                        return [s] + rest
            return None

        return go(0, 0)

    segs = {}
    unknown = defaultdict(int)
    for w in dic:
        toks = tokens(w)
        if not toks:
            continue
        parts = []
        ok = True
        for ti, (canon, t) in enumerate(toks):
            if t == 'root':
                mid = resolve(canon, 'root')
                if mid:
                    parts.append((canon, 'root', mid))
                    continue
                sp = stem_split(canon, len(toks) == 1)
                if sp:
                    parts.extend(sp)
                else:
                    parts.append((canon, 'base', None))
            else:
                mid = resolve(canon, t, toks[ti + 1][0] if ti + 1 < len(toks) else None)
                if not mid:
                    unknown[(t, canon)] += 1
                    ok = False
                    break
                parts.append((canon, t, mid))
        if not ok or len(parts) < 2:
            continue
        sp = align(w, parts) or align(w, parts, loose=True)
        if not sp:
            continue
        seg = [[s, 'base', c] if t == 'base' else [s, mid] for s, (c, t, mid) in zip(sp, parts)]
        for part in seg:
            if len(part) == 2:
                if part[1] == 'able' and part[0].startswith('ibl'):
                    part[1] = 'ible'
                elif part[1] == 'ence' and part[0].startswith('anc'):
                    part[1] = 'ance'
                elif part[1] == 'er' and part[0] == 'or':
                    part[1] = 'or'
        if seg[0][-1] in ('in_neg', 'in_into'):
            adj = seg[0][0] in ('il', 'ir') or re.search(r'[不无非未难缺失违]', dic[w][0]) is not None
            seg[0][1] = 'in_neg' if adj else 'in_into'
        segs[w] = seg

    lib_t = {m['id']: m['t'] for m in lib}
    lib_hist = {m['id']: m.get('hist', []) for m in lib}
    core = lambda x: len(x) == 3 or lib_t.get(x[1]) == 'root'
    ety = etym_table()

    def forced(w, spec):
        out = []
        for piece in spec.split('+'):
            s_, _, mid = piece.partition(':')
            mid = mid or next((by_var[(t, s_)][0]['id'] for t in ('root', 'pre', 'suf') if (t, s_) in by_var and (t != 'pre' or not out)), None)
            if not mid:
                raise SystemExit(f'etym_special: cannot resolve {piece} in {w}')
            out.append([s_, mid])
        if ''.join(x[0] for x in out) != w:
            raise SystemExit(f'etym_special: split {spec} does not spell {w}')
        return out

    opaque = {w for w, e in ety.items() if e['cls'] == 'o'}
    for w, e in ety.items():
        if e['cls'] == 'x' and e['split']:
            segs[w] = forced(w, e['split'])
    for w in opaque:
        segs.pop(w, None)
    for w, p in list(segs.items()):
        for k in range(len(p), 1, -1):
            head = ''.join(x[0] for x in p[:k])
            if head in opaque:
                segs[w] = [[head, 'base', head]] + p[k:]
                break
        if len(segs[w]) < 2:
            segs.pop(w)

    def hist_part(x):
        return len(x) == 2 and any(x[0] == h or x[0] == h[:-1] or x[0].startswith(h) for h in lib_hist.get(x[1], []))

    def extended(w, p):
        e = ety.get(w)
        return (e and e['cls'] == 'x') or any(hist_part(x) for x in p)

    def word_of(x):
        for c in (x, x + 'e', x[:-1] if len(x) > 3 and x[-1] == x[-2] else None, x[:-1] + 'y' if x.endswith('i') else None):
            if c and c in dic and dic[c][1] < 999999:
                return c
        return None

    groups = {}
    for w, p in segs.items():
        ri = next((i for i, x in enumerate(p) if core(x)), None)
        if ri is None or len(p) < 3:
            continue
        best = None
        for a in (0,):
            for b in range(ri + 1, len(p) + 1):
                if b - a < 2 or (a == 0 and b == len(p)):
                    continue
                g = word_of(''.join(x[0] for x in p[a:b]))
                if g and g != w and (best is None or b - a < best[1] - best[0]):
                    best = (a, b, g)
        if best:
            groups[w] = list(best)

    os.makedirs(OUT, exist_ok=True)
    shards = defaultdict(dict)
    for w, p in segs.items():
        shards[w[0]][w] = [p, groups[w]] if w in groups else p
    size = 0
    for k, v in shards.items():
        data = json.dumps(v, ensure_ascii=False, separators=(',', ':'))
        size += len(data.encode())
        open(os.path.join(OUT, f'{k}.json'), 'w', encoding='utf-8').write(data)
    index = defaultdict(list)
    for w, p in segs.items():
        for part in p:
            if len(part) == 2:
                index[part[1]].append(w)
    idx = {}
    for mid, ws in index.items():
        ws = sorted((w for w in ws if w not in infl and dic[w][0] and not re.search(r'[A-Za-z<>=]', dic[w][0])), key=lambda x: dic[x][1])
        top = ws[:40]
        more = [w for w in ws[40:] if dic[w][1] < 999999 and not extended(w, segs[w])][:10]
        idx[mid] = [[w, dic[w][0]] for w in top + more]
    open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8').write(json.dumps(idx, ensure_ascii=False, separators=(',', ':')))
    etym = {w: [e['cls'], e['zh'], e['en']] for w, e in ety.items() if e['cls'] in ('x', 'o')}
    for w, p in segs.items():
        if w not in etym and any(hist_part(x) for x in p):
            etym[w] = ['x']
    open(os.path.join(OUT, 'etym.json'), 'w', encoding='utf-8').write(json.dumps(etym, ensure_ascii=False, separators=(',', ':')))
    json.dump(extra, open(TABLE_OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print('segmented', len(segs), 'MB', round(size / 1048576, 1), 'extra morphemes', len(extra))
    print('top unknown affixes', sorted(unknown.items(), key=lambda x: -x[1])[:40])
    for w in sys.argv[1:]:
        print(w, segs.get(w), groups.get(w), etym.get(w))


main()
