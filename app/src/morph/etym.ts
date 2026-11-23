import { useEffect } from 'react'
import { useApp } from '../app/store'
import { useDataSeq } from '../core/shards'
import type { AppState } from '../core/types'
import { dictPeek, ensureDict, firstSense, sensesOf } from '../lang/lexdict'
import { EN_GLOSS } from '../lang/lexicon'
import { ensureSenses, sensesOfWord } from '../lang/senses'
import MORPH_EN from './morph_en.json'
import { bare, morphemeOf, senseIdx, sensesOfMorph } from './senses'
import { EXACT, type Part } from './data'
import type { MorphState } from './engine'
import { ensureMorph, ensureMorphIndex, etymOf, localSeg } from './local'

const ZH_RE = /[\u4e00-\u9fff]/
const gloss = (w: string, preferVerb = false) => {
  const sr = preferVerb ? sensesOfWord(w).find((r) => r[1] === 'v.') || sensesOfWord(w)[0] : sensesOfWord(w)[0]
  if (sr?.[3]) return sr[3]
  const ss = sensesOf(dictPeek(w))
  const hit = (preferVerb ? ss.find((x) => x.pos === 'v.') : undefined) || ss[0]
  return bare(firstSense(hit?.text || '')).replace(/[A-Za-z]+\.?/g, '').trim()
}

const EN_MORPH: Record<string, string> = {
  in_neg: 'not',
  in_into: 'inward',
  un: 'not',
  dis: 'not / apart',
  re: 'again / back',
  pre: 'before',
  de: 'down / away',
  ex: 'out',
  con: 'together',
  sub: 'under',
  ad: 'toward',
  trans: 'across',
  inter: 'between',
  pro: 'forward',
  anti: 'against',
  mis: 'wrongly',
  over: 'over',
  under: 'under',
  non: 'not',
  a: 'without / not',
  ab: 'away from',
  ante: 'before',
  auto: 'self',
  bene: 'good / well',
  bi: 'two',
  circum: 'around',
  contra: 'against',
  dia: 'through',
  en: 'make / put in',
  epi: 'upon',
  eu: 'good',
  extra: 'outside / beyond',
  fore: 'before / front',
  hetero: 'different',
  homo: 'same',
  hyper: 'excessive',
  hypo: 'under',
  infra: 'below',
  intra: 'within',
  macro: 'large',
  mal: 'bad',
  micro: 'small',
  mid: 'middle',
  mono: 'one',
  multi: 'many',
  neo: 'new',
  ob: 'against',
  omni: 'all',
  out: 'beyond / out',
  pan: 'all',
  para: 'beside',
  per: 'through',
  peri: 'around',
  poly: 'many',
  post: 'after',
  pseudo: 'false',
  retro: 'backward',
  se: 'apart',
  semi: 'half',
  super: 'above / beyond',
  syn: 'together',
  tele: 'far',
  tri: 'three',
  ultra: 'beyond',
  uni: 'one',
  up: 'up',
  with: 'against / back',
  ion: 'act / state',
  tion: 'act of',
  sion: 'act of',
  ation: 'act / process',
  ent: 'doing / -ing',
  ant: 'doing / -ing',
  ence: 'state / quality',
  ance: 'state / quality',
  ate: 'make / having',
  al: 'relating to',
  able: 'able to be',
  ible: 'able to be',
  ment: 'state / result',
  ness: 'state of',
  ity: 'quality of',
  er: 'one who',
  or: 'one who',
  ist: 'one who',
  ism: 'belief / practice',
  ly: 'in a way',
  ive: 'tending to',
  ous: 'full of',
  ful: 'full of',
  less: 'without',
  ize: 'make',
  ise: 'make',
  fy: 'make',
  ship: 'state / role',
  hood: 'state / group',
  dom: 'realm / state',
  ic: 'relating to',
  ical: 'relating to',
  ory: 'place / relating to',
  ary: 'relating to',
  ure: 'act / result',
  age: 'action / state',
  ward: 'toward',
  wise: 'in manner of',
  pati: 'endure / suffer',
  rod: 'gnaw / bite',
  cid: 'cut',
  form: 'shape / form',
  happy: 'luck / happy',
  urb: 'city',
  tract: 'draw / pull',
  cord: 'heart',
  val: 'worth / strong',
  tain: 'hold',
  cept: 'take / seize',
  spect: 'look',
  vis: 'see',
  vid: 'see',
  dic: 'say / speak',
  dict: 'say / speak',
  duc: 'lead',
  duct: 'lead',
  fer: 'carry',
  mit: 'send',
  miss: 'send',
  port: 'carry',
  pos: 'put / place',
  scrib: 'write',
  script: 'write',
  stru: 'build',
  struct: 'build',
  rupt: 'break',
  pend: 'hang / weigh',
  press: 'press',
  tend: 'stretch',
  vers: 'turn',
  vert: 'turn',
  ven: 'come',
  vent: 'come',
  voc: 'call / voice',
  fin: 'end / limit',
  flu: 'flow',
  gen: 'birth / kind',
  grad: 'step',
  gress: 'step',
  graph: 'write',
  ject: 'throw',
  junct: 'join',
  lect: 'choose / read',
  leg: 'law / choose',
  loc: 'place',
  log: 'word / study',
  manu: 'hand',
  medi: 'middle',
  mem: 'memory',
  mov: 'move',
  mot: 'move',
  mut: 'change',
  nat: 'born',
  not: 'mark / know',
  nov: 'new',
  par: 'equal / prepare',
  pass: 'feel / suffer',
  pat: 'feel / suffer',
  ped: 'foot',
  pel: 'drive / push',
  puls: 'drive / push',
  plic: 'fold',
  pon: 'put',
  put: 'think',
  quer: 'ask / seek',
  quest: 'ask / seek',
  reg: 'rule',
  rect: 'straight / rule',
  scend: 'climb',
  sci: 'know',
  sec: 'cut',
  sect: 'cut',
  sed: 'sit',
  sens: 'feel',
  sent: 'feel',
  sequ: 'follow',
  serv: 'keep / serve',
  sign: 'mark',
  simil: 'like',
  solv: 'loosen',
  spec: 'look',
  spir: 'breathe',
  sta: 'stand',
  stat: 'stand',
  string: 'bind',
  strict: 'bind',
  sum: 'take',
  tang: 'touch',
  tact: 'touch',
  ten: 'hold',
  term: 'end',
  terr: 'earth',
  test: 'witness',
  tort: 'twist',
  trib: 'give',
  trud: 'push',
  var: 'vary',
  viv: 'live',
  volv: 'roll',
}

