import { useApp } from '../app/store'
import { today } from '../core/date'
import { callAI, type CallDeps } from './client'
import type { ChatMessage } from './types'

type Opts = Partial<Pick<CallDeps, 'timeoutMs' | 'jsonMode' | 'maxTokens' | 'estOut' | 'onPartial' | 'fetch'>>

const usage = () => useApp.getState().usage

export const aiDeps = (o: Opts = {}): CallDeps => ({ today: today(), usage, record: useApp.getState().recordUsage, ...o })

export const askJSON = <T = Record<string, unknown>>(prompt: string | ChatMessage[], o?: Opts) =>
  callAI(useApp.getState().ai, typeof prompt === 'string' ? [{ role: 'user', content: prompt }] : prompt, { ...aiDeps(o), json: true }) as Promise<T>

export const aiErr = (e: unknown, fallback: string) => {
  const code = (e as { code?: string })?.code
  if (code === 'quota') return 'AI 额度已满'
  if (code === 'insecure-url') return '远端接口须使用 HTTPS'
  return fallback
}

export function requireKey() {
  const s = useApp.getState()
  if (s.ai.apiKey) return true
  s.say('请先在设置中配置 AI 接口')
  useApp.setState({ settingsOpen: true })
  return false
}
