import { create } from 'zustand'
import { aiErr, askJSON, requireKey } from '../ai/ask'
import { useApp } from '../app/store'
import { today } from '../core/date'
import type { AppState } from '../core/types'
import { guessPosBySuffix, lemmatize } from '../lang/lemmatize'
import { createPiece, entryFromSurface, newPieceId, piecesOfLemma } from '../learn/pieces'
import { MorphEngine, norm, type Analysis, type MorphCtx, type MorphState } from './engine'
import { ensureMorph, ensureMorphIndex } from './local'
import { ensureDict } from '../lang/lexdict'
import { ensureSenses, plainExample, sensesOfWord } from '../lang/senses'
import { docSentence, ensureEx, examplesOf, tokenFor } from '../lang/examples'

interface MxUI {
  cur: string | null
  selM: string | null
  preview: Exclude<Analysis, { kind: 'ok' } | { kind: 'none' }> | null
  showSeed: boolean
  set: (p: Partial<MxUI>) => void
}

export const useMx = create<MxUI>((set) => ({
  cur: 'patience',
  selM: 'pati',
  preview: null,
  showSeed: false,
  set: (p) => set(p),
}))

const app = () => useApp.getState()
const ui = () => useMx.getState()

export const engine = () => new MorphEngine(app().data.morph as never, app().data)
const commit = (e: MorphEngine) => app().update((d) => ({ ...d, morph: e.snapshot() }))

export const vocabPieces = (w: string) => piecesOfLemma(app().data, lemmatize(w))

export async function morphSplit(raw: string, ctx: MorphCtx | null = null) {
  const w0 = norm(raw)
  if (app().view !== 'build') app().go('build')
  await Promise.all([ensureMorph(w0), ensureDict(w0), ensureSenses(w0), ensureMorphIndex()])
  const e = engine()
  const r = e.analyze(raw)
  if (r.kind === 'none') return
  const w = ('word' in r && r.word) || w0
  const had = e.ms.words[w]
  if (had) {
    const isNewSrc = !!ctx && !had.ctx.some((c) => c.docId === ctx.docId && c.pid === ctx.pid && c.wi === ctx.wi)
    if (isNewSrc && ctx) had.ctx.push(ctx)
    ui().set({ cur: w, selM: e.rootOf(had.parts) || ui().selM, preview: null })
    commit(e)
    return app().say(isNewSrc ? '已拆解过 · 已定位 · 追加新语境' : '已拆解过 · 已定位')
  }
  if (r.kind === 'ok') {
    const bases = r.parts.filter((p) => p[1] === 'base').map((p) => (p[2] || p[0]).toLowerCase())
    if (bases.length) await Promise.all(bases.flatMap((b) => [ensureDict(b), ensureSenses(b)]))
    e.ms.words[w] = { parts: r.parts, layer: r.layer, tags: e.tagsFor(r.parts, w), ctx: ctx ? [ctx] : [], at: today() }
    ui().set({ cur: w, preview: null, selM: e.rootOf(r.parts) })
    commit(e)
    return
  }
  ui().set({ cur: w, preview: r, selM: null })
  if (r.kind === 'unknown' && app().ai.apiKey) await aiSplit(w, ctx)
}


