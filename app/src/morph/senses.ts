import type { AppState } from '../core/types'
import { LIB, type Morpheme } from './data'
import type { MorphState } from './engine'

const BY_ID = new Map(LIB.map((m) => [m.id, m]))

export const morphemeOf = (d: AppState, id: string): Morpheme | undefined =>
  BY_ID.get(id) || ((d.morph as MorphState | null)?.src?.lib || []).find((m) => m.id === id)

const han = (t: string) => new Set([...t].filter((c) => /[一-鿿]/.test(c) && !'的性者人化地使可之物于为以'.includes(c)))
export const bare = (zh: string) => zh.replace(/^[a-z]+\.\s*/, '').trim()

export const sensesOfMorph = (m: Morpheme) => m.zh.split('；').map(bare).filter(Boolean)

export function senseIdx(d: AppState, w: string, zh: string, m: Morpheme): number | null {
  const ss = sensesOfMorph(m)
  if (ss.length < 2) return 0
  const cached = d.msense?.[`${w}:${m.id}`]
  if (cached != null && cached < ss.length) return cached
  const sc = ss.map((s) => [...han(s)].filter((c) => han(zh).has(c)).length)
  const best = Math.max(...sc)
  return best > 0 && sc.filter((x) => x === best).length === 1 ? sc.indexOf(best) : null
}
