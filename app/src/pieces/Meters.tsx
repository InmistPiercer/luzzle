import { diffDays } from '../core/date'
import type { LearnRecord, Sched } from '../core/types'
import { POLICY_CONFIG } from '../learn/policy'
import { isDue, stabilityOf } from '../learn/scheduler'

export const whenOf = (c: Sched | undefined, day: string) => (!c ? '未开始' : isDue(c, day) ? '今天' : `${diffDays(c.due, day)} 天后`)

function MeterRow({ label, c, day, stash }: { label: string; c: Sched | undefined; day: string; stash?: boolean }) {
  return (
    <div className="meter-row">
      <span>{label}</span>
      <i>
        <b style={{ width: `${Math.min(100, (stabilityOf(c) / POLICY_CONFIG.mixAt) * 100)}%` }} />
      </i>
      <em>{stash ? '暂存' : whenOf(c, day)}</em>
    </div>
  )
}

export function Meters({ r, day }: { r: LearnRecord; day: string }) {
  const row = (label: string, c: Sched | undefined) => <MeterRow label={label} c={c} day={day} stash={r.goal === 'stash'} />
  return (
    <div className="meters">
      {row('词义', r.sched)}
      {r.goal === 'use' && row('词形', r.form)}
    </div>
  )
}
