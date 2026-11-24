import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import type { DesktopBridge } from './desktop'

describe('desktop integration', () => {
  it('migrates and saves keys securely, and keeps learning data recoverable after clearing', async () => {
    let vaultSecret = ''
    let encryptionWorks = true
    let deletionWorks = true
    const mockBridge: DesktopBridge = {
      isDesktop: true,
      platform: 'darwin',
      getSecret: vi.fn(async () => vaultSecret),
      setSecret: vi.fn(async (v: string) => {
        if (v ? !encryptionWorks : !deletionWorks) return false
        vaultSecret = v
        return true
      }),
      writeAutoBackup: vi.fn(async () => true),
      openBackupsFolder: vi.fn(async () => true),
      onMenuAction: () => () => {},
    }
    ;(globalThis as { window?: unknown }).window = {
      luzzleDesktop: mockBridge,
      addEventListener: () => {},
    }
    ;(globalThis as { document?: unknown }).document = {
      visibilityState: 'visible',
      addEventListener: () => {},
    }
    const { db } = await import('../storage/db')
    expect(db.name).toBe('luzzle-test')
    await db.kv.put({ key: 'ai', value: { provider: 'openai', baseUrl: '', apiKey: 'sk-legacy-plain', model: '', dailyLimit: 30, budget: 5, cur: 'CNY' } })
    await db.kv.put({ key: 'previousBackup', value: { old: true } })
    const { useApp } = await import('../app/store')
    await useApp.getState().hydrate()
    expect(vaultSecret).toBe('sk-legacy-plain')
    expect(useApp.getState().ai.apiKey).toBe('sk-legacy-plain')
    expect(((await db.kv.get('ai'))?.value as { apiKey?: string })?.apiKey).toBe('')

    expect(await useApp.getState().setAI({ apiKey: 'sk-keychain-2' })).toBe(true)
    expect(vaultSecret).toBe('sk-keychain-2')
    expect(((await db.kv.get('ai'))?.value as { apiKey?: string })?.apiKey).toBe('')

    encryptionWorks = false
    expect(await useApp.getState().setAI({ apiKey: 'sk-session-only' })).toBe(false)
    expect(((await db.kv.get('ai'))?.value as { apiKey?: string })?.apiKey).toBe('')
    expect(useApp.getState().ai.apiKey).toBe('sk-session-only')
    expect(useApp.getState().toast.msg).toContain('本次会话')
    expect(vaultSecret).toBe('sk-keychain-2')

    deletionWorks = false
    expect(await useApp.getState().setAI({ apiKey: '' })).toBe(false)
    expect(useApp.getState().toast.msg).toContain('未能删除')
    deletionWorks = true
    expect(await useApp.getState().setAI({ apiKey: '' })).toBe(true)
    expect(vaultSecret).toBe('')

    const before = useApp.getState().data
    await db.cache.put({ key: 'sample', at: 1, value: 'fixture' })
    await db.reviews.add({ at: 1, day: '2026-11-24', piece: 'sample', card: 'meaning', task: 'recall', grade: 2, fresh: false, source: 'forge' })
    const undo = await useApp.getState().clearAll()
    expect(undo).toBeTypeOf('function')
    expect(await db.cache.count()).toBe(0)
    expect(await db.reviews.count()).toBe(0)
    expect(await db.kv.get('previousBackup')).toBeUndefined()
    expect(Object.keys(useApp.getState().data.learn)).toEqual([])
    expect(await undo?.()).toBe(true)
    expect(await db.cache.count()).toBe(1)
    expect(await db.reviews.count()).toBe(1)
    expect(useApp.getState().data.learn).toEqual(before.learn)
  })
})
