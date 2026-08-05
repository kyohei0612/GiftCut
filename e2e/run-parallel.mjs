// **章ごとに別の窓で、同時に回す。**
//
//   npm run e2e:par                 既定4並列
//   npm run e2e:par -- --workers=6  並列度を変える
//   npm run e2e:par -- --fast       run.mjs へそのまま渡す
//
// ## なぜ作ったか（2026-08-05）
//
// 通しは **1つの Electron の中で18章を順に回す**ので、章が増えれば時間は必ず伸びる。
// 「順番依存があるから分散できない」と長く言われてきたが、
// **`npm run solo` で数えたら 18章中18章が独立していた**（赤ゼロ）。
// 各章が `resetProject()` を積み重ねてきた結果、いつの間にか独立し切っていて、
// 誰も測り直していなかっただけだった。**テストの書き換えは1行も要らない。**
//
// ```
// 直列（いまの通し）   約13分
// 1章ずつ単独の合計    15.9分（起動のぶん少し増える）
// 4並列の見込み        **約4分**
// ```
//
// ## 速さのために正しさを捨てない
//
// **時間を測っている章は、1つずつ回す**（`SERIAL_ONLY`）。隣で別の Electron が
// CPU を使うと、絵の止まりも音も嘘の数字になる。実際このリポジトリでは、
// 別のセッションが Electron を起動しただけで6項目が同時に赤になっている。
//
// ## これは通しの代わりにはならない
//
// 章をまたいで起きることは、この形では**原理的に見えない**。
// 出す前の最終確認は、いままでどおり `npm run e2e`（直列1本）で通すこと。

import { spawn } from 'node:child_process'
import { cpus } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { BASELINE_PATH, CHAPTERS, COST_SEC, SERIAL_ONLY } from './lib/chapters.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const WORKERS =
  Number((process.argv.find((a) => a.startsWith('--workers=')) ?? '').slice(10)) ||
  Math.max(2, Math.min(4, Math.floor(cpus().length / 3)))
/** run.mjs へそのまま渡す物 */
const PASS = process.argv.filter((a) => /^--(fast|slow|ratio=)/.test(a))

/**
 * 長い順に、いま一番空いている担当へ配る。
 *
 * **均等に配らない。** 18章のうち上位3章で全体の4割を占めるので、
 * 数で割ると「重い章ばかりの担当」が出て、そこが全体の時間になる。
 */
function shard(names, n) {
  const bins = Array.from({ length: n }, () => ({ sec: 0, names: [] }))
  for (const name of [...names].sort((a, b) => (COST_SEC[b] ?? 40) - (COST_SEC[a] ?? 40))) {
    const b = bins.reduce((m, x) => (x.sec < m.sec ? x : m))
    b.names.push(name)
    b.sec += COST_SEC[name] ?? 40
  }
  return bins
}

/** 1章回して、結果を拾う */
function runChapter(name) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const p = spawn(process.execPath, [join(HERE, 'run.mjs'), `--chapter=${name}`, ...PASS], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    p.stdout.on('data', (d) => (out += d.toString()))
    p.stderr.on('data', (d) => (out += d.toString()))
    p.on('close', (code) => {
      const m = /結果:\s*(\d+)\s*\/\s*(\d+)/.exec(out)
      const ngNames = [...out.matchAll(/\[31m✗\[0m\s*(.+)/g)].map((x) => x[1].trim())
      resolve({
        name,
        ok: m ? Number(m[1]) : 0,
        ngNames,
        sec: (Date.now() - t0) / 1000,
        // **1件も走らなかったのを緑に数えない**（章の名前が違う・入口で落ちた）
        ran: (m ? Number(m[1]) : 0) + ngNames.length > 0,
        // **終了コードも見る。数だけ見ると足りない。**
        //
        // 並列を最初に回したとき、素材の消し合いで `16-仕上げ` が
        // **23件中9件で死んだのに「緑9・赤0」**と出た。数字を読むだけでは
        // 「そういう章だ」と読めてしまう——気づけたのは、たまたま手元に
        // `npm run solo` の実測（23件）があって突き合わせたからだった。
        //
        // 途中で死んだ回は 0 以外で終わる。**そこを見れば手で覚えていなくてよい。**
        code,
        out
      })
    })
  })
}

/** 担当1人ぶん（自分の持ち場を順に回す） */
async function worker(names, id, results) {
  for (const name of names) {
    const r = await runChapter(name)
    results.push(r)
    console.log(
      `  [${id}] ${r.ran ? (r.ngNames.length ? '\x1b[31m✗\x1b[0m' : '\x1b[32m✓\x1b[0m') : '\x1b[33m？\x1b[0m'} ` +
        `${name}  緑${r.ok} 赤${r.ngNames.length}  ${r.sec.toFixed(0)}秒`
    )
  }
}

