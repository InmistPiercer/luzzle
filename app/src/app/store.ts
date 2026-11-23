import { create } from 'zustand'
import { addUsage, clearLegacyAIConfig, emptyUsage, normalizeAIConfig, readLegacyAIConfig, type Tally, type Usage } from '../ai/client'
import type { AIConfig } from '../ai/types'
import { restoreDemo } from '../content/demoClear'
import { setDayOffset, today } from '../core/date'
import { desktop } from '../core/desktop'
import { cleanState, initialState, IS_TEST } from '../core/edition'
import type { AppState, LearnState, Prefs } from '../core/types'
import { forgeQueue } from '../learn/engine'
import { onDictChange } from '../lang/lexdict'
import { db } from '../storage/db'
import { exportBackup, loadState, saveState, StaleStateError } from '../storage/persist'
import { normStyle } from '../theme/styles'

export type View = 'read' | 'board' | 'forge' | 'build'

interface ToastState {
  msg: string
  seq: number
  undo?: () => void
  act?: string
}

interface Store {
  ready: boolean
  view: View
  data: AppState
  ai: AIConfig
  usage: Usage
  again: Set<string>
  againStep: Record<string, number>
  againDay: string
  toast: ToastState
  savedAt: number
  hydrate: () => Promise<void>
  go: (v: View) => void
  update: (fn: (d: AppState) => AppState) => void
  setLearn: (fn: (s: LearnState) => LearnState) => void
  markAgain: (id: string, on: boolean) => void
  setPrefs: (p: Partial<Prefs>) => void
  setAI: (p: Partial<AIConfig>) => void
  recordUsage: (t: Tally) => void
  resetUsageTotal: () => void
  replace: (data: AppState) => Promise<boolean>
  resetDemo: () => void
  clearAll: () => Promise<() => Promise<unknown>>
  nextDay: () => void
  resetDay: () => void
  say: (msg: string, undo?: () => void, act?: string) => void
  pulse: () => void
  pulseSeq: number
  dictSeq: number
  demoAsk: 'import' | 'settings' | null
  boardSel: string | null
  forgeWord: string | null
  forgeAll: boolean
  settingsOpen: boolean
}

let timer: ReturnType<typeof setTimeout> | undefined
let backupTimer: ReturnType<typeof setTimeout> | undefined
let backupPending: AppState | null = null
let pending: AppState | null = null
const TAB_ID = Math.random().toString(36).slice(2)
const chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('luzzle-state') : null

const flushBackup = () => {
  if (!desktop || !backupPending) return
  clearTimeout(backupTimer)
  const d = backupPending
  backupPending = null
  if (!Object.keys(d.learn).length && !d.docs.length) return
  void desktop.writeAutoBackup(exportBackup(d), today()).catch(() => undefined)
}

const scheduleBackup = (d: AppState) => {
  if (!desktop) return
  backupPending = d
  clearTimeout(backupTimer)
  backupTimer = setTimeout(flushBackup, 8000)
}

const flush = (immediateBackup = false) => {
  if (!pending) {
    if (immediateBackup) flushBackup()
    return
  }
  clearTimeout(timer)
  const d = pending
  pending = null
  if (immediateBackup) {
    backupPending = d
    flushBackup()
  } else {
    scheduleBackup(d)
  }
  void saveState(d).then(
    () => {
      useApp.setState({ savedAt: Date.now() })
      chan?.postMessage({ tab: TAB_ID })
    },
    (err: unknown) => useApp.getState().say(err instanceof StaleStateError
      ? '另一标签页已保存更新。可先导出当前备份，再刷新此页'
      : '保存失败，请在设置中导出备份'),
  )
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flush(true))
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush(true))
  if (chan) {
    chan.onmessage = (e: MessageEvent<{ tab?: string }>) => {
      if (e.data?.tab && e.data.tab !== TAB_ID) {
        useApp.getState().say('另一标签页已保存更新。可先导出当前备份，再刷新此页')
      }
    }
  }
}

const fixPrefs = ({ palette, ...p }: Prefs): Prefs => ({
  ...p,
  style: normStyle(p.style, palette),
  pageLen: p.pageLen || 'mid',
  defLang: p.defLang === 'zh' ? 'zh' : 'en',
  defaultGoal: p.defaultGoal === 'use' ? 'use' : 'read',
})

