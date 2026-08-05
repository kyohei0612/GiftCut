#!/usr/bin/env node
// **配布物で、JS の差し替えが本当に効くかを確かめる。**
//
//   npm run dist && npm run check:swap
//
// ## なぜ実物でやるか
//
// 差し替えの失敗は**アプリが起動しなくなる**形で出る。しかも自動更新は
// 全員に配られるので、気づいたときには全員の手元にある。
// 単体試験（`bootGate.test.ts`）は判断しか見ていない——
// **asar の中から userData の JS を読めるか**は、実物でしか分からない。
//
// 特に「差し替えた JS が `electron-updater` を見つけられるか」は、
// 開発中は node_modules がそこら中に在るので**必ず通ってしまう**。
// 配布物は asar の中にしか無いので、そこで初めて落ちる。
//
// ## 3つとも見る（通る道より、戻る道の方が大事）
//
//   1  置いた差し替えで起動する         … 効いていること
//   2  **壊れた差し替えは捨てて同梱へ**  … 戻れること
//   3  **土台が違う差し替えは読まない**  … 一番たちの悪い壊れ方を避けること
//
// 2 と 3 が効いていないと、一度でも悪い物を配った時点で**手で入れ直す**しかなくなる。
//
// ## 使う人の設定は触らない
//
// `--user-data-dir` で別の置き場を渡す。ここを省くと**本物の userData に
// 壊れた差し替えを置く**ことになり、確認のたびにアプリが起動しなくなる。
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { extractZip } from '../src/main/zip.ts'
import { makeFingerprint } from './bundleMeta.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const EXE = join(ROOT, 'dist', 'win-unpacked', 'GiftCut.exe')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

if (!existsSync(EXE)) {
  console.error(`配布物がありません（${EXE}）。先に npm run dist を通すこと`)
  process.exit(2)
}

/** 同梱より1つ新しい版として置く（そうでないと読み込み係が「用済み」と見なす） */
const NEXT = pkg.version.replace(/(\d+)$/, (n) => String(Number(n) + 1))
const FP = makeFingerprint(ROOT)

let failed = 0
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const ng = (m) => {
  failed++
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
}

/** 差し替えを置く。fingerprint を渡せば土台違いも作れる */
async function stage(userData, { version = NEXT, fingerprint = FP, broken = false } = {}) {
  const root = join(userData, 'bundle')
  mkdirSync(join(root, version), { recursive: true })
  await extractZip(join(ROOT, 'dist', `bundle-${pkg.version}.zip`), join(root, version))
  if (broken) {
    // **読み込みの途中で落ちる形**にする（構文は通るが、requireで例外）
    writeFileSync(
      join(root, version, 'main', 'index.js'),
      "throw new Error('わざと壊した差し替え')\n"
    )
  }
  writeFileSync(
    join(root, 'current.json'),
    JSON.stringify({ version, fingerprint, verified: false, tried: 0 })
  )
  return root
}

/** アプリを起動して、決着が付くまで待つ。決着＝判定関数が真を返すか、時間切れ */
function run(userData, until, sec = 40) {
  return new Promise((res) => {
    const child = spawn(EXE, [`--user-data-dir=${userData}`], { stdio: 'ignore' })
    const t0 = Date.now()
    const timer = setInterval(() => {
      const done = until()
      if (!done && Date.now() - t0 < sec * 1000) return
      clearInterval(timer)
      // **木ごと落とす。** Electron は子プロセスを持つので、親だけ殺すと残る
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      res({ ok: done, sec: (Date.now() - t0) / 1000 })
    }, 400)
  })
}

const read = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}
const log = (root) => {
  try {
    return readFileSync(join(root, 'boot.log'), 'utf8')
  } catch {
    return ''
  }
}

const dirs = []
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), 'giftcut-swap-'))
  dirs.push(d)
  return d
}

// ── 1. 置いた差し替えで起動する ──────────────────────────────
console.log(`\n差し替えで起動する（同梱 v${pkg.version} → 差し替え v${NEXT}）`)
{
  const ud = fresh()
  const root = await stage(ud)
  const state = () => read(join(root, 'current.json'))
  const r = await run(ud, () => state()?.verified === true)
  if (r.ok) ok(`差し替えで起動し、確認済みになった（${r.sec.toFixed(1)}秒）`)
  else ng(`差し替えで起動しなかった（${log(root).trim() || '記録なし'}）`)
  if (log(root).includes('読む:')) ok('読み込み係が差し替えを選んだと記録している')
  else ng('読み込み係の記録に「読む」が無い')
}

// ── 2. 壊れた差し替えは捨てて、同梱で起動する ────────────────
console.log('\n**壊れた差し替えは捨てて、同梱で起動する**')
{
  const ud = fresh()
  const root = await stage(ud, { broken: true })
  // 捨てられた＝印が消える。**同梱で起動できていることも同時に見る**
  const r = await run(ud, () => !existsSync(join(root, 'current.json')))
  if (r.ok) ok(`壊れた差し替えを捨てた（${r.sec.toFixed(1)}秒）`)
  else ng('壊れた差し替えを捨てていない（掴んだまま起動しなくなる）')
  if (existsSync(join(ud, 'bundle', NEXT))) ng('中身が残っている（置き場が溜まり続ける）')
  else ok('中身ごと片付けた')
}

// ── 3. 土台が違う差し替えは読まない ──────────────────────────
console.log('\n**土台（Electron）が違う差し替えは読まない**')
{
  const ud = fresh()
  const root = await stage(ud, { fingerprint: 'electron99.0.0-format1' })
  const r = await run(ud, () => !existsSync(join(root, 'current.json')))
  if (r.ok) ok(`土台違いを読まずに捨てた（${r.sec.toFixed(1)}秒）`)
  else ng('土台違いを捨てていない（新しい本体を古いコードが呼ぶ形になる）')
  if (log(root).includes('土台が違う')) ok('理由を記録している')
  else ng('捨てた理由が記録に無い')
}

for (const d of dirs) rmSync(d, { recursive: true, force: true })

console.log(
  failed === 0
    ? '\n\x1b[32m差し替えは配布物でも効いています\x1b[0m'
    : `\n\x1b[31m${failed} 件だめでした\x1b[0m`
)
process.exit(failed === 0 ? 0 : 1)
