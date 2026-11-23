import type { DocData } from '../core/types'

export function parseTextDoc(text: string, fileName: string, vault: number, now = Date.now()): DocData {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r/g, '')
  const title = (clean.match(/^#\s+(.+)$/m)?.[1] || fileName.replace(/\.\w+$/, '')).trim()
  const id = 'u' + now.toString(36)
  const paras: DocData['paras'] = []
  let titleDone = false
  clean
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean)
    .forEach((x, i) => {
      const lines = x.split('\n')
      let sub = 0
      let body: string[] = []
      const addBody = () => {
        if (!body.length) return
        const suffix = sub++ ? `-${sub}` : ''
        paras.push({ id: `${id}-P${i + 1}${suffix}`, raw: '', t: body.join(' ').trim() })
        body = []
      }
      for (const line of lines) {
        const heading = /^(#{1,6})[ \t]+(.+)$/.exec(line)
        if (heading) {
          addBody()
          if (heading[1].length === 1 && !titleDone) titleDone = true
          else paras.push({ h: heading[2].trim() })
        } else body.push(line.trim())
      }
      addBody()
    })
  return { id, title, vault, rebuilt: true, cachedRebuilt: true, user: true, paras }
}
