import { useEffect } from 'react'
import { useApp } from '../app/store'
import { useDataSeq } from '../core/shards'
import type { AppState } from '../core/types'
import { askJSON } from '../ai/ask'
import { ensureSenses, matchSense, parseSenseRows, phraseRow, SENSE_RULES, senseLine, senseLoaded, sensesOfWord, setLocalSenses, withSense } from '../lang/senses'

export function attachSids(d: AppState): AppState | null {
  let pieces: AppState['pieces'] | null = null
  for (const [id, p] of Object.entries(d.pieces)) {
    if (p.sid !== undefined) continue
    if (p.pos === 'phrase') {
      const r = phraseRow(p.lemma)
      if (!r && !senseLoaded(p.lemma)) continue
      pieces ??= { ...d.pieces }
      pieces[id] = r
        ? { ...p, sid: '', gloss: p.gloss || r[2], tile: !p.tile || p.tile === '短语' ? r[2] : p.tile, en: p.en || r[5], ens: p.ens || r[4] }
        : { ...p, sid: '' }
      continue
    }
    const rows = sensesOfWord(p.lemma)
    if (!rows.length && !senseLoaded(p.lemma)) continue
    const childSid = (p.childrenIds || []).map((cid) => d.pieces[cid]?.headSid).find((s) => s && s.startsWith(`${p.lemma.toLowerCase()}#`))
    const r = (childSid ? rows.find((x) => x[0] === childSid) : undefined) || matchSense(p, rows)
    pieces ??= { ...d.pieces }
    pieces[id] = r ? { ...p, sid: r[0], en: p.en || r[6], ens: r[5], senses: rows.map((x) => senseLine(x, 'zh')) } : { ...p, sid: '' }
  }
  return pieces ? { ...d, pieces } : null
}

export function useSenseSync() {
  const seq = useDataSeq((x) => x.seq)
  const ready = useApp((x) => x.ready)
  const senseR = useApp((x) => x.data.senseR)
  setLocalSenses(senseR)
  useEffect(() => {
    if (!ready) return
    const d = useApp.getState().data
    const pending = Object.values(d.pieces).filter((p) => p.sid === undefined)
    for (const w of new Set(pending.map((p) => p.lemma.toLowerCase()))) void ensureSenses(w)
  }, [ready])
  useEffect(() => {
    if (!ready) return
    const next = attachSids(useApp.getState().data)
    if (next) useApp.getState().update(() => next)
  }, [seq, ready, senseR])
}

const asked = new Set<string>()

export async function generateSenses(lemma: string) {
  const w = lemma.toLowerCase()
  const s = useApp.getState()
  if (!s.ai.apiKey || asked.has(w) || !/^[a-z][a-z-]*$/.test(w)) return
  await ensureSenses(w)
  if (sensesOfWord(w).length) return
  asked.add(w)
  try {
    const out = await askJSON(`${SENSE_RULES}\nLemma: "${w}". Reply ONLY JSON {"senses":[{"pos":"","core":1,"zh_short":"","zh_def":"","en_short":"","en_def":"","ex1":""}]}`)
    const rows = parseSenseRows(w, out)
    if (!rows.length) return
    useApp.getState().update((d) => {
      const pieces = { ...d.pieces }
      for (const [id, p] of Object.entries(d.pieces)) {
        if (p.pos === 'phrase' || p.lemma.toLowerCase() !== w || p.sid) continue
        const r = matchSense(p, rows) || rows.find((x) => x[1] === p.pos) || rows[0]
        pieces[id] = { ...withSense(p, r), senses: rows.map((x) => senseLine(x, 'zh')), ai: p.ai }
      }
      return { ...d, pieces, senseR: { ...d.senseR, [w]: rows } }
    })
  } catch {
    asked.delete(w)
  }
}
