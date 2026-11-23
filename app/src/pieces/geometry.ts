export function bodyBox(el: Element, wu = 100) {
  const r = el.getBoundingClientRect()
  const sc = Math.min(r.width / (wu + 48), r.height / 154)
  const padX = (r.width - (wu + 48) * sc) / 2
  return { l: r.left + padX + 24 * sc, r: r.left + padX + (24 + wu) * sc, t: r.top + 22 * sc, sc }
}
