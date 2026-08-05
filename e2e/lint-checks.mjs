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

/**
 * 確認のファイルが**受け取れる**名前＝道具箱 `C` の鍵。
 *
 * ## なぜ「run.mjs に在る名前」を集めてはいけないか（2026-08-05 に作り直した）
 *
 * 前は run.mjs の宣言を片っ端から集めていた。ところが正規表現が**行頭固定**で、
 * 道具はほぼ全部が関数の中＝字下がりなので、**75個のうち25個しか集まらなかった**。
 * `v1Clips` も `avgColor` も漏れていて、17c が両方とも受け取り忘れたまま
 * **「名前の書き忘れなし」と緑で言っていた**（通しで初めて落ちた）。
 *
 * 字下がりを許すように直すと、今度は run.mjs の**ただの局所変数**（`box` `x` `y`
 * `p` `on` …）まで道具扱いになって、**37ファイル全部が赤**になった。
 * 広く取っても狭く取っても外れる——集める対象そのものが違っていた。
 *
 * → **`const C = { … }` の鍵だけを読む。** それが確認のファイルとの契約そのもので、
 *   広すぎも狭すぎもしない。
 */
function harnessNames() {
  const src = readFileSync(join(HERE, 'run.mjs'), 'utf-8')
  const block = src.match(/\n\s*const C = \{([\s\S]*?)\n\s*\}/)
  if (!block) throw new Error('run.mjs に「const C = {」が無い（道具箱の形が変わった）')
  const out = new Set()
  for (const line of block[1].split('\n')) {
    const n = line.split(':')[0].trim().replace(/,$/, '')
    if (/^\w+$/.test(n)) out.add(n)
  }
  // **空になったら見張りが死ぬ。** 落ちない代わりに黙って通す型（CLAUDE.md 7番）で、
  // 集め方が壊れた事故は 08-04 と 08-05 に2回起きている。数で足を止める
  if (out.size < 20)
    throw new Error(`道具箱の名前が ${out.size} 個しか読めていない（集め方が壊れた）`)
  return out
}

/**
 * コメントと文字列を消して、**コードだけ**にする。
 *
 * 消さないと、`// 掴める印（fx-draggable）で選ぶ` の `fx` や
 * `'shot-check.png'` の `shot` を「道具を使っている」と読んでしまう
 * （2026-08-05、その2件でいきなり嘘の赤が出た）。
 *
 * ※ 正規表現1本では無理。文字列の中の `//`（`https://…`）を行コメントと
 *   間違えるので、**頭から1文字ずつ**辿る。
 * ※ テンプレート文字列は `${…}` の中だけ残す。`assert(…, \`ずれた: ${drift}\`)` の
 *   `drift` は**本物の使用**なので、丸ごと消すと今度は見落とす。
 */
function codeOnly(src) {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const two = src.slice(i, i + 2)
    if (two === '//') {
      while (i < src.length && src[i] !== '\n') i++
    } else if (two === '/*') {
      i += 2
      while (i < src.length && src.slice(i, i + 2) !== '*/') i++
      i += 2
    } else if (c === "'" || c === '"') {
      i++
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1
      i++
      out += ' '
    } else if (c === '`') {
      i++
      while (i < src.length && src[i] !== '`') {
        if (src.slice(i, i + 2) === '${') {
          i += 2
          let depth = 1
          while (i < src.length && depth > 0) {
            if (src[i] === '{') depth++
            else if (src[i] === '}') depth--
            if (depth > 0) out += src[i]
            i++
          }
          out += ' '
        } else i += src[i] === '\\' ? 2 : 1
      }
      i++
    } else {
      out += c
      i++
    }
  }
  return out
}

const have = harnessNames()
let ng = 0
for (const f of readdirSync(join(HERE, 'checks')).filter((f) => f.endsWith('.mjs'))) {
  const src = readFileSync(join(HERE, 'checks', f), 'utf-8')
  const got = provided(src)
  const used = new Set(
    [...codeOnly(src).matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)\s*(?![\w$]*\s*:)/g)].map((m) => m[1])
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