const t0 = Date.now()
const results = []
const parallelNames = CHAPTERS.filter((c) => !SERIAL_ONLY.includes(c))
const bins = shard(parallelNames, WORKERS)

console.log(`\n\x1b[1m章ごとに並列で回します\x1b[0m  ${WORKERS}並列`)
console.log(`  同時に回す: ${parallelNames.length}章`)
// **0 のときに「1つずつ回す: 0章（隣に邪魔をさせない）」と出すと嘘になる。**
// 空は「そういう章が無い」であって、何かを守っているわけではない
if (SERIAL_ONLY.length)
  console.log(`  1つずつ回す: ${SERIAL_ONLY.length}章（時間を測るので隣に邪魔をさせない）`)
console.log('')
bins.forEach((b, i) => console.log(`  [${i}] 見込み${b.sec}秒  ${b.names.join(' / ')}`))
console.log('')

await Promise.all(bins.map((b, i) => worker(b.names, i, results)))
if (SERIAL_ONLY.length) {
  console.log(`\n\x1b[90m  ここから1つずつ（時間を測る章）\x1b[0m`)
  await worker(SERIAL_ONLY, 'S', results)
}

// ---------------------------------------------------------------------------
const ok = results.reduce((s, r) => s + r.ok, 0)
const ng = results.flatMap((r) => r.ngNames)
const 走らず = results.filter((r) => !r.ran)
// **赤が1件も無いのに 0 以外で終わった章**＝途中で死んでいる。
// 数字の上では健全に見えるので、ここで名指ししないと通ってしまう
const 途中死 = results.filter((r) => r.ran && !r.ngNames.length && r.code !== 0)

/**
 * **基準（`npm run solo` の実測）より緑が少ない章**＝途中で終わっている。
 *
 * 終了コードだけでは足りない。並列を初めて回した日は
 * 「緑9・赤0・けれど本当は23件」だった。**数でも見る。**
 * 基準が無ければ「調べていない」と言う（黙って通さない）。
 */
let baseline = null
try {
  baseline = JSON.parse(readFileSync(join(ROOT, BASELINE_PATH), 'utf-8'))
} catch {
  /* まだ無い */
}
const 足りない = baseline
  ? results.filter((r) => baseline[r.name] != null && r.ok + r.ngNames.length < baseline[r.name])
  : []
const 分 = (Date.now() - t0) / 60000

console.log(`\n\x1b[1m結果: 緑 ${ok} / 赤 ${ng.length}\x1b[0m   ${分.toFixed(1)}分`)
// **下ごしらえの2件が章の数だけ重複して数えられる**（各章が 01 を通るため）。
// 数を通しと突き合わせるときは、ここを引くこと
console.log(
  `\x1b[90m  ※ 各章が 01-起動と復元 を下ごしらえに通すので、` +
    `その2件が ${CHAPTERS.length - 1} 回ぶん重複して数えられています\x1b[0m`
)

if (走らず.length) {
  console.error(`\n\x1b[31m1件も走らなかった章:\x1b[0m ${走らず.map((r) => r.name).join(' / ')}`)
}
if (途中死.length) {
  console.error(
    `\n\x1b[31m赤は無いのに途中で終わった章:\x1b[0m ` +
      途中死.map((r) => `${r.name}（緑${r.ok}・終了コード${r.code}）`).join(' / ') +
      `\n  **「その章はもともとその件数」と読まないこと。** 最後まで走っていません`
  )
}
if (!baseline) {
  console.error(
    `\n\x1b[33m基準がありません（${BASELINE_PATH}）。\x1b[0m` +
      `\n  **件数が足りているかを見ていません。** \`npm run solo\` を1回回してください\n`
  )
} else if (足りない.length) {
  console.error(
    `\n\x1b[31m基準より件数が少ない章:\x1b[0m\n` +
      足りない
        .map((r) => `  ${r.name}  ${r.ok + r.ngNames.length}件 / 基準 ${baseline[r.name]}件`)
        .join('\n') +
      `\n\n  途中で終わっています。**確認を足したなら \`npm run solo\` で基準を取り直すこと。**\n`
  )
}
if (ng.length) {
  console.error(`\n\x1b[1m直すべきもの\x1b[0m`)
  for (const n of ng) console.error(`  ・${n}`)
}
if (ng.length || 走らず.length || 途中死.length || 足りない.length || !baseline) {
  console.error(
    `\n**並列で出た赤は、そのまま信じないこと。**` +
      `\n  同じ章を単独で回して同じか確かめる: node e2e/run.mjs --chapter=<章>` +
      `\n  そこで緑なら、隣の負荷に押されただけ（SERIAL_ONLY へ移すか、並列度を下げる）\n`
  )
  process.exit(1)
}
console.log(`\n全部通りました。**出す前の最終確認は直列で1回**（npm run e2e）\n`)
