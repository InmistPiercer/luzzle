import { useDataSeq } from '../core/shards'
import type { PosTag } from '../core/types'
import { DEMO_ENTRIES, SENSE_BANK } from '../content/demo'
import { dictHas, dictLemma, dictPeek, onDictChange, participialFromDict, primaryPos, type Participial } from './lexdict'
import { FUNC_SET, IRREG, LEX, LIGHT_VERBS, PARTICIPIAL_LEX, PHRASE_SKIP, type LexRow } from './lexicon'
import { inflLemma, sensesOfWord, ukToUs } from './senses'

const BASE_LEMMAS = ['grant', 'shift', 'form', 'reward', 'sustain', 'appear', 'require', 'remain', 'chase', 'hook', 'finish', 'publish', 'relax', 'tempt', 'isolate']

const lemmaSet = new Set<string>()
const cache = new Map<string, string>()

export const rebuildLemmaSet = (extra: Iterable<string> = []) => {
  lemmaSet.clear()
  cache.clear()
  Object.values(LEX).forEach((v) => lemmaSet.add(v[0]))
  Object.values(DEMO_ENTRIES).forEach((d) => d.pos !== 'phrase' && lemmaSet.add(d.lemma))
  Object.values(SENSE_BANK)
    .flat()
    .forEach((x) => lemmaSet.add(x.lemma))
  BASE_LEMMAS.forEach((w) => lemmaSet.add(w))
  for (const w of extra) lemmaSet.add(w)
}

rebuildLemmaSet()

onDictChange(() => cache.clear())
useDataSeq.subscribe(() => cache.clear())

export const isKnownLemma = (w: string) => lemmaSet.has(w)

export function lemmatize(raw: string): string {
  const w = String(raw).toLowerCase().replace(/[’']s$/, '')
  const hit = cache.get(w)
  if (hit) return hit
  let r = w
  if (PARTICIPIAL_LEX[w]) r = PARTICIPIAL_LEX[w].base
  else if (IRREG[w]) r = IRREG[w]
  else if (LEX[w]) r = LEX[w][0]
  else if (FUNC_SET.has(w) || lemmaSet.has(w)) r = w
  else if (inflLemma(w)) r = inflLemma(w) as string
  else if (dictHas(w)) r = dictLemma(w) || w
  else {
    const c: string[] = []
    if (/ies$/.test(w)) c.push(w.slice(0, -3) + 'y')
    if (/ied$/.test(w)) c.push(w.slice(0, -3) + 'y')
    if (/(s|x|z|ch|sh)es$/.test(w)) c.push(w.slice(0, -2))
    if (/[^s]s$/.test(w)) c.push(w.slice(0, -1))
    if (/ed$/.test(w)) {
      const b = w.slice(0, -2)
      c.push(b, b + 'e')
      if (/(.)\1$/.test(b)) c.push(b.slice(0, -1))
    }
    if (/ing$/.test(w)) {
      const b = w.slice(0, -3)
      c.push(b, b + 'e')
      if (/(.)\1$/.test(b)) c.push(b.slice(0, -1))
    }
    r = c.find((x) => x.length >= 3 && lemmaSet.has(x)) || c.find((x) => x.length >= 3 && sensesOfWord(x).length > 0) || c.find((x) => x.length >= 3 && dictHas(x)) || w
  }
  r = ukToUs(r) || r
  cache.set(w, r)
  return r
}

export const participialOf = (w: string): Participial | null => {
  const k = w.toLowerCase()
  const p = PARTICIPIAL_LEX[k]
  return p ? { base: p.base, pos: p.pos } : participialFromDict(k)
}

const DEGREE = new Set(['very', 'so', 'too', 'more', 'most', 'less', 'least', 'quite', 'rather', 'highly', 'deeply', 'extremely', 'really', 'fairly', 'increasingly', 'particularly', 'incredibly', 'truly', 'pretty'])
const DET = new Set(['a', 'an', 'the', 'this', 'that', 'these', 'those', 'his', 'her', 'its', 'their', 'our', 'my', 'your', 'some', 'any', 'no', 'every', 'each'])
const LINK = new Set(['seem', 'seems', 'seemed', 'look', 'looks', 'looked', 'feel', 'feels', 'felt', 'become', 'becomes', 'became', 'remain', 'remains', 'remained', 'sound', 'sounds', 'sounded', 'appear', 'appears', 'appeared'])
const BE = new Set(['be', 'is', 'are', 'was', 'were', 'been', 'being', 'am'])
const HAVE = new Set(['have', 'has', 'had', 'having'])

export function participleAsAdj(words: string[], i: number): boolean {
  const prev = words[i - 1]?.toLowerCase() || ''
  const next = words[i + 1]?.toLowerCase() || ''
  if (next === 'by') return false
  if (DEGREE.has(prev) || DET.has(prev) || LINK.has(prev)) return true
  if (BE.has(prev)) return ['to', 'that', 'about'].includes(next)
  if (HAVE.has(prev)) return false
  return !!next && !FUNC_SET.has(next) && posGuess(next) === 'n.'
}

export function guessPosBySuffix(k: string): PosTag {
  if (PARTICIPIAL_LEX[k]) return PARTICIPIAL_LEX[k].pos
  if (FUNC_SET.has(k)) return 'func.'
  if (/(tion|sion|ness|ment|ity|ance|ence|ship|ism|ist)s?$/.test(k)) return 'n.'
  if (/ly$/.test(k) && !/(friendly|lovely|lonely|lively|silly|ugly|likely|costly|deadly|timely)$/.test(k)) return 'adv.'
  if (/(ous|ive|ful|less|able|ible|ic|ish|al|ent|ant)$/.test(k)) return 'adj.'
  return 'v.'
}

export function posGuess(w: string): PosTag {
  const k = w.toLowerCase()
  if (LEX[k]) return LEX[k][1]
  if (FUNC_SET.has(k)) return 'func.'
  const sr = sensesOfWord(k)[0]?.[1]
  if (sr && /^(v|n|adj|adv|func)\.$/.test(sr)) return sr as PosTag
  return primaryPos(dictPeek(k), guessPosBySuffix(k)) || guessPosBySuffix(k)
}

let lexByLemma: Map<string, LexRow> | null = null

export const lexOf = (surface: string): LexRow | null => {
  if (LEX[surface]) return LEX[surface]
  if (!lexByLemma) lexByLemma = new Map(Object.values(LEX).map((v) => [v[0], v]))
  return lexByLemma.get(lemmatize(surface)) || null
}

export function phraseHead(members: string[] | undefined): string {
  const lems = (members || []).map((m) => lemmatize(String(m).toLowerCase())).filter((m) => m && !FUNC_SET.has(m) && !PHRASE_SKIP.has(m))
  if (!lems.length) return lemmatize(String(members?.[0] || '').toLowerCase())
  const rank = (m: string) => {
    if (LIGHT_VERBS.has(m)) return 4
    const p = LEX[m]?.[1] || guessPosBySuffix(m)
    return ({ 'n.': 0, 'adj.': 0, 'v.': 1, 'adv.': 2 } as Record<string, number>)[p] ?? 3
  }
  return [...lems].sort((a, b) => rank(a) - rank(b) || lems.indexOf(a) - lems.indexOf(b))[0]
}
