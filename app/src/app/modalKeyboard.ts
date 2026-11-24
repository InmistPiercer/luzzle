import { useEffect } from 'react'

const modalSelector = '.modal-bg.open > .modal[role="dialog"]'
const focusSelector = 'button, input, select, textarea, a[href], [tabindex]'
const focusable = (modal: HTMLElement) =>
  Array.from(modal.querySelectorAll<HTMLElement>(focusSelector)).filter(
    (node) => node.tabIndex >= 0 && !node.matches(':disabled') && node.getClientRects().length > 0,
  )

export function useModalKeyboard() {
  useEffect(() => {
    let current: HTMLElement | undefined
    let previous: HTMLElement | undefined
    const synchronize = () => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>(modalSelector)).filter((node) => node.getClientRects().length > 0)
      const next = dialogs.at(-1)
      if (next === current) return
      current?.removeAttribute('aria-modal')
      if (!current && next && document.activeElement instanceof HTMLElement && !next.contains(document.activeElement)) previous = document.activeElement
      current = next
      if (next) {
        next.setAttribute('aria-modal', 'true')
        if (!next.contains(document.activeElement)) (focusable(next)[0] || next).focus()
      } else {
        if (previous?.isConnected) previous.focus()
        previous = undefined
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (!current) return
      if (event.key === 'Escape') {
        if (event.isComposing) return
        const close = current.querySelector<HTMLButtonElement>('[data-dialog-cancel], .x-btn')
        if (!close) return
        event.preventDefault()
        event.stopPropagation()
        close.click()
        return
      }
      if (event.key !== 'Tab') return
      const nodes = focusable(current)
      const first = nodes[0]
      const last = nodes.at(-1)
      const active = document.activeElement
      if (!current.contains(active) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first)?.focus()
      }
    }
    const observe = new MutationObserver(synchronize)
    observe.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    document.addEventListener('keydown', onKey, true)
    synchronize()
    return () => {
      observe.disconnect()
      document.removeEventListener('keydown', onKey, true)
    }
  }, [])
}
