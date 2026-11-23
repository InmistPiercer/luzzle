const ONE_SHOT: Record<string, string> = {
  jumpHl: 'jump-hl',
  snapPop: 'snapped',
  popFree: 'pop-free',
  hop: 'hop',
  pn: 'new',
}

export function installOneShotCleanup(doc: Document = document) {
  const done = (e: Event) => {
    const c = ONE_SHOT[(e as AnimationEvent).animationName]
    const t = e.target as Element | null
    if (!c || !t?.classList) return
    if (t.classList.contains(c)) t.classList.remove(c)
    else t.parentElement?.classList.remove(c)
  }
  doc.addEventListener('animationend', done)
  doc.addEventListener('animationcancel', done)
}
