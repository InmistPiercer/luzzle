import { useState } from 'react'
import { useApp } from '../app/store'
import { blankOf, maskPhrase, phN, PH_DONE, phraseTokens, taskOfPhrase } from '../learn/phrase'
import { meaningOf, norm, shuffle, srcSentence } from './logic'
import { Ans, Reveal } from './quiz'

export function PhraseDots({ n }: { n: number }) {
  return (
    <span className="ph-dots" aria-label={`${n} / ${PH_DONE}`}>
      {Array.from({ length: PH_DONE }, (_, i) => (
        <span key={i} className={i < n ? 'on' : ''} />
      ))}
    </span>
  )
}

export function PhraseCard({ id, core, onAnswer, onNext }: { id: string; core: string; onAnswer: (ok: boolean) => void; onNext: () => void }) {
  const d = useApp((x) => x.data)
  const e = d.pieces[id]
  const r = d.learn[id]
  const [task] = useState(() => taskOfPhrase(r))
  const [picked, setPicked] = useState<number[]>([])
  const [input, setInput] = useState('')
  const [out, setOut] = useState<boolean | null>(null)
  if (!e || !r) return null
  const toks = phraseTokens(e.lemma)
  const defLang = d.prefs.defLang || 'en'
  const rawMean = meaningOf(e, defLang)
  const zh = defLang === 'en' && /[\u4e00-\u9fff]/.test(rawMean) ? '' : rawMean
  const masked = maskPhrase(srcSentence(d, id), e.lemma)
  const blank = blankOf(e.lemma, core)
  const pool = (() => {
    const sh = shuffle(
      toks.map((t, i) => [t, i] as const),
      id + r.ph?.last,
    )
    if (new Set(toks).size >= 2 && sh.every(([t], idx) => t === toks[idx])) {
      const j = sh.findIndex(([t]) => t !== sh[0][0])
      if (j > 0) {
        const copy = [...sh]
        ;[copy[0], copy[j]] = [copy[j], copy[0]]
        return copy
      }
    }
    return sh
  })()

  const finish = (ok: boolean) => {
    if (out !== null) return
    setOut(ok)
    onAnswer(ok)
  }
  const pick = (i: number) => {
    if (out !== null || picked.includes(i)) return
    const next = [...picked, i]
    setPicked(next)
    if (next.length === toks.length) finish(next.map((j) => toks[j]).join(' ') === toks.join(' '))
  }
  const submit = () => {
    const v = norm(input).replace(/[…]|\.{3}/g, ' ').replace(/\s+/g, ' ').trim()
    if (!v || out !== null) return
    if (task === 'complete') return finish(v === toks[blank])
    const words = v.split(' ')
    const matchToks =
      words.length === toks.length &&
      toks.every((t, i) =>
        words[i] === t ||
        (t === "one's" && /^(?:my|your|his|her|its|our|their|one's)$/.test(words[i])) ||
        (t === 'oneself' && /^(?:myself|yourself|himself|herself|itself|ourselves|yourselves|themselves|oneself)$/.test(words[i])),
      )
    finish(matchToks)
  }

  return (
    <>
      <div className="f-trk ph-trk">
        <span>短语</span>
        <PhraseDots n={phN(r)} />
      </div>
      {zh && <div className="ph-mean">{zh}</div>}
      {masked && (
        <div className="card" style={{ font: '16.5px/1.85 var(--read)' }}>
          “{masked}”
        </div>
      )}
      {task === 'order' && (
        <>
          <div className="ph-slots">
            {toks.map((_, i) => (
              <span key={i} className={`ph-slot${picked[i] !== undefined ? ' on' : ''}`} onClick={() => out === null && i === picked.length - 1 && setPicked(picked.slice(0, -1))}>
                {picked[i] !== undefined ? toks[picked[i]] : ''}
              </span>
            ))}
          </div>
          <div className="ph-pool">
            {pool.map(([t, i]) => (
              <button key={i} className="ph-blk" disabled={picked.includes(i) || out !== null} onClick={() => pick(i)}>
                {t}
              </button>
            ))}
          </div>
        </>
      )}
      {task === 'complete' && (
        <div className="ph-line">
          {toks.map((t, i) =>
            i === blank ? (
              <input
                key={i}
                className="forge-input ph-in"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                disabled={out !== null}
                value={input}
                onChange={(ev) => setInput(ev.target.value)}
                onKeyDown={(ev) => ev.key === 'Enter' && submit()}
                style={{ width: `${Math.max(6, t.length + 4)}ch` }}
              />
            ) : (
              <b key={i}>{t}</b>
            ),
          )}
        </div>
      )}
      {task === 'write' && (
        <div className="recall-row">
          <input className="forge-input" autoFocus autoComplete="off" spellCheck={false} disabled={out !== null} value={input} onChange={(ev) => setInput(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && submit()} />
          <button className="btn" disabled={out !== null} onClick={submit}>
            提交
          </button>
        </div>
      )}
      {out === null && (
        <div className="pr" style={{ marginTop: 0 }}>
          {task === 'complete' && (
            <button className="btn" onClick={submit}>
              提交
            </button>
          )}
          <button className="btn alt sm" onClick={() => finish(false)}>
            看答案
          </button>
        </div>
      )}
      {out === true && <div className="fb-card ok">{e.lemma}</div>}
      {out === false && (
        <Reveal onNext={onNext}>
          <Ans v={e.lemma} />
        </Reveal>
      )}
    </>
  )
}
