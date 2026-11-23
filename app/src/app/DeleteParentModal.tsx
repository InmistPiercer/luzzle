import { childrenOf, lemmaOf } from '../learn/pieces'
import { executeDelete, useDeletePrompt } from './pieceActions'
import { useApp } from './store'

export function DeleteParentModal() {
  const id = useDeletePrompt((x) => x.id)
  const data = useApp((x) => x.data)
  if (!id || !data.learn[id]) return null
  const children = childrenOf(data, id)
  const close = () => useDeletePrompt.setState({ id: null })
  return (
    <div className="modal-bg open" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="删除核心词" style={{ width: 'min(400px, 92vw)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>删除「{lemmaOf(data, id)}」</h3>
          <button className="x-btn" aria-label="关闭" onClick={close}>
            ×
          </button>
        </div>
        <div className="small mut" style={{ fontWeight: 700 }}>
          {children.map((k) => lemmaOf(data, k)).join(' · ')}
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <button className="btn rose sm" onClick={() => executeDelete(id, 'all')}>
            连同短语一并删除
          </button>
          <button className="btn alt sm" onClick={() => executeDelete(id, 'keepChildren')}>
            仅删母块（短语转为独立块保留进度）
          </button>
          <button className="btn alt sm" onClick={close}>
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
