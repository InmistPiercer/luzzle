import { IS_TEST } from '../core/edition'
import type { AppState, DocData, Mark, UserDoc } from '../core/types'
import { DEMO_DOCS } from './demo'

export interface DocFlags {
  id: string
  rebuilt?: boolean
  cachedRebuilt?: boolean
  page?: number
  title?: string
  vault?: number
  hidden?: boolean
  tr?: DocData['tr']
}

const flagList = (data: AppState) => data.docState as DocFlags[]

const withFlags = (d: DocData, f: DocFlags | undefined): DocData => {
  if (!f) return d
  const out = { ...d } as DocData & Record<string, unknown>
  for (const [k, v] of Object.entries(f)) if (k !== 'id' && k !== 'hidden' && v !== undefined) out[k] = v
  return out
}

export const demoOn = (data: AppState, test = IS_TEST) => test && !data.extra.noDemo

export function allDocs(data: AppState): DocData[] {
  const flags = new Map(flagList(data).map((x) => [x.id, x]))
  const builtin = demoOn(data) ? DEMO_DOCS.filter((d) => !flags.get(d.id)?.hidden).map((d) => withFlags(d, flags.get(d.id))) : []
  const user = (data.docs as unknown as DocData[]).map((raw) => {
    const d = withFlags(raw, flags.get(raw.id))
    return d.parasAI || d.parasRule ? { ...d, paras: d.rebuilt && d.parasAI ? d.parasAI : d.parasRule || d.paras } : d
  })
  return [...builtin, ...user]
}

export const docsInVault = (data: AppState, v: number) => allDocs(data).filter((d) => d.vault === v)

export function setDocFlags(data: AppState, id: string, f: Omit<DocFlags, 'id'>): AppState {
  const list = flagList(data)
  const has = list.some((x) => x.id === id)
  return { ...data, docState: has ? list.map((x) => (x.id === id ? { ...x, ...f } : x)) : [...list, { id, ...f }] }
}

export const renameDoc = (data: AppState, id: string, title: string) => setDocFlags(data, id, { title })

export const moveDoc = (data: AppState, id: string, vault: number) => setDocFlags(data, id, { vault })

export interface Removed {
  doc?: UserDoc
  index: number
  flags?: DocFlags
  demo: boolean
}

export function deleteDoc(data: AppState, id: string): { data: AppState; removed: Removed } {
  const index = data.docs.findIndex((d) => d.id === id)
  const flags = flagList(data).find((x) => x.id === id)
  if (index < 0) {
    return { data: setDocFlags(data, id, { hidden: true }), removed: { index: -1, flags, demo: true } }
  }
  return {
    data: { ...data, docs: data.docs.filter((d) => d.id !== id), docState: flagList(data).filter((x) => x.id !== id) },
    removed: { doc: data.docs[index], index, flags, demo: false },
  }
}

export function restoreDoc(data: AppState, r: Removed): AppState {
  const id = r.doc?.id || r.flags?.id
  if (!id) return data
  if (r.demo) return setDocFlags(data, id, { hidden: false })
  const list = flagList(data).filter((x) => x.id !== id)
  const docState = r.flags ? [...list, r.flags] : list
  if (!r.doc || data.docs.some((d) => d.id === id)) return { ...data, docState }
  const docs = [...data.docs]
  docs.splice(Math.min(r.index, docs.length), 0, r.doc)
  return { ...data, docs, docState }
}

export function purgeMarks(marks: Record<string, Mark>, pids: Set<string>): Record<string, Mark> {
  const out: Record<string, Mark> = {}
  for (const [k, v] of Object.entries(marks)) if (!pids.has(k.slice(0, k.lastIndexOf(':')))) out[k] = v
  return out
}

export const paraIdsOf = (d: DocData) => new Set([d.paras, d.parasRule, d.parasAI].flatMap((ps) => (ps || []).map((p) => p.id || '')).filter(Boolean))

export const renameVault = (data: AppState, i: number, name: string): AppState => ({
  ...data,
  vaults: data.vaults.map((v, k) => (k === i ? { ...v, name } : v)),
})

export function deleteVault(data: AppState, i: number, moveTo: number | null): AppState {
  if (data.vaults.length <= 1 || !data.vaults[i]) return data
  let next = data
  for (const d of docsInVault(data, i)) next = moveTo == null ? deleteDoc(next, d.id).data : moveDoc(next, d.id, moveTo)
  const shift = (v: number) => (v > i ? v - 1 : v)
  for (const d of allDocs(next)) if (d.vault > i) next = setDocFlags(next, d.id, { vault: shift(d.vault) })
  const cur = next.curVault === i ? (moveTo == null ? Math.max(0, i - 1) : moveTo) : next.curVault
  return { ...next, vaults: next.vaults.filter((_, k) => k !== i), curVault: shift(cur) }
}
