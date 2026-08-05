#!/usr/bin/env node
// **本物の更新を1回通して、再起動に何秒かかるかを測る。**
//
//   node scripts/measure-swap.mjs <古い版のアプリ.exe>
//
// ## なぜ実地でないと駄目か
//
// `check:swap` は**こちらで置いた**差し替えを読ませている。本物の更新は
// その手前が丸ごと違う——Releases を見に行き、荷札を読み、落とし、
// 中身を照合し、展開する。そこが通ることは実際にやってみるまで分からない。
//
// ## 測るのは「押してから、戻ってくるまで」
//
// `userData/update.log` の2行の差を見る:
//
//   [経過] 差し替えで開き直す v0.1.29   ← 閉じる直前（古い版が書く）
//   --- 起動 v0.1.29（同梱 v0.1.28）--- ← 開き直した後（新しい版が書く）
//
// **これがインストーラの「十数秒」と並ぶ数字。**
//
// ## 使う人の設定は触らない
//
// `--user-data-dir` を渡して別の置き場で動かす。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { _electron as electron } from 'playwright'

const EXE = process.argv[2]
if (!EXE || !existsSync(EXE)) {
  console.error('使い方: node scripts/measure-swap.mjs <古い版のアプリ.exe>')
  process.exit(2)
}

const ud = mkdtempSync(join(tmpdir(), 'giftcut-measure-'))
const logPath = join(ud, 'update.log')
const log = () => (existsSync(logPath) ? readFileSync(logPath, 'utf8') : '')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * ある文字を含む行が出るまで待つ。出なければ null。
 *
 * **最後の行を返す。** 先頭から探すと、開き直しを待つつもりで
 * **古い版の起動行に当たって即座に真になる**（実際にやった。押した時刻より
 * 前の時刻を掴んで、所要が -6.7秒 になった）。
 * 待っているのは「これから出る行」なので、後ろから見る。
 */
async function until(has, sec) {
  for (let i = 0; i < sec * 2; i++) {
    const hits = log()
      .split('\n')
      .filter((l) => l.includes(has))
    if (hits.length) return hits[hits.length - 1]
    await wait(500)
  }
  return null
}

const stamp = (line) => new Date(line.slice(0, 24)).getTime()

console.log(`古い版を起動します（置き場: ${ud}）`)
const app = await electron.launch({ executablePath: EXE, args: [`--user-data-dir=${ud}`] })
await app.firstWindow()

console.log('新しい版を見つけて、差し替えを置くのを待ちます…')
const placed = await until('差し替えを置いた', 120)
if (!placed) {
  console.error('\x1b[31m差し替えを置きませんでした。ログ:\x1b[0m\n' + log())
  await app.close()
  process.exit(1)
}
console.log(`  ${placed.trim()}`)

// **「今すぐ更新して再起動」を押す。** ここから先が測る区間
const win = await app.firstWindow()
await win.evaluate(() => window.giftcut.updateNow())

const closing = await until('差し替えで開き直す', 30)
// **版まで見て待つ。**「起動」だけだと古い版の起動行に当たる（上の until 参照）
const newVersion = closing ? closing.match(/v(\d+\.\d+\.\d+)/)?.[1] : ''
const started = newVersion ? await until(`--- 起動 v${newVersion}`, 60) : null
try {
  await app.close()
} catch {
  /* もう閉じている */
}

// 開き直った方は Playwright の管理外なので、名前で片付ける
spawnSync('taskkill', ['/im', 'GiftCut.exe', '/f'], { stdio: 'ignore' })

const lines = log().trim().split('\n')
console.log('\n--- update.log ---')
for (const l of lines) console.log('  ' + l)

if (!closing || !started) {
  console.error('\n\x1b[31m開き直しの記録が揃いませんでした\x1b[0m')
  process.exit(1)
}
// **「画面が出るまで」も出す。** プロセスが起きた時刻だけだと、
// 使う人が待っている時間より短く見える（窓はもう少し後に出る）。
// 確認済みの印は `did-finish-load` で書かれるので、それが画面の出た合図
const shown = await until('は無事に起動できた', 30)
const sec = (t) => ((stamp(t) - stamp(closing)) / 1000).toFixed(1)
console.log(`\n\x1b[32m押してから、新しい版が起き上がるまで: ${sec(started)} 秒\x1b[0m`)
if (shown) console.log(`\x1b[32m押してから、画面が出るまで:           ${sec(shown)} 秒\x1b[0m`)

// **片付けは失敗してよい。** 開き直した側がまだ掴んでいることがある
// （実際に EPERM で落ちた）。測れたのに、後始末で赤くしない
try {
  rmSync(ud, { recursive: true, force: true })
} catch {
  console.log(`（置き場は消せませんでした。手で消してよい: ${ud}）`)
}
