import type { ReactNode } from 'react'

export function Choices({ opts, onPick, wrong = [], right = null, lock = false, shake = false }: { opts: string[]; onPick: (o: string) => void; wrong?: string[]; right?: string | null; lock?: boolean; shake?: boolean }) {
  return (
    <div className={`mo-list${shake ? ' shake' : ''}`}>
      {opts.map((o) => (
        <button key={o} className={`mo${right === o ? ' right' : wrong.includes(o) ? ' wrong' : ''}`} disabled={wrong.includes(o) || (lock && right !== o)} onClick={() => onPick(o)}>
          {o}
        </button>
      ))}
    </div>
  )
}

export const Ans = ({ v, label = '答案' }: { v: ReactNode; label?: string }) => (
  <>
    {label}：<b>{v}</b>
  </>
)

const NextBtn = ({ onClick }: { onClick: () => void }) => (
  <button className="btn sm" onClick={onClick}>
    下一个
  </button>
)

export function Reveal({ children, actions, onNext }: { children: ReactNode; actions?: ReactNode; onNext?: () => void }) {
  return (
    <div className="fb-hint" role="status" aria-live="polite">
      <span>{children}</span>
      {actions}
      {onNext && <NextBtn onClick={onNext} />}
    </div>
  )
}
