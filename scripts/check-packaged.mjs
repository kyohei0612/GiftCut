#!/usr/bin/env node
// ============================================================================
// 配布物（dist/win-unpacked）が本当に動くかを確かめる。
//
//   npm run dist && npm run check:packaged
//
// なぜ要るか:
//   開発中は PC に入っている ffmpeg で動いてしまうので、**同梱を忘れていても
//   気づけない**。配布物は「渡した相手の PC」に近い状態なので、ここで
//   実際に起動して、同梱の ffmpeg で書き出せるところまで見る。
//
//   ここが通らないものを配ると、相手の PC では何も動かない。
// ============================================================================
import { _electron as electron } from 'playwright'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP = join(ROOT, 'dist', 'win-unpacked', 'GiftCut.exe')
const problems = []
const ok = (m) => console.log(`  ✓ ${m}`)
const ng = (m) => {
  console.log(`  ✗ ${m}`)
  problems.push(m)
}

if (!existsSync(APP)) {
  console.error(`配布物がありません: ${APP}\n先に npm run dist を実行してください。`)
  process.exit(1)
}

// 同梱物の確認（ここが抜けると相手の PC で動かない）
const res = join(ROOT, 'dist', 'win-unpacked', 'resources')
for (const f of ['ffmpeg/ffmpeg.exe', 'ffmpeg/ffprobe.exe']) {
  existsSync(join(res, f)) ? ok(`同梱: ${f}`) : ng(`同梱されていない: ${f}`)
}
// 配ってはいけない素材（再配布禁止）
for (const d of ['SE', 'telop-presets']) {
  existsSync(join(res, d)) ? ng(`配布物に入ってはいけない: ${d}`) : ok(`入っていない: ${d}`)
}
// ライセンスの表示（LGPL は「使っていることを知らせ、本文を添える」ことを求める）。
// **アプリのフォルダの一番上**に無いと、受け取った人が見つけられない。
const appDir = join(ROOT, 'dist', 'win-unpacked')
for (const f of ['licenses/FFmpeg/NOTICE.md', 'licenses/FFmpeg/LGPL-3.0.txt', 'licenses/FFmpeg/GPL-3.0.txt']) {
  existsSync(join(appDir, f)) ? ok(`同梱: ${f}`) : ng(`ライセンスの表示が入っていない: ${f}`)
}

console.log('配布物を起動します…')
const userData = mkdtempSync(join(tmpdir(), 'giftcut-pack-'))
// **作業フォルダを配布物の中にする。** ここを開発フォルダのままにすると、
// アプリが開発中の SE/ テロップ素材/ テンプレート/ を拾ってしまい、
// 「相手のPCでは空になる」問題を見逃す（実際に見逃していた）。
const app = await electron.launch({
  executablePath: APP,
  cwd: join(ROOT, 'dist', 'win-unpacked'),
  args: [`--user-data-dir=${userData}`]
})
let page
try {
  page = await app.firstWindow()
  await page.waitForTimeout(4000)
  ok('起動した')
  // 前回の作業・書き出し設定などの案内が出ていたら閉じる
  for (const label of ['破棄', '閉じる', 'キャンセル']) {
    const b = page.locator('.restore-btns button, .export-overlay button', { hasText: label })
    if (await b.count()) {
      await b.first().click({ force: true })
      await page.waitForTimeout(600)
    }
  }
  // 同梱の ffmpeg が、配布物の中の場所で本当に動くか。
  //
  // ここはアプリの中からではなく外から試す（配布物の main は ESM で束ねられていて
  // require が無いため）。**アプリがその ffmpeg を指していること**はコード側で
  // 決まっているので、ここでは「置かれた物が動くか」を見れば足りる。
  const media = join(userData, 'probe.mp4')
  const gen = await new Promise((res2) => {
    const p = spawn(join(res, 'ffmpeg', 'ffmpeg.exe'), [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'testsrc=d=2:s=320x240',
      '-f', 'lavfi', '-i', 'sine=d=2',
      '-c:v', 'libopenh264', '-c:a', 'aac',
      media
    ])
    p.on('error', (e) => res2('起動できない: ' + e.message))
    p.on('close', (code) => res2(code === 0 ? 'ok' : 'code ' + code))
  })
  gen === 'ok' && existsSync(media)
    ? ok('同梱の ffmpeg で焼ける（GPUの無いPCでも書き出せる）')
    : ng(`同梱の ffmpeg で焼けない: ${gen}`)

  // 同梱したテンプレートが、渡した相手の画面に本当に出るか。
  //
  // **入っている＝見つかる、ではない。** 実際、置き場は resources/ なのに
  // アプリは cwd と app.asar しか見ておらず、同梱したのに一覧が空だった。
  // 開発機は cwd に本物のフォルダがあるので、起動しても気づけない。
  const tpl = await page.evaluate(() => window.giftcut.listTemplates())
  tpl?.ok && (tpl.items?.length ?? 0) > 0
    ? ok(`同梱のテンプレートが見える（${tpl.items.length}件）`)
    : ng(`同梱のテンプレートが見えない（相手の画面では一覧が空になる）: ${JSON.stringify(tpl)}`)

  // 配ってはいけない素材が、配布物から読めてしまわないか（入っていないことの裏取り）
  const pre = await page.evaluate(() => window.giftcut.listTelopPresets())
  ;(pre?.items?.length ?? 0) === 0
    ? ok('再配布禁止のテロップ素材は入っていない')
    : ng(`配布物からテロップ素材が読めてしまう（${pre.items.length}件）`)
} catch (e) {
  ng(`起動して確かめられなかった: ${String(e.message).split('\n')[0]}`)
} finally {
  try {
    await app.evaluate(({ app: a }) => a.exit(0))
  } catch {
    /* すでに落ちている */
  }
  try {
    rmSync(userData, { recursive: true, force: true })
  } catch {
    /* 使用中なら残す */
  }
}

if (problems.length) {
  console.error(`\n配布物に問題があります（${problems.length}件）。このままでは配れません。`)
  process.exit(1)
}
console.log('\n配布物は問題ありません。')
