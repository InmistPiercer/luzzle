import type { StyleId } from '../core/types'

export interface StyleDef {
  id: StyleId
  name: string
  sub: string
  sw: [string, string, string]
  forge: string
}

export const STYLES: StyleDef[] = [
  { id: 'classic', name: '积木岛屿', sub: '白天 · 圆润积木', sw: ['#E2DBFF', '#6B4EF6', '#FF6F8E'], forge: '拼装' },
  { id: 'amber', name: '琥珀终端', sub: '夜间 · 荧光终端', sw: ['#0b0704', '#ffb238', '#ffe2a8'], forge: '编译' },
  { id: 'neon', name: '霓虹暗房', sub: '夜间 · 灯管霓虹', sw: ['#17121f', '#4CE0B3', '#ff4fa3'], forge: '显影' },
  { id: 'draft', name: '制图台', sub: '白天 · 蓝图制图', sw: ['#eef3fb', '#1f4fa8', '#D04066'], forge: '制图' },
]

export const styleOf = (id: StyleId) => STYLES.find((s) => s.id === id) || STYLES[0]

export function normStyle(style: unknown, palette?: unknown): StyleId {
  if (style === 'riso' || (style === 'classic' && palette === 'night') || (style === 'draft' && palette === 'cyanotype')) return 'neon'
  return STYLES.some((s) => s.id === style) ? (style as StyleId) : 'classic'
}
