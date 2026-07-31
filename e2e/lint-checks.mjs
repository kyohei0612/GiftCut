// 確認のファイルが「無い名前」を使っていないか、走らせる前に見る。
//
// ## なぜ要るか
//
// **1行の書き忘れを、30分の通しで見つけていた。**
//
// run.mjs を17ファイルに分けたとき、前の章で作った道具が後ろの章から
// 見えなくなった。落ちるのは通しを回して30分後で、しかも1回に1つずつしか
// 出てこない。3回回して1時間半を使った。
//
// 中身は「使っている名前が、どこかで用意されているか」を見るだけ。
// 数秒で終わり、書き忘れを全部いっぺんに出す。
//
// **本物の実行より甘い。** 名前があるかしか見ないので、値が違う・順番が違うは
// 分からない。それは通しの仕事。ここは「走らせる前に落ちる分」を潰すだけ。
//
//   node e2e/lint-checks.mjs

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** JS が最初から持っている名前（用意されていなくてよい） */
const GLOBAL = new Set([
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date',
  'Promise', 'Set', 'Map', 'RegExp', 'console', 'process', 'document', 'window',
  'Error', 'parseInt', 'parseFloat', 'isNaN', 'setTimeout', 'Buffer',
  'globalThis', 'Symbol', 'undefined', 'NaN', 'Infinity'
])

/** そのファイルが自分で用意している名前を集める */
function provided(src) {
  const got = new Set()
  // 道具箱から受け取っている物
  const m = src.match(/const \{\n([\s\S]*?)\n {2}\} = C/)
  if (m) for (const l of m[1].split('\n')) got.add(l.trim().replace(/,$/, ''))
  // 読み込んでいる物
  for (const im of src.matchAll(/^import\s*\{([^}]*)\}/gm))
    for (const p of im[1].split(',')) if (p.trim()) got.add(p.trim())
  // 自分で宣言している物
  for (const d of src.matchAll(/\b(?:const|let|var)\s+(\w+)/g)) got.add(d[1])
  for (const d of src.matchAll(/function\s+(\w+)/g)) got.add(d[1])
  for (const d of src.matchAll(/catch\s*\(\s*(\w+)/g)) got.add(d[1])
  // 関数の引数
  for (const d of src.matchAll(/\(([^()]*)\)\s*=>/g))
    for (const p of d[1].split(',')) if (/^\w+$/.test(p.trim())) got.add(p.trim())
  // 分解して受けている物
  for (const d of src.matchAll(/(?:const|let)\s*\{([^}]*)\}\s*=/g))
    for (const p of d[1].split(',')) {
      const n = p.split(':').pop().trim()
      if (/^\w+$/.test(n)) got.add(n)
    }
  return got
}

/** run.mjs 側が持っている名前（ここに在るのに受け取っていない＝書き忘れ） */
function harnessNames() {
  const src = readFileSync(join(HERE, 'run.mjs'), 'utf-8')
  const out = new Set()
  for (const m of src.matchAll(/^import\s*\{([^}]*)\}/gm))
    for (const p of m[1].split(',')) {
      const n = p.trim().split(' as ').pop().trim()
      if (/^\w+$/.test(n)) out.add(n)
    }
  for (const m of src.matchAll(/^(?:const|let|var)\s+(.+?)\s*=/gm))
    for (const p of m[1].split(',')) if (/^\w+$/.test(p.trim())) out.add(p.trim())
  for (const m of src.matchAll(/^(?:async )?function (\w+)/gm)) out.add(m[1])
  return out
}

const have = harnessNames()
let ng = 0
for (const f of readdirSync(join(HERE, 'checks')).filter((f) => f.endsWith('.mjs'))) {
  const src = readFileSync(join(HERE, 'checks', f), 'utf-8')
  const got = provided(src)
  const used = new Set(
    [...src.matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)\s*(?![\w$]*\s*:)/g)].map((m) => m[1])
  )
  const missing = [...used].filter((n) => have.has(n) && !got.has(n) && !GLOBAL.has(n)).sort()
  if (missing.length) {
    console.error(`\x1b[31m${f}\x1b[0m が受け取っていない: ${missing.join(', ')}`)
    ng++
  }
}
if (ng) {
  console.error(
    `\n${ng} ファイルに書き忘れがあります。` +
      '道具箱（run.mjs の C）に足すか、node の物なら import してください。'
  )
  process.exit(1)
}
console.log('確認のファイル: 名前の書き忘れなし')
