import { useState } from 'react'
import { create } from 'zustand'
import { useApp } from '../app/store'
import { aiDeps } from './ask'
import { accountedUsage, LONG_MAX_TOKENS } from './client'
import { costOf, estTokens, money, priceOf, toUSD } from './pricing'
import { providerOf } from './providers'

export interface Plan {
  calls: number
  inTok: number
  outTok: number
  parts: { inTok: number; outTok: number; pages: number }[]
}

export interface ScopeOption {
  label: string
  plan: Plan
  onOk: (fit: number) => void
}

interface Ask extends Plan {
  title: string
  sub: string
  onOk: (fit: number) => void
  scopes?: ScopeOption[]
}

const useAsk = create<{ ask: Ask | null; seq: number }>(() => ({ ask: null, seq: 0 }))

export const confirmAI = (a: Ask) => useAsk.setState((s) => ({ ask: a, seq: s.seq + 1 }))

export const planOf = (texts: string[], prompt: string, outRatio: number, pageCounts: number[] = []): Plan => {
  const p = estTokens(prompt)
  const t = texts.map(estTokens)
  return {
    calls: texts.length,
    inTok: t.reduce((a, b) => a + b + p, 0),
    outTok: Math.ceil(t.reduce((a, b) => a + b, 0) * outRatio),
    parts: t.map((n, i) => ({
      inTok: n + p,
      outTok: Math.min(LONG_MAX_TOKENS, Math.max(256, Math.ceil(n * outRatio * 1.25))),
      pages: pageCounts[i] ?? 1,
    })),
  }
}

export function fitCalls(plan: Plan): { cost: number | null; fit: number } {
  const { ai } = useApp.getState()
  const p = priceOf(ai, providerOf(ai.provider).model)
  const t = accountedUsage(aiDeps())
  const cost = p ? costOf(p, { in: plan.inTok, out: plan.outTok }) : null
  if (p) {
    if (!ai.budget) return { cost, fit: plan.calls }
    let left = Math.max(0, toUSD(ai.budget, ai.cur) - t.cost)
    let fit = 0
    for (const part of plan.parts) {
      left -= costOf(p, { in: part.inTok, out: part.outTok })
      if (left < 0) break
      fit++
    }
    return { cost, fit }
  }
  return { cost, fit: ai.dailyLimit > 0 ? Math.min(plan.calls, Math.max(0, ai.dailyLimit - t.req)) : plan.calls }
}

function ConfirmBody({ a, cur, close }: { a: Ask; cur: 'CNY' | 'USD'; close: () => void }) {
  const [si, setSi] = useState(0)
  const scopes = a.scopes
  const curScope = scopes?.length ? scopes[Math.min(si, scopes.length - 1)] : null
  const plan = curScope ? curScope.plan : a
  const onOk = curScope ? curScope.onOk : a.onOk
  const { cost, fit } = fitCalls(plan)
  const pages = plan.parts.slice(0, fit).reduce((sum, part) => sum + part.pages, 0)
  return (
    <div className="modal-bg open" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label={a.title} id="ai-confirm" style={{ width: 'min(420px,92vw)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>{a.title}</h3>
          <button className="x-btn" aria-label="关闭" onClick={close}>
            ×
          </button>
        </div>
        <div className="small mut" style={{ fontWeight: 700 }}>
          {a.sub}
        </div>
        {scopes && scopes.length > 0 && (
          <div className="seg" role="group" style={{ width: '100%' }}>
            {scopes.map((sc, i) => (
              <button key={sc.label} className={si === i ? 'on' : ''} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setSi(i)}>
                {sc.label}
              </button>
            ))}
          </div>
        )}
        <div>
          预计 {plan.calls} 次请求{cost != null ? ` · 预计费用 ${money(cost, cur)}` : ''}
        </div>
        {fit < plan.calls && <div className="warn-line">按今日剩余额度，本次最多处理前 {pages} 页。</div>}
        <div className="pr" style={{ justifyContent: 'flex-end', marginTop: 0 }}>
          <button className="btn alt sm" onClick={close}>
            取消
          </button>
          <button
            className="btn sm"
            disabled={!fit}
            onClick={() => {
              close()
              onOk(fit)
            }}
          >
            开始
          </button>
        </div>
      </div>
    </div>
  )
}

export function AIConfirm() {
  const a = useAsk((x) => x.ask)
  const seq = useAsk((x) => x.seq)
  const cur = useApp((x) => x.ai.cur)
  useApp((x) => x.usage)
  if (!a) return null
  return <ConfirmBody key={seq} a={a} cur={cur} close={() => useAsk.setState({ ask: null })} />
}