export async function aiSplit(w: string | null, ctx: MorphCtx | null = null) {
  if (!w || !requireKey()) return
  app().say('AI 拆解中…')
  try {
    const r = await askJSON(
      `Split the English word "${w}" into morphemes. Use the actual spelling of each piece so that the pieces concatenate exactly to the word. For each piece give type (prefix / root / suffix / base), the canonical morpheme (e.g. ad- / tract / -ive) and a short Chinese gloss. If the word has no modern prefix/suffix structure (an old loan or a fossilized word), return "parts":[]. Set "drift" true when the meaning has drifted so far that it cannot be guessed from the morphemes. "ety" is ONE short line in Chinese showing how the meaning developed, like "sub- 在下 + urb 城市 → 郊区" or "candidus 白色 → 穿白袍的人 → 候选人"; "ety_en" is the same line in English. Reply ONLY JSON {"pos":"adj.","zh":"简明中文义","parts":[{"s":"at","type":"prefix","m":"ad-","zh":"朝向"}],"drift":false,"ety":"","ety_en":""}`,
    )
    const e = engine()
    const res = e.applyAISplit(w, r as never, today())
    if (res === 'bad') return app().say('AI 结果未通过校验，保留原拆解')
    if (res === 'opaque') {
      commit(e)
      ui().set({ cur: w, preview: { kind: 'opaque', word: w, ety: e.etym(w)?.[1] || '' } })
      return app().say('AI 拆解完成')
    }
    if (ctx && !e.ms.words[w].ctx.length) e.ms.words[w].ctx.push(ctx)
    commit(e)
    ui().set({ cur: w, preview: null, selM: e.rootOf(e.ms.words[w].parts) })
    app().say('AI 拆解完成')
  } catch (er) {
    app().say(aiErr(er, 'AI 拆解失败'))
  }
}

export function morphVocabSentence(d: AppState, w: string, ctxS?: string, decX?: string): string {
  const rawEx = sensesOfWord(w)[0]?.[7]
  const senseEx = rawEx ? plainExample(rawEx).trim() : ''
  return (
    ctxS ||
    docSentence(d, w) ||
    (senseEx && tokenFor(senseEx, w) ? senseEx : '') ||
    examplesOf(w).find((x) => tokenFor(x, w)) ||
    decX ||
    ''
  )
}

export async function addToVocab(w: string, info?: { z?: string; p?: string }) {
  if (vocabPieces(w).length) return
  await Promise.all([ensureEx(w), ensureDict(w), ensureSenses(w)])
  const e = engine()
  const dec = e.decomposition(w)
  const c = e.ms.words[w]?.ctx.find((x) => x.s && tokenFor(x.s, w))
  let s = morphVocabSentence(app().data, w, c?.s, dec?.x)
  if (!s && app().ai.apiKey) {
    try {
      const r = await askJSON(`Write one natural English sentence (10-20 words) using the word "${w}". Reply ONLY JSON {"s":"..."}`)
      if (typeof r.s === 'string' && tokenFor(r.s, w)) s = r.s
    } catch {
      s = ''
    }
  }
  const d = app().data
  if (vocabPieces(w).length) return
  const id = newPieceId(d, w)
  const base = entryFromSurface(w, s, { lemma: w })
  const z = dec?.z || info?.z || ''
  const entry = { ...base, form: (s && tokenFor(s, w)) || w, tile: base.tile || z.split(/[；，;,]/)[0].slice(0, 6), pos: base.pos || dec?.p || info?.p || guessPosBySuffix(w), s, alt: [] }
  app().update((x) => createPiece(x, id, entry, '词族关联', { pid: c?.pid ?? null, wi: c?.wi ?? null, doc: c?.doc || '', s }))
  app().say(`${w} 已收入词库`)
}

export async function refreshBasic() {
  const ws = Object.entries((app().data.morph as MorphState | null)?.words || {})
    .filter(([, x]) => x.layer === 'basic')
    .map(([w]) => w)
  await Promise.all([ensureMorphIndex(), ...ws.flatMap((w) => [ensureMorph(w), ensureDict(w)])])
  const e = engine()
  if (e.refreshBasic()) commit(e)
}

export function mergeMorph(from: string, to: string) {
  const e = engine()
  const target = e.morpheme(to)
  e.mergeMorpheme(from, to)
  commit(e)
  ui().set({ selM: to })
  app().say(`已合并到 ${target?.main}`)
}

export function deleteMorph(id: string) {
  const e = engine()
  const mm = e.morpheme(id)
  e.removeMorpheme(id)
  commit(e)
  ui().set({ selM: null })
  app().say(`已删除 ${mm?.main}`)
}
