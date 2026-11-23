export type RawEntry = [phonetic?: string, translation?: string, pos?: string, exchange?: string, tag?: string, freq?: number]

export interface DictEntry {
  word: string
  phonetic: string
  translation: string[]
  exchange: Record<string, string>
  tags: string[]
  freq: number
}

export type ShardLoader = (letter: string) => Promise<Record<string, RawEntry>>

export const fetchShard: ShardLoader = async (letter) => {
  const res = await fetch(`${import.meta.env.BASE_URL}dict/${letter}.json`)
  if (!res.ok) throw new Error(`dict ${letter} ${res.status}`)
  return res.json()
}

const parseExchange = (s = ''): Record<string, string> =>
  Object.fromEntries(
    s
      .split('/')
      .filter(Boolean)
      .map((p) => [p.slice(0, p.indexOf(':')), p.slice(p.indexOf(':') + 1)]),
  )

export const letterOf = (w: string) => (/^[a-z]/.test(w) ? w[0] : '_')

export const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('')

export const createDict = (load: ShardLoader = fetchShard) => {
  const shards = new Map<string, Promise<Map<string, RawEntry & { 6?: string }>>>()
  const ready = new Map<string, Map<string, RawEntry & { 6?: string }>>()

  const shard = (letter: string) => {
    let p = shards.get(letter)
    if (!p) {
      p = load(letter).then((obj) => {
        const m = new Map<string, RawEntry & { 6?: string }>()
        for (const [k, v] of Object.entries(obj)) {
          const lk = k.toLowerCase()
          if (!m.has(lk) || k === lk) m.set(lk, Object.assign([...v], { 6: k }) as RawEntry & { 6?: string })
        }
        ready.set(letter, m)
        return m
      })
      p.catch(() => shards.delete(letter))
      shards.set(letter, p)
    }
    return p
  }

  const toEntry = (w: string, raw: (RawEntry & { 6?: string }) | undefined): DictEntry | null => {
    if (!raw) return null
    return {
      word: raw[6] || w,
      phonetic: raw[0] || '',
      translation: (raw[1] || '').split('\n').filter(Boolean),
      exchange: parseExchange(raw[3]),
      tags: (raw[4] || '').split(' ').filter(Boolean),
      freq: raw[5] || 0,
    }
  }

  const lookup = async (word: string): Promise<DictEntry | null> => {
    const w = word.trim().toLowerCase()
    if (!w) return null
    return toEntry(w, (await shard(letterOf(w))).get(w))
  }

  const peek = (word: string): DictEntry | null => {
    const w = word.trim().toLowerCase()
    return w ? toEntry(w, ready.get(letterOf(w))?.get(w)) : null
  }

  const has = (word: string) => !!ready.get(letterOf(word.toLowerCase()))?.has(word.toLowerCase())

  const isLoaded = (word: string) => ready.has(letterOf(word.trim().toLowerCase()))

  const ensure = (word: string) => shard(letterOf(word.trim().toLowerCase())).then(() => undefined)

  const preload = async (letters: string[] = LETTERS) => {
    for (const l of letters) await shard(l).catch(() => undefined)
  }

  const each = function* () {
    for (const m of ready.values()) for (const [w, raw] of m) yield toEntry(w, raw) as DictEntry
  }

  const baseOf = async (word: string): Promise<string | null> => (await lookup(word))?.exchange['0'] || null

  return { lookup, baseOf, peek, has, isLoaded, ensure, preload, each }
}

export type Dict = ReturnType<typeof createDict>
