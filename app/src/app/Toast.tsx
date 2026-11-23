import { useEffect, useState } from 'react'
import { useApp } from './store'

export function Toast() {
  const toast = useApp((x) => x.toast)
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!toast.seq) return
    setShow(true)
    const t = setTimeout(() => setShow(false), toast.undo ? 4200 : 2200)
    return () => clearTimeout(t)
  }, [toast])
  return (
    <div id="toast" role="status" className={`${show ? 'show' : ''}${show && toast.undo ? ' has-act' : ''}`}>
      <span>{toast.msg}</span>
      {toast.undo && (
        <button
          className="toast-act"
          onClick={() => {
            setShow(false)
            toast.undo?.()
          }}
        >
          {toast.act || '撤销'}
        </button>
      )}
    </div>
  )
}
