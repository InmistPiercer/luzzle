import { useEffect, useRef, useState } from 'react'
import { isInsecureRemoteUrl, todayOf, type Tally } from '../ai/client'
import { money, priceOf, PRICE_DATE, toUSD } from '../ai/pricing'
import { PROVIDERS, providerOf } from '../ai/providers'
import type { AIConfig } from '../ai/types'
import { allDocs, demoOn } from '../content/docs'
import { today } from '../core/date'
import { desktop } from '../core/desktop'
import { IS_TEST } from '../core/edition'
import { isAttachedPhrase } from '../learn/pieces'
import { exportBackup, importBackup } from '../storage/persist'
import { useReader } from '../reader/session'
import { STYLES } from '../theme/styles'
import { useApp } from './store'

export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const data = useApp((x) => x.data)
  const ai = useApp((x) => x.ai)
  const usage = useApp((x) => x.usage)
  const { setAI, setPrefs, resetUsageTotal, update, replace, resetDemo, clearAll, nextDay, resetDay, say } = useApp.getState()
  const [draft, setDraft] = useState<AIConfig>(ai)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setDraft(useApp.getState().ai)
  }, [open])

  const ids = Object.keys(data.learn)
  const ph = ids.filter((id) => isAttachedPhrase(data, id)).length
  const spec = providerOf(draft.provider)
  const trimmedBase = draft.baseUrl.trim()
  const insecureUrl = !!trimmedBase && isInsecureRemoteUrl(trimmedBase)
  const day = todayOf(usage, today())
  const price = priceOf({ ...ai, ...draft }, spec.model)
  const dirty = draft.provider !== ai.provider || draft.baseUrl.trim() !== ai.baseUrl || draft.model.trim() !== ai.model || draft.apiKey.trim() !== ai.apiKey
  const saveDraft = () => setAI({ provider: draft.provider, baseUrl: draft.baseUrl.trim(), model: draft.model.trim(), apiKey: draft.apiKey.trim() })
  const closeModal = () => {
    if (dirty) saveDraft()
    onClose()
  }
  const capped = !!price && ai.budget > 0
  const fill = capped ? day.cost / toUSD(ai.budget, ai.cur) : day.req / Math.max(1, ai.dailyLimit)
  const tally = (t: Tally) => `${t.req} 次 · 输入 ${t.inTok.toLocaleString()} / 输出 ${t.outTok.toLocaleString()} tokens${price ? ` · 约 ${money(t.cost, ai.cur)}` : ''}`

  const doExport = () => {
    const url = URL.createObjectURL(new Blob([exportBackup(data)], { type: 'application/json' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `luzzle-backup-${today()}.json` })
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    say('已导出')
  }

  const doImport = (f: File | undefined) => {
    if (!f) return
    f.text()
      .then(async (t) => {
        const restored = importBackup(t)
        const before = useApp.getState().data
        if (!window.confirm(`恢复后将替换当前文章和词库。备份中有 ${restored.docs.length} 篇导入文章、${Object.keys(restored.learn).length} 个学习条目。继续恢复？`)) return
        if (Object.keys(restored.learn).length === 0 && Object.keys(before.learn).length > 0 && !window.confirm('备份词库为空，恢复后将清空当前已有的学习记录。确定继续？')) return
        if (!await replace(restored)) return
        const applied = useApp.getState().data
        say('已恢复', () => {
          if (useApp.getState().data !== applied && !window.confirm('撤销恢复也会替换刚才新增的改动。继续？')) return
          void replace(before).then((ok) => ok && say('已撤销恢复'))
        })
      })
      .catch(() => say('无效的备份文件'))
  }

  return (
    <div className={`modal-bg${open ? ' open' : ''}`} id="set-modal" onClick={(e) => e.target === e.currentTarget && closeModal()}>
      <div className="modal" role="dialog" aria-label="设置">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>设置</h3>
          <button className="x-btn" aria-label="关闭" onClick={closeModal}>
            ×
          </button>
        </div>

        <div className="set-sec" style={{ borderTop: 0, paddingTop: 0 }}>
          <h4>视觉风格</h4>
          <div className="style-cards">
            {STYLES.map((st) => (
              <button key={st.id} className={`style-card${data.prefs.style === st.id ? ' on' : ''}`} onClick={() => setPrefs({ style: st.id })}>
                <span className="sw">
                  {st.sw.map((c) => (
                    <i key={c} style={{ background: c }} />
                  ))}
                </span>
                <span className="nm">
                  <b>{st.name}</b>
                  <small>{st.sub}</small>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="set-sec">
          <h4>学习节奏</h4>
          <div className="set-row">
            <label className="small mut" style={{ fontWeight: 700 }}>
              每日新词{' '}
              <input
                type="number"
                min={1}
                max={50}
                value={data.caps.newDaily}
                style={{ width: 64 }}
                onChange={(e) => update((d) => ({ ...d, caps: { ...d.caps, newDaily: Math.max(1, Math.min(50, Number(e.target.value) || 10)) } }))}
              />
            </label>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="small mut" style={{ fontWeight: 700 }}>
                新词目标
              </span>
              <div className="seg" role="group" aria-label="新词默认目标">
                {(
                  [
                    ['read', '读懂'],
                    ['use', '会用'],
                  ] as const
                ).map(([g, lb]) => (
                  <button key={g} className={(data.prefs.defaultGoal || 'read') === g ? 'on' : ''} onClick={() => setPrefs({ defaultGoal: g })}>
                    {lb}
                  </button>
                ))}
              </div>
            </div>
            {IS_TEST && (
              <>
                <span className="small mut" style={{ fontWeight: 700, marginLeft: 'auto' }}>
                  今天{' '}
                  <b>
                    {today()}
                    {data.dayOffset ? `（+${data.dayOffset}）` : ''}
                  </b>
                </span>
                <button className="btn alt sm" onClick={nextDay}>
                  模拟次日
                </button>
                <button className="btn alt sm" onClick={resetDay}>
                  回到今天
                </button>
              </>
            )}
          </div>
        </div>

        <div className="set-sec">
          <h4>AI 接口</h4>
          <div className="set-row">
            <select aria-label="接口格式" value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: providerOf(e.target.value).id })}>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <div className="seg" role="group" aria-label="币种">
              {(['CNY', 'USD'] as const).map((c) => (
                <button key={c} className={ai.cur === c ? 'on' : ''} onClick={() => setAI({ cur: c })}>
                  {c === 'CNY' ? '¥' : '$'}
                </button>
              ))}
            </div>
            {price ? (
              <label className="small mut" style={{ fontWeight: 700 }}>
                每日预算{' '}
                <input type="number" min={0} step={0.5} value={ai.budget} style={{ width: 72 }} onChange={(e) => setAI({ budget: Math.max(0, Number(e.target.value) || 0) })} />
              </label>
            ) : (
              <label className="small mut" style={{ fontWeight: 700 }}>
                每日上限{' '}
                <input type="number" min={5} max={500} value={ai.dailyLimit} style={{ width: 72 }} onChange={(e) => setAI({ dailyLimit: Math.max(5, Number(e.target.value) || 30) })} />
              </label>
            )}
          </div>
          <div className="set-row" style={{ width: '100%' }}>
            <input
              type="text"
              className="forge-input"
              style={{ flex: 1.4, font: '13px var(--ui)', padding: '8px 12px' }}
              placeholder={`Base URL: ${spec.baseUrl}`}
              value={draft.baseUrl}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            />
            <input
              type="text"
              className="forge-input"
              style={{ flex: 1, font: '13px var(--ui)', padding: '8px 12px' }}
              placeholder={`Model: ${spec.model}`}
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            />
          </div>
          {insecureUrl && <div className="small warn-line">远端接口请使用 https://，避免密钥与阅读文本明文传输</div>}
          <div className="small mut" id="ai-price" style={{ fontWeight: 700 }}>
            {price && !price.custom
              ? `${price.label} · 每百万 tokens 输入 ${money(price.in, ai.cur)} / 输出 ${money(price.out, ai.cur)}${price.peak ? ' · 峰时价' : ''} · ${PRICE_DATE}`
              : price
                ? '自定义单价'
                : '未匹配到预设单价（可手动填写）'}
          </div>
          <div className="set-row">
            <label className="small mut" style={{ fontWeight: 700 }}>
              自定义单价（{ai.cur === 'CNY' ? '¥' : '$'}/百万 tokens）输入{' '}
              <input type="number" min={0} step={0.01} value={ai.price?.in || ''} style={{ width: 64 }} onChange={(e) => setAI({ price: { in: Number(e.target.value) || 0, out: ai.price?.out || 0 } })} />
            </label>
            <label className="small mut" style={{ fontWeight: 700 }}>
              输出{' '}
              <input type="number" min={0} step={0.01} value={ai.price?.out || ''} style={{ width: 64 }} onChange={(e) => setAI({ price: { in: ai.price?.in || 0, out: Number(e.target.value) || 0 } })} />
            </label>
          </div>
          <input
            type="password"
            className="forge-input"
            style={{ font: '13px var(--ui)', padding: '8px 12px' }}
            placeholder="API Key: sk-..."
            autoComplete="new-password"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            data-1p-ignore="true"
            data-lpignore="true"
            value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
          />
          {desktop && <div className="small mut" style={{ fontWeight: 700 }}>密钥由系统钥匙串加密保存，不写入明文词库</div>}
          <div id="ai-usage">
            <div className="small mut" style={{ fontWeight: 700, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>今日</span>
              <span>{tally(day)}</span>
            </div>
            <div className="bar">
              <i style={{ width: `${Math.min(100, fill * 100)}%` }} />
            </div>
            <div className="small mut" style={{ fontWeight: 700, display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6, alignItems: 'center' }}>
              <span>累计（{usage.total.since} 起）</span>
              <span>
                {tally(usage.total)}{' '}
                <button className="link" onClick={resetUsageTotal}>
                  清零统计
                </button>
              </span>
            </div>
          </div>
          <div className="pr" style={{ marginTop: 0 }}>
            <button
              className={dirty ? 'btn sm' : 'btn alt sm'}
              onClick={() => {
                saveDraft()
                say('已保存')
              }}
            >
              保存配置
            </button>
            {!!(ai.apiKey || draft.apiKey) && (
              <button
                className="btn alt sm"
                onClick={() => {
                  setDraft({ ...draft, apiKey: '' })
                  setAI({ apiKey: '' })
                  say('已清除 API Key')
                }}
              >
                清除 Key
              </button>
            )}
          </div>
        </div>
        <div className="set-sec">
          <h4>
            本地数据{' '}
            <em>
              <span className="save-dot" /> 自动保存
            </em>
          </h4>
          <div className="card" id="set-stats">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span>
                <b>{ids.length - ph}</b> 核心词 · <b>{ph}</b> 挂靠短语 · <b>{ids.filter((k) => data.learn[k].stage === 5).length}</b> 运用
              </span>
              <span>
                <b>{allDocs(data).length}</b> 文章 · <b>{data.vaults.length}</b> 仓库
              </span>
            </div>
          </div>
          <div className="pr" style={{ marginTop: 4 }}>
            <button className="btn sm" onClick={doExport}>
              导出备份 (.json)
            </button>
            <button className="btn alt sm" onClick={() => file.current?.click()}>
              恢复备份
            </button>
            {desktop && (
              <button className="btn alt sm" onClick={() => void desktop?.openBackupsFolder()}>
                自动备份目录
              </button>
            )}
            {IS_TEST && demoOn(data) && (
              <button
                className="btn alt sm"
                style={{ marginLeft: 'auto' }}
                onClick={() => {
                  onClose()
                  useApp.setState({ demoAsk: 'settings' })
                }}
              >
                清除演示内容
              </button>
            )}
            {IS_TEST && (
              <button
                className="btn alt sm"
                style={demoOn(data) ? undefined : { marginLeft: 'auto' }}
                onClick={() => {
                  resetDemo()
                  say('已恢复演示数据')
                }}
              >
                重置演示
              </button>
            )}
            <button
              className="btn sm danger-btn"
              style={IS_TEST ? undefined : { marginLeft: 'auto' }}
              onClick={async () => {
                if (!window.confirm('清空全部文章、拼块与学习记录，从空白状态开始？（可通过撤销或备份恢复）')) return
                const before = useApp.getState().data
                useReader.getState().set({ cur: null, sel: null, po: false, ctx: false, ann: null })
                onClose()
                const restore = await clearAll()
                say('已清空全部数据', () => void replace(before).then(restore))
              }}
            >
              清空数据
            </button>
            <input
              ref={file}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                doImport(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>
        </div>

        <div className="small mut" style={{ textAlign: 'center', fontWeight: 700, paddingTop: 4 }}>
          Luzzle v1.0.0{desktop ? ' · 桌面版' : ''}{IS_TEST ? ' · 测试版' : ''}
          <div className="data-src">词典 ECDICT（MIT）· 词素 MorphoLex-EN（Sánchez-Gutiérrez et al., 2018）、MorphyNet（CC BY-SA 3.0，源自 Wiktionary）· 例句 Tatoeba（CC BY 2.0 FR）</div>
        </div>
      </div>
    </div>
  )
}
