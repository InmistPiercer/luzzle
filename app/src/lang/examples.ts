import { allDocs } from '../content/docs'
import { shardStore } from '../core/shards'
import type { AppState } from '../core/types'
import { splitSentences, stripCites } from '../reader/text'
import { lemmatize } from './lemmatize'

const ex = shardStore<string[]>('ex')
export const ensureEx = ex.ensure
export const examplesOf = (w: string): string[] => ex.get(w.toLowerCase()) || []
export const setExamples = ex.set

export function tokenFor(s: string, lemma: string): string | null {
  const l = lemma.toLowerCase()
  const stem = l.replace(/e$/, '')
  for (const t of s.match(/[A-Za-z]+/g) || []) {
    const x = t.toLowerCase()
    if (x === l || lemmatize(x) === l || (x.startsWith(stem) && /^(e?s|e?d|ing|[b-df-hj-np-tv-z](ed|ing))$/.test(x.slice(stem.length)))) return t
  }
  return null
}

export function docSentence(d: AppState, lemma: string): string {
  const probe = new RegExp(`\\b${lemma.slice(0, Math.max(3, lemma.length - 2))}`, 'i')
  for (const doc of allDocs(d))
    for (const p of doc.paras) {
      const t = p.t || p.raw || ''
      if (!probe.test(t)) continue
      for (const s of splitSentences(stripCites(t))) if (s.length <= 260 && tokenFor(s, lemma)) return s.trim()
    }
  return ''
}
