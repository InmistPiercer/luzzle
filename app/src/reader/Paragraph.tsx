import { memo } from 'react'
import type { AppState, Para } from '../core/types'
import { POS_CLS } from '../pieces/Piece'
import { paraNodes, type SepSpan, type WordSpan } from './text'

const Word = ({ n, sel, picked }: { n: WordSpan; sel: boolean; picked: boolean }) => {
  const cls = n.pc || n.stage > 0 ? `${POS_CLS[n.pos] || ''} ${n.pos === 'phrase' ? 'ph' : 'm'} s${n.stage}` : POS_CLS[n.pos] || ''
  return (
    <span className={`w ${cls}${sel ? ' sel' : ''}${picked ? ' ph-pick' : ''}`} role="button" tabIndex={-1} data-w={n.lw} data-wi={n.wi} data-pc={n.pc || undefined}>
      {n.text}
    </span>
  )
}

const Leaf = ({ n, selWi, pickWis }: { n: WordSpan | SepSpan; selWi: number | null; pickWis: number[] | null }) =>
  n.kind === 'w' ? <Word n={n} sel={n.wi === selWi} picked={!!pickWis?.includes(n.wi)} /> : n.cite ? <span className="cite">{n.text}</span> : <>{n.text}</>

export const ParaText = memo(function ParaText({ data, p, rebuilt, selWi, pickWis = null }: { data: AppState; dictSeq?: number; p: Para; rebuilt: boolean; selWi: number | null; pickWis?: number[] | null }) {
  return (
    <>
      {paraNodes(data, p, rebuilt).map((n, i) =>
        n.kind === 'ann' ? (
          <span key={i} className="ann-seg" data-pid={p.id} data-hl={n.hl}>
            {n.items.map((x, j) => (
              <Leaf key={j} n={x} selWi={selWi} pickWis={pickWis} />
            ))}
          </span>
        ) : (
          <Leaf key={i} n={n} selWi={selWi} pickWis={pickWis} />
        ),
      )}
    </>
  )
})