export const useApp = create<Store>((set, get) => {
  let replacing = false
  const persist = (data: AppState) => {
    clearTimeout(timer)
    pending = data
    timer = setTimeout(flush, 150)
  }
  const commit = (data: AppState) => {
    if (replacing) return
    const before = get().data
    set({ data })
    persist(data)
    if (IS_TEST && get().ready && data.docs.length > before.docs.length && !data.extra.noDemo && !data.extra.demoAsked && !get().demoAsk) set({ demoAsk: 'import' })
  }
  return {
    ready: false,
    view: 'read',
    data: initialState(today()),
    ai: normalizeAIConfig(),
    usage: emptyUsage(today()),
    again: new Set(),
    againStep: {},
    againDay: today(),
    toast: { msg: '', seq: 0 },
    savedAt: 0,
    hydrate: async () => {
      let data: AppState
      try {
        const loaded = await loadState()
        data = loaded || initialState(today())
        if (!loaded) await saveState(data)
      } catch (err) {
        if (!(err instanceof StaleStateError)) throw err
        const loaded = await loadState()
        if (!loaded) throw err
        data = loaded
      }
      const dayOffset = IS_TEST ? data.dayOffset : 0
      data = { ...data, dayOffset, prefs: fixPrefs(data.prefs) }
      if (!desktop && typeof navigator !== 'undefined') {
        void navigator.storage?.persist?.().catch(() => undefined)
      }
      const stored = (await db.kv.get('ai'))?.value as AIConfig | undefined
      const legacy = !stored && typeof localStorage !== 'undefined' ? readLegacyAIConfig(localStorage) : null
      let ai = stored ? normalizeAIConfig(stored) : legacy || normalizeAIConfig()
      if (desktop) {
        const keychainKey = await desktop.getSecret().catch(() => '')
        if (keychainKey) {
          ai = { ...ai, apiKey: keychainKey }
          if (stored?.apiKey) await db.kv.put({ key: 'ai', value: { ...ai, apiKey: '' } }).catch(() => undefined)
        } else if (ai.apiKey) {
          const ok = await desktop.setSecret(ai.apiKey).catch(() => false)
          await db.kv.put({ key: 'ai', value: ok ? { ...ai, apiKey: '' } : ai }).catch(() => undefined)
        } else if (!stored) {
          await db.kv.put({ key: 'ai', value: { ...ai, apiKey: '' } }).catch(() => undefined)
        }
      } else if (!stored || stored.provider !== ai.provider || stored.baseUrl !== ai.baseUrl) {
        await db.kv.put({ key: 'ai', value: ai }).catch(() => undefined)
      }
      if (legacy && typeof localStorage !== 'undefined') clearLegacyAIConfig(localStorage)
      const old = (await db.kv.get('quota'))?.value as { day: string; used: number } | undefined
      const usage = ((await db.kv.get('usage'))?.value as Usage | undefined) || (old ? { ...emptyUsage(old.day), req: old.used, total: { ...emptyUsage(old.day).total, req: old.used } } : emptyUsage(today()))
      setDayOffset(dayOffset)
      const curDay = today()
      const savedAgain = (await db.kv.get('again'))?.value as { day?: string; ids?: string[]; step?: Record<string, number> } | undefined
      const validIds = savedAgain?.day === curDay ? (savedAgain.ids || []).filter((id) => !!data.learn[id] && data.learn[id].goal !== 'stash') : []
      const validStep = savedAgain?.day === curDay && savedAgain.step ? Object.fromEntries(Object.entries(savedAgain.step).filter(([id]) => validIds.includes(id))) : {}
      set({ data, ai, usage, again: new Set(validIds), againStep: validStep, againDay: curDay, ready: true })
      let t: ReturnType<typeof setTimeout> | undefined
      onDictChange(() => {
        clearTimeout(t)
        t = setTimeout(() => set({ dictSeq: get().dictSeq + 1 }), 120)
      })
    },
    go: (view) => set(view === 'forge' ? { view, forgeAll: false } : { view }),
    update: (fn) => commit(fn(get().data)),
    setLearn: (fn) => commit({ ...get().data, learn: fn(get().data.learn) }),
    markAgain: (id, on) => {
      const curDay = today()
      const stale = get().againDay !== curDay
      const again = stale ? new Set<string>() : new Set(get().again)
      const againStep = stale ? {} : { ...get().againStep }
      if (on) {
        again.add(id)
        againStep[id] = (againStep[id] || 0) + 1
      } else {
        again.delete(id)
        delete againStep[id]
      }
      set({ again, againStep, againDay: curDay })
      void db.kv.put({ key: 'again', value: { day: curDay, ids: [...again], step: againStep } }).catch(() => undefined)
    },
    setPrefs: (p) => commit({ ...get().data, prefs: fixPrefs({ ...get().data.prefs, ...p }) }),
    setAI: (p) => {
      const ai = normalizeAIConfig({ ...get().ai, ...p })
      set({ ai })
      if (desktop) {
        void desktop
          .setSecret(ai.apiKey)
          .then((ok) => db.kv.put({ key: 'ai', value: ok ? { ...ai, apiKey: '' } : ai }))
          .catch(() => db.kv.put({ key: 'ai', value: ai }))
      } else {
        void db.kv.put({ key: 'ai', value: ai })
      }
    },
    recordUsage: (t) => {
      const usage = addUsage(get().usage, t, today())
      set({ usage })
      void db.kv.put({ key: 'usage', value: usage })
    },
    resetUsageTotal: () => {
      const u = get().usage
      const usage = { ...u, total: { ...emptyUsage(today()).total } }
      set({ usage })
      void db.kv.put({ key: 'usage', value: usage })
    },
    replace: async (raw) => {
      if (replacing) return false
      replacing = true
      const before = get().data
      try {
        clearTimeout(timer)
        pending = null
        const dayOffset = IS_TEST ? raw.dayOffset : 0
        const data = { ...raw, dayOffset, prefs: fixPrefs(raw.prefs) }
        await saveState(data, db, before)
        chan?.postMessage({ tab: TAB_ID })
        setDayOffset(dayOffset)
        void db.kv.delete('again').catch(() => undefined)
        set({ data, again: new Set(), againStep: {}, againDay: today(), boardSel: null, forgeWord: null, demoAsk: null, savedAt: Date.now() })
        return true
      } catch (err) {
        get().say(err instanceof StaleStateError ? '另一标签页已保存更新。请刷新后再恢复备份' : '备份恢复失败')
        return false
      } finally {
        replacing = false
      }
    },
    resetDemo: () => {
      if (!IS_TEST) return
      commit(restoreDemo(get().data, today()))
    },
    clearAll: async () => {
      setDayOffset(0)
      clearTimeout(backupTimer)
      backupPending = null
      if (desktop) void desktop.clearAutoBackups().catch(() => undefined)
      void db.kv.delete('again').catch(() => undefined)
      void db.kv.delete('previousBackup').catch(() => undefined)
      set({ again: new Set(), againStep: {}, againDay: today(), boardSel: null, forgeWord: null, demoAsk: null })
      commit(cleanState())
      const [cache, reviews] = await Promise.all([db.cache.toArray(), db.reviews.toArray()])
      await Promise.all([db.cache.clear(), db.reviews.clear()])
      return () => Promise.all([db.cache.bulkPut(cache), db.reviews.bulkPut(reviews)])
    },
    nextDay: () => {
      if (!IS_TEST) return
      const dayOffset = get().data.dayOffset + 1
      setDayOffset(dayOffset)
      void db.kv.delete('again').catch(() => undefined)
      set({ again: new Set(), againStep: {}, againDay: today() })
      commit({ ...get().data, dayOffset })
      get().say(today())
    },
    resetDay: () => {
      if (!IS_TEST) return
      setDayOffset(0)
      void db.kv.delete('again').catch(() => undefined)
      set({ again: new Set(), againStep: {}, againDay: today() })
      commit({ ...get().data, dayOffset: 0 })
    },
    say: (msg, undo, act) => set({ toast: { msg, seq: get().toast.seq + 1, undo, act } }),
    pulseSeq: 0,
    dictSeq: 0,
    demoAsk: null,
    pulse: () => set({ pulseSeq: get().pulseSeq + 1 }),
    boardSel: IS_TEST ? 'patience' : null,
    forgeWord: null,
    forgeAll: false,
    settingsOpen: false,
  }
})

export const EMPTY_SET: ReadonlySet<string> = new Set()

export const useDueCount = () =>
  useApp((x) => {
    const d = today()
    return forgeQueue(x.data.learn, d, x.data.caps.newDaily, x.againDay === d ? x.again : EMPTY_SET, x.data.pieces).length
  })
