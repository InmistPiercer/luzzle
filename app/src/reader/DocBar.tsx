import { useEffect, useRef, useState } from 'react'
import { useApp } from '../app/store'
import { allDocs, deleteVault, docsInVault, moveDoc, renameDoc, renameVault } from '../content/docs'
import { cleanupLater, removeDocWithUndo } from './docActions'
import type { AppState, DocData } from '../core/types'
import { paginate } from './paginate'
import { useReader } from './session'

type VaultModal = { kind: 'new' | 'rename'; i: number; name: string } | null

const progressOf = (d: DocData, len: AppState['prefs']['pageLen']) => {
  const n = paginate(d, len || 'mid').length
  const p = Math.min(Math.max(0, d.page || 0), n - 1)
  return { n, p: p + 1, pct: n > 1 ? (p / (n - 1)) * 100 : d.page != null ? 100 : 0 }
}

export function DocBar({ doc, onPick, onImport }: { doc: DocData | undefined; onPick: (id: string) => void; onImport: () => void }) {
  const data = useApp((x) => x.data)
  const update = useApp((x) => x.update)
  const say = useApp((x) => x.say)
  const [menu, setMenu] = useState(false)
  const [list, setList] = useState(false)
  const [modal, setModal] = useState<VaultModal>(null)
  const [delV, setDelV] = useState<number | null>(null)
  const [moveTo, setMoveTo] = useState(0)
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const docs = allDocs(data)
  const vault = data.vaults[data.curVault] || data.vaults[0]
  const inVault = docs.filter((d) => d.vault === data.curVault)
  const countOf = (i: number) => docs.filter((d) => d.vault === i).length

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element
      if (!t.isConnected) return
      if (!t.closest('#vault-menu,#vault-btn')) setMenu(false)
      if (!t.closest('#doc-list,#doc-btn')) {
        setList(false)
        setEditing(null)
        setMoving(null)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setMenu(false)
      setList(false)
      setModal(null)
      setDelV(null)
      setEditing(null)
      setMoving(null)
    }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    if (list) listRef.current?.querySelector('.doc-row.on')?.scrollIntoView({ block: 'nearest' })
  }, [list])

  const switchVault = (i: number) => {
    setMenu(false)
    useReader.getState().set({ sel: null, po: false, ctx: false, ann: null })
    update((d) => ({ ...d, curVault: i }))
  }

  const saveModal = () => {
    if (!modal) return
    const name = modal.name.trim()
    if (!name) return
    if (modal.kind === 'new') update((d) => ({ ...d, vaults: [...d.vaults, { name }], curVault: d.vaults.length }))
    else update((d) => renameVault(d, modal.i, name))
    setModal(null)
  }

  const confirmDelVault = (mode: 'delete' | 'move') => {
    if (delV == null) return
    const before = useApp.getState().data
    const snap = { vaults: before.vaults, docs: before.docs, docState: before.docState, curVault: before.curVault }
    const name = before.vaults[delV]?.name || ''
    const gone = mode === 'delete' ? docsInVault(before, delV) : []
    update((d) => deleteVault(d, delV, mode === 'move' ? moveTo : null))
    useReader.getState().set({ cur: null, sel: null, po: false, ctx: false, ann: null })
    setDelV(null)
    say(`已删除仓库「${name}」`, () => useApp.getState().update((x) => ({ ...x, ...snap })))
    gone.forEach(cleanupLater)
  }

  const askDelVault = (i: number) => {
    setMenu(false)
    if (data.vaults.length <= 1) return say('至少保留一个仓库')
    if (!countOf(i)) {
      setDelV(i)
      return
    }
    setMoveTo(i === 0 ? 1 : 0)
    setDelV(i)
  }

  const saveTitle = () => {
    if (!editing) return
    const t = editing.title.trim()
    if (t) update((d) => renameDoc(d, editing.id, t))
    setEditing(null)
  }

  const pageLen = data.prefs.pageLen
  const delCount = delV == null ? 0 : countOf(delV)

  return (
    <>
      <button className="vault-pill" id="vault-btn" aria-haspopup="menu" onClick={() => setMenu((m) => !m)}>
        <span className="vi" id="vault-ic">
          {vault.name[0]}
        </span>
        <span id="vault-name">{vault.name}</span>
        <span className="vault-n">{inVault.length}</span>
        <span className="car">▾</span>
      </button>
      <div className="doc-pick">
        {doc ? (
          <button className="tab on doc-btn" id="doc-btn" title={doc.title} aria-haspopup="listbox" aria-expanded={list} onClick={() => setList((v) => !v)}>
            <span className="doc-btn-t">{doc.title}</span>
            <span className="car">▾</span>
          </button>
        ) : null}
        <div className={`doc-list${list ? ' open' : ''}`} id="doc-list" ref={listRef} role="listbox">
          {list &&
            inVault.map((d) => {
              const pr = progressOf(d, pageLen)
              const on = d.id === doc?.id
              if (editing?.id === d.id)
                return (
                  <div key={d.id} className="doc-row editing">
                    <input
                      className="forge-input"
                      autoFocus
                      value={editing.title}
                      onChange={(e) => setEditing({ id: d.id, title: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveTitle()
                        if (e.key === 'Escape') {
                          e.stopPropagation()
                          setEditing(null)
                        }
                      }}
                    />
                    <button className="btn sm" onClick={saveTitle}>
                      保存
                    </button>
                  </div>
                )
              return (
                <div key={d.id} className={`doc-row${on ? ' on' : ''}`}>
                  <button
                    className="doc-main"
                    role="option"
                    aria-selected={on}
                    onClick={() => {
                      setList(false)
                      onPick(d.id)
                    }}
                  >
                    <span className="doc-t">{d.title}</span>
                    <span className="doc-pr">
                      <i style={{ width: `${pr.pct}%` }} />
                    </span>
                    <span className="doc-pn">
                      {pr.p}/{pr.n}
                    </span>
                  </button>
                  <span className="doc-acts">
                    <button onClick={() => setEditing({ id: d.id, title: d.title })}>改名</button>
                    {data.vaults.length > 1 && <button onClick={() => setMoving((m) => (m === d.id ? null : d.id))}>移到</button>}
                    <button className="danger" onClick={() => removeDocWithUndo(d.id)}>
                      删除
                    </button>
                  </span>
                  {moving === d.id && (
                    <div className="doc-move">
                      {data.vaults.map((v, i) =>
                        i === d.vault ? null : (
                          <button
                            key={i}
                            onClick={() => {
                              setMoving(null)
                              update((x) => moveDoc(x, d.id, i))
                              say(`已移到「${v.name}」`)
                            }}
                          >
                            {v.name}
                          </button>
                        ),
                      )}
                    </div>
                  )}
                </div>
              )
            })}
        </div>
      </div>
      <button className="tab add" id="imp-btn" style={{ flex: 'none' }} onClick={onImport}>
        ＋ 导入
      </button>

      <div className={`vault-menu${menu ? ' open' : ''}`} id="vault-menu" role="menu">
        {data.vaults.map((v, i) => (
          <div key={i} className={`vault-row${i === data.curVault ? ' on' : ''}`}>
            <button className={i === data.curVault ? 'on' : ''} onClick={() => switchVault(i)}>
              {v.name} <span>{countOf(i)}</span>
            </button>
            <span className="vault-acts">
              <button
                aria-label={`重命名 ${v.name}`}
                onClick={() => {
                  setMenu(false)
                  setModal({ kind: 'rename', i, name: v.name })
                }}
              >
                改名
              </button>
              {data.vaults.length > 1 && (
                <button className="danger" aria-label={`删除 ${v.name}`} onClick={() => askDelVault(i)}>
                  删除
                </button>
              )}
            </span>
          </div>
        ))}
        <button
          className="add"
          onClick={() => {
            setMenu(false)
            setModal({ kind: 'new', i: -1, name: `仓库 ${data.vaults.length + 1}` })
          }}
        >
          ＋ 新建仓库
        </button>
      </div>

      <div className={`modal-bg${modal ? ' open' : ''}`} id="vault-modal" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
        <div className="modal" role="dialog" aria-label={modal?.kind === 'rename' ? '重命名仓库' : '新建仓库'} style={{ width: 'min(380px,92vw)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>{modal?.kind === 'rename' ? '重命名仓库' : '新建仓库'}</h3>
            <button className="x-btn" aria-label="关闭" onClick={() => setModal(null)}>
              ×
            </button>
          </div>
          <input
            type="text"
            className="forge-input"
            placeholder="输入仓库名称"
            value={modal?.name || ''}
            onChange={(e) => modal && setModal({ ...modal, name: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && saveModal()}
          />
          <div className="pr" style={{ justifyContent: 'flex-end', marginTop: 0 }}>
            <button className="btn alt sm" onClick={() => setModal(null)}>
              取消
            </button>
            <button className="btn sm" onClick={saveModal}>
              {modal?.kind === 'rename' ? '保存' : '创建'}
            </button>
          </div>
        </div>
      </div>

      <div className={`modal-bg${delV != null ? ' open' : ''}`} id="vault-del" onClick={(e) => e.target === e.currentTarget && setDelV(null)}>
        <div className="modal" role="dialog" aria-label="删除仓库" style={{ width: 'min(400px,92vw)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>删除仓库「{delV != null ? data.vaults[delV]?.name : ''}」</h3>
            <button className="x-btn" aria-label="关闭" onClick={() => setDelV(null)}>
              ×
            </button>
          </div>
          {delCount > 0 ? (
            <>
              <div className="vdel-opt">
                <button className="btn alt sm" onClick={() => confirmDelVault('move')}>
                  {delCount} 篇文章移到
                </button>
                <select aria-label="目标仓库" value={moveTo} onChange={(e) => setMoveTo(Number(e.target.value))}>
                  {data.vaults.map((v, i) =>
                    i === delV ? null : (
                      <option key={i} value={i}>
                        {v.name}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div className="pr" style={{ justifyContent: 'flex-end', marginTop: 0 }}>
                <button className="btn alt sm" onClick={() => setDelV(null)}>
                  取消
                </button>
                <button className="btn sm danger-btn" onClick={() => confirmDelVault('delete')}>
                  连同 {delCount} 篇文章删除
                </button>
              </div>
            </>
          ) : (
            <div className="pr" style={{ justifyContent: 'flex-end', marginTop: 0 }}>
              <button className="btn alt sm" onClick={() => setDelV(null)}>
                取消
              </button>
              <button className="btn sm danger-btn" onClick={() => confirmDelVault('delete')}>
                删除
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