export const morphEn = (id: string) => EN_MORPH[id] || EN_MORPH[id.replace(/^[prs]_/, '')] || (MORPH_EN as Record<string, string>)[id]?.split(/[;,]/)[0]?.trim() || ''

export function formulaOf(d: AppState, w: string, parts: Part[], zh = gloss(w)): string {
  if (d.prefs.defLang === 'en') {
    const bits = parts.flatMap((p) => {
      if (p[1] === 'base') {
        const b = (p[2] || p[0]).toLowerCase()
        const bg = (sensesOfWord(b)[0]?.[5] || EN_GLOSS[b])?.split(/[;；,，]/)[0]?.trim()
        return [bg && bg !== b && !ZH_RE.test(bg) ? `${p[0]} (${bg})` : b]
      }
      const m = morphemeOf(d, p[1])
      if (!m) return []
      const en = morphEn(m.id)
      if (m.t === 'suf') return en ? [`${m.main} (${en})`] : [m.main]
      return [en ? `${m.main} ${en}` : m.main]
    })
    const enGloss = (sensesOfWord(w)[0]?.[5] || EN_GLOSS[w])?.split(/[;；]/)[0]?.trim()
    const cleanEn = enGloss && !ZH_RE.test(enGloss) ? enGloss : ''
    const out = bits.length >= 2 && (cleanEn || bits.some((b) => b.includes(' ')))
      ? `${bits.join(' + ')}${cleanEn ? ` → ${cleanEn}` : ''}`
      : ''
    return out && !ZH_RE.test(out) ? out : ''
  }
  const bits = parts.flatMap((p) => {
    if (p[1] === 'base') {
      const b = (p[2] || p[0]).toLowerCase()
      const bg = gloss(b, true)
      return bg && ZH_RE.test(bg) ? [`${b} ${bg}`] : []
    }
    const m = morphemeOf(d, p[1])
    if (!m || m.t === 'suf') return []
    const ss = sensesOfMorph(m)
    const sense = (ss[senseIdx(d, w, zh, m) ?? 0] || ss[0] || '').split('，')[0].replace(/[A-Za-z]+\.?/g, '').trim()
    return sense && ZH_RE.test(sense) ? [`${m.main} ${sense}`] : []
  })
  const cleanZh = zh.replace(/[A-Za-z]+\.?/g, '').trim()
  return bits.length && cleanZh && ZH_RE.test(cleanZh) ? `${bits.join(' + ')} → ${cleanZh}` : ''
}

export const etymKind = (d: AppState, w: string) => ((d.morph as MorphState | null)?.src?.ety?.[w.toLowerCase()] || etymOf(w.toLowerCase()))?.[0]

export function etymLine(d: AppState, w: string): string {
  const lw = w.toLowerCase()
  if (!lw || /\s/.test(lw)) return ''
  const ms = d.morph as MorphState | null
  const e = ms?.src?.ety?.[lw] || etymOf(lw)
  if (d.prefs.defLang === 'en') {
    if (e?.[2] && !ZH_RE.test(e[2])) return e[2]
    if (e?.[0] === 'o' || (e?.[0] === 'x' && e?.[1] && !e?.[2])) return ''
  } else if (e?.[1]) return e[1]
  if (e?.[0] === 'o') return ''
  const parts = ms?.words?.[lw]?.parts || EXACT[lw]?.parts || localSeg(lw)
  return parts ? formulaOf(d, lw, parts) : ''
}

export const ensureEtym = (w: string) => Promise.all([ensureMorphIndex(), ensureMorph(w.toLowerCase()), ensureDict(w), ensureSenses(w)])

export function useEtymLine(w: string | null | undefined): string {
  const d = useApp((x) => x.data)
  useApp((x) => x.dictSeq)
  useDataSeq((x) => x.seq)
  useEffect(() => {
    if (w) void ensureEtym(w)
  }, [w])
  return w ? etymLine(d, w) : ''
}
