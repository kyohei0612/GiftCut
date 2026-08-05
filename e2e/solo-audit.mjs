// **どの章が「自分で始められる」か**を、1章ずつ単独で回して数える。
//
//   npm run solo                     全章（1章ずつ別の窓で・約20分）
//   npm run solo -- --chapter=16-仕上げ  1章だけ
//   npm run solo -- --fast           絞りモードを引き継ぐ（速い代わりに甘い）
//
// ## なぜ要るか（2026-08-05）
//
// 通しは **1つの Electron の中で18章を順に回す**。章が増えれば時間は必ず伸びるのに、
// **分散で解けない。** 順番依存があると言われてきたが、
// **どの章がどれだけ依存しているかの数字は誰も持っていなかった。**
//
// ここで作るのはその数字。並列化はこの一覧が出てからでないと着手できない
// ——数字が無いまま並列にすると、赤が出たときに
// 「並列のせいか、元から依存していたのか」が切り分けられなくなる。
//
// ## 読み方
//
// ```
// ✓  単独で回しても、通しと同じだけ緑    → **そのまま並列にできる**
// ✗  単独だと落ちる                      → 前の章が作った状態に寄りかかっている
// ```
//
// **単独の赤は「アプリの不具合」ではない。** 確認の作りの話（CLAUDE.md 2番）。
// 直し方は、その章の頭で自分の前提を作ること（`resetProject()` など）。

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHAPTERS } from './lib/chapters.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ONE = (process.argv.find((a) => a.startsWith('--chapter=')) ?? '').slice(10)
/** run.mjs へそのまま渡す物（--fast など） */
const PASS = process.argv.filter((a) => a !== ONE && /^--(fast|slow|ratio=)/.test(a))

const targets = ONE ? [ONE] : CHAPTERS
if (ONE && !CHAPTERS.includes(ONE)) {
  console.error(`知らない章です: ${ONE}\n  ${CHAPTERS.join('\n  ')}`)
  process.exit(2)
}

/** 1章だけ回して、結果を拾う */
function runChapter(name) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const p = spawn(
      process.execPath,
      [join(HERE, 'run.mjs'), `--chapter=${name}`, ...PASS],
      { cwd: join(HERE, '..'), stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let out = ''
    p.stdout.on('data', (d) => (out += d.toString()))
    p.stderr.on('data', (d) => (out += d.toString()))
    p.on('close', (code) => {
      // まとめの行から数を拾う（`結果: 12 / 254 件が期待どおり`）
      const m = /結果:\s*(\d+)\s*\/\s*(\d+)/.exec(out)
      const ok = m ? Number(m[1]) : 0
      // 落ちた項目の名前（`直すべきもの:` の下に並ぶ）
      const ngNames = [...out.matchAll(/\[31m✗\[0m\s*(.+)/g)].map((x) =>
        x[1].trim()
      )
      resolve({
        name,
        ok,
        ng: ngNames.length,
        ngNames,
        code,
        sec: (Date.now() - t0) / 1000,
        /** 1件も走らなかった＝章の名前が合っていない・入口で落ちた */
        ran: ok + ngNames.length > 0
      })
    })
  })
}

const rows = []
for (const name of targets) {
  process.stdout.write(`  ${name} … `)
  const r = await runChapter(name)
  rows.push(r)
  console.log(
    r.ran
      ? `${r.ng === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ` +
          `緑${r.ok} 赤${r.ng}  ${r.sec.toFixed(0)}秒`
      : `\x1b[33m？ 1件も走らなかった（${r.sec.toFixed(0)}秒）\x1b[0m`
  )
}

// ---------------------------------------------------------------------------
console.log(`\n\x1b[1mまとめ\x1b[0m`)
// **名前は ASCII にする。** `const独立 = …` と空白を詰めて書くと、
// JS は「`const独立` という名前の変数への代入」と読んで ReferenceError になる
// （日本語の識別子は使えるが、`const` との間の空白が消えても文法的に正しいので
//   気づけない。実際にこれで1回落ちた）
const solo = rows.filter((r) => r.ran && r.ng === 0)
const dep = rows.filter((r) => r.ran && r.ng > 0)
const 走らず = rows.filter((r) => !r.ran)

console.log(`  そのまま並列にできる: ${solo.length} 章`)
console.log(`  前の章に寄りかかっている: ${dep.length} 章`)
if (走らず.length) console.log(`  \x1b[33m1件も走らなかった: ${走らず.length} 章\x1b[0m`)

if (dep.length) {
  console.log(`\n\x1b[1m単独だと落ちる章\x1b[0m（直すのは確認の作り。アプリではない）`)
  for (const r of dep) {
    console.log(`\n  ${r.name}  （赤 ${r.ng}）`)
    for (const n of r.ngNames.slice(0, 6)) console.log(`    ・${n}`)
    if (r.ngNames.length > 6) console.log(`    …ほか ${r.ngNames.length - 6} 件`)
  }
}

// **並列にしたときの見込み。** 一番重い章が下限になる
const 合計 = rows.reduce((s, r) => s + r.sec, 0)
const 最長 = Math.max(...rows.map((r) => r.sec))
console.log(
  `\n  1章ずつの合計 ${(合計 / 60).toFixed(1)}分 ／ 一番重い章 ${(最長 / 60).toFixed(1)}分` +
    `\n  → 全部独立させれば、並列の下限は **${(最長 / 60).toFixed(1)}分**` +
    `（いまの通しは約13分）`
)

// **1件も走らなかった章があるなら赤。** 「調べたつもりで調べていない」を通さない
if (走らず.length) {
  console.error(`\n\x1b[31m${走らず.length}章が1件も走っていません。\x1b[0m 調べになっていません\n`)
  process.exit(1)
}
console.log('')
