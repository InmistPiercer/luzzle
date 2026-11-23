import type { PosTag } from '../core/types'
import { createDict, type DictEntry, type ShardLoader } from './dict'

export interface Sense {
  pos: PosTag | ''
  tag: string
  text: string
}

export interface Participial {
  base: string
  pos: PosTag
}

let dict = createDict()
const subs = new Set<() => void>()
let version = 0

const notify = () => {
  version++
  subs.forEach((f) => f())
}

export const setDictLoader = (load: ShardLoader) => {
  dict = createDict(load)
  notify()
}

export const onDictChange = (fn: () => void) => {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}

export const dictVersion = () => version

export const dictPeek = (w: string): DictEntry | null => dict.peek(w)

export const dictHas = (w: string) => dict.has(w)

export const ensureDict = async (w: string) => {
  if (dict.isLoaded(w)) return
  await dict.ensure(w).catch(() => undefined)
  notify()
}

export const loadDictAll = async () => {
  await dict.preload()
  notify()
}

export const dictEntries = () => dict.each()

const TAG_POS: Record<string, PosTag> = {
  n: 'n.',
  v: 'v.',
  vt: 'v.',
  vi: 'v.',
  aux: 'v.',
  a: 'adj.',
  adj: 'adj.',
  ad: 'adv.',
  adv: 'adv.',
  prep: 'func.',
  conj: 'func.',
  pron: 'func.',
  art: 'func.',
  int: 'func.',
  interj: 'func.',
  num: 'func.',
  det: 'func.',
}

const TAG_RE = /^((?:(?:[a-z]+)\.\s*(?:[&/,]\s*)?)+)\s*/i

export function sensesOf(e: DictEntry | null): Sense[] {
  if (!e) return []
  const out: Sense[] = []
  for (const line of e.translation) {
    const l = line.trim()
    if (!l || l.startsWith('[')) continue
    const m = l.match(TAG_RE)
    const tag = m ? m[1].trim() : ''
    const first = tag.split(/[.\s&/,]+/)[0]?.toLowerCase() || ''
    const text = (m ? l.slice(m[0].length) : l).trim()
    if (!text) continue
    out.push({ pos: TAG_POS[first] || '', tag, text })
  }
  return out
}

export const stripTag = (text: string) => text.trim().replace(TAG_RE, '')

export const firstSense = (text: string) =>
  stripTag(text)
    .split(/[,，;；]/)
    .map((x) => x.replace(/[（(][^）)]*[）)]/g, '').trim())
    .find(Boolean) || ''

export const tileOfSense = (text: string) => firstSense(text).slice(0, 6)

export const shortLine = (text: string, n = 4) =>
  text
    .split(/[,，;；]\s*/)
    .filter(Boolean)
    .slice(0, n)
    .join('，')

export const primaryPos = (e: DictEntry | null, prefer?: PosTag): PosTag | '' => {
  const ss = sensesOf(e)
  if (prefer && prefer !== 'v.' && ss.some((s) => s.pos === prefer)) return prefer
  return ss.find((s) => s.pos)?.pos || ''
}

export const glossLines = (e: DictEntry | null, n = 3) => sensesOf(e).slice(0, n).map((s) => (s.tag ? `${s.tag} ${shortLine(s.text)}` : shortLine(s.text)))

export function participialFromDict(w: string): Participial | null {
  const e = dictPeek(w)
  const base = e?.exchange['0']
  const types = e?.exchange['1'] || ''
  if (!e || !base || base === w.toLowerCase() || !/[idp]/.test(types)) return null
  const ss = sensesOf(e)
  if (!ss.length) return null
  if (ss.every((s) => s.pos === 'adj.')) return { base, pos: 'adj.' }
  if (types === 'i' && e.exchange['s'] && ss.every((s) => s.pos === 'n.' || s.pos === 'adj.')) return { base, pos: ss[0].pos as PosTag }
  return null
}

export function dictLemma(w: string): string | null {
  const e = dictPeek(w)
  if (!e) return null
  const base = e.exchange['0']
  const types = e.exchange['1'] || ''
  if (base && base !== w.toLowerCase() && /[pdi3s]/.test(types.replace(/[^pdi3s]/g, '')) && dictHas(base)) return base
  return w.toLowerCase()
}

export const phOf = (e: DictEntry | null) => {
  const p = e?.phonetic?.trim()
  return p ? `/${p.replace(/'/g, 'ˈ').replace(/\./g, 'ˌ').replace(/ә/g, 'ə').replace(/^\/|\/$/g, '')}/` : ''
}

export const posOfTag = (text: string): PosTag | '' => {
  const m = text.trim().match(TAG_RE)
  const first = m ? m[1].split(/[.\s&/,]+/)[0]?.toLowerCase() || '' : ''
  return TAG_POS[first] || ''
}
