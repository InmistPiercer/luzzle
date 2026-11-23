import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [input = 'raw/ecdict.csv', outDir = 'public/dict'] = process.argv.slice(2)

function* rows(text) {
  let i = 0
  const n = text.length
  while (i < n) {
    const row = []
    for (;;) {
      let v = ''
      if (text[i] === '"') {
        i++
        for (;;) {
          const j = text.indexOf('"', i)
          if (text[j + 1] === '"') {
            v += text.slice(i, j + 1)
            i = j + 2
          } else {
            v += text.slice(i, j)
            i = j + 1
            break
          }
        }
      } else {
        let j = i
        while (j < n && text[j] !== ',' && text[j] !== '\n' && text[j] !== '\r') j++
        v = text.slice(i, j)
        i = j
      }
      row.push(v)
      if (text[i] === ',') {
        i++
        continue
      }
      if (text[i] === '\r') i++
      if (text[i] === '\n') i++
      break
    }
    yield row
  }
}

const WORD = /^[a-z][a-z'-]*( [a-z][a-z'-]*){0,3}$/i
const SINGLE = /^[a-z][a-z'-]*$/
const shards = {}
let kept = 0
let total = 0
let head = true

for (const r of rows(readFileSync(input, 'utf8'))) {
  if (head) {
    head = false
    continue
  }
  total++
  const [word, phonetic, , translation, pos, collins, oxford, tag, bnc, frq, exchange] = r
  if (!word || !translation || !WORD.test(word)) continue
  const common = Number(bnc) > 0 || Number(frq) > 0 || tag || Number(collins) > 0 || oxford === '1'
  if (!common && !SINGLE.test(word)) continue
  const tr = translation
    .split('\\n')
    .filter((l) => !l.startsWith('[网络]'))
    .slice(0, 4)
    .join('\n')
  if (!tr) continue
  const key = word.toLowerCase()
  const letter = /^[a-z]/.test(key) ? key[0] : '_'
  const entry = [phonetic, tr, pos, exchange, tag, Number(frq) || Number(bnc) || 0]
  while (entry.length && (entry.at(-1) === '' || entry.at(-1) === 0)) entry.pop()
  ;(shards[letter] ||= {})[word] = entry
  kept++
}

mkdirSync(outDir, { recursive: true })
let bytes = 0
const index = {}
for (const [letter, dict] of Object.entries(shards)) {
  const json = JSON.stringify(dict)
  bytes += json.length
  index[letter] = Object.keys(dict).length
  writeFileSync(join(outDir, `${letter}.json`), json)
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify({ source: 'ECDICT (MIT)', fields: ['phonetic', 'translation', 'pos', 'exchange', 'tag', 'freq'], index }))
console.log(`${kept}/${total} entries, ${Object.keys(shards).length} shards, ${(bytes / 1048576).toFixed(1)} MB`)
