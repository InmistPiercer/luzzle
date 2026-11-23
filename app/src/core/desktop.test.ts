import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import type { DesktopBridge } from './desktop'

describe('desktop integration', () => {
  it('stores API keys in OS keychain without plaintext in IndexedDB and clears auto-backups on reset', async () => {
    let vaultSecret = ''
    const clearAutoBackups = vi.fn(async () => true)
    const mockBridge: DesktopBridge = {
      isDesktop: true,
      platform: 'darwin',
      getSecret: vi.fn(async () => vaultSecret),
      setSecret: vi.fn(async (v: string) => {
        vaultSecret = v
        return true
      }),
      writeAutoBackup: vi.fn(async () => true),
      openBackupsFolder: vi.fn(async () => true),
      clearAutoBackups,
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
    await db.kv.put({ key: 'ai', value: { provider: 'openai', baseUrl: '', apiKey: 'sk-legacy-plain', model: '', dailyLimit: 30, budget: 5, cur: 'CNY' } })
    await db.kv.put({ key: 'previousBackup', value: { old: true } })
    const { useApp } = await import('../app/store')
    await useApp.getState().hydrate()
    expect(vaultSecret).toBe('sk-legacy-plain')
    expect(useApp.getState().ai.apiKey).toBe('sk-legacy-plain')
    expect(((await db.kv.get('ai'))?.value as { apiKey?: string })?.apiKey).toBe('')

    useApp.getState().setAI({ apiKey: 'sk-keychain-2' })
    await new Promise((r) => setTimeout(r, 30))
    expect(vaultSecret).toBe('sk-keychain-2')
    expect(((await db.kv.get('ai'))?.value as { apiKey?: string })?.apiKey).toBe('')

    await useApp.getState().clearAll()
    expect(clearAutoBackups).toHaveBeenCalledTimes(1)
    expect(await db.kv.get('previousBackup')).toBeUndefined()
  })
})
