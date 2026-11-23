import { create } from 'zustand'

export const useDataSeq = create<{ seq: number }>(() => ({ seq: 0 }))
const bump = () => useDataSeq.setState((s) => ({ seq: s.seq + 1 }))

const keyOf = (w: string) => {
  const c = w[0]?.toLowerCase() || ''
  return c ? (/[a-z]/.test(c) ? c : '_') : ''
}

export function shardStore<T>(dir: string) {
  const shards = new Map<string, Record<string, T>>()
  const pending = new Map<string, Promise<void>>()
  const ensure = (w: string): Promise<void> => {
    const l = keyOf(w)
    if (!l || shards.has(l)) return Promise.resolve()
    let p = pending.get(l)
    if (!p) {
      p = fetch(`${import.meta.env.BASE_URL}${dir}/${l}.json`)
        .then((r) => (r.ok ? r.json() : {}))
        .then((j) => {
          shards.set(l, j as Record<string, T>)
          bump()
        })
        .catch(() => {
          pending.delete(l)
        })
      pending.set(l, p)
    }
    return p
  }
  const get = (w: string): T | undefined => shards.get(keyOf(w))?.[w]
  const set = (all: Record<string, T>) => {
    shards.clear()
    for (const [w, v] of Object.entries(all)) {
      const l = keyOf(w)
      if (l) shards.set(l, { ...(shards.get(l) || {}), [w]: v })
    }
  }
  const loaded = (w: string) => shards.has(keyOf(w))
  const entries = () => [...shards.values()].flatMap((m) => Object.entries(m))
  return { ensure, get, set, loaded, entries }
}
