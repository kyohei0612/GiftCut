// ============================================================================
// 使用感チェック（自動）
//
//   npm run walk           速く回す（記録だけ取る）
//   npm run walk -- --slow 目で追える速さで動かす（画面を見ながら）
//
// e2e/run.mjs との違い:
//   run.mjs  … 「壊れていないか」を見る。落ちたら赤。
//   walk.mjs … 「**使っていて困らないか**」を見る。落ちなくても、
//              手が余分に要る・どこに何があるか分からない、を拾う。
//
// 各手は 操作 → 期待 → 実際 → 判定 で記録する。判定は3つ:
//   ok   期待どおり
//   気になる  動くが、使う側の手間が増える／分かりにくい（設計の指摘）
//   おかしい  期待と違う（不具合）
//
// 「気になる」は直したら ok に変わる。**指摘が記録として残る**のが狙い。
// 結果は e2e/walk/report.md と、各手のスクリーンショット。
// ============================================================================
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SLOW = process.argv.includes('--slow')
const shots = join(HERE, 'walk')
rmSync(shots, { recursive: true, force: true })
mkdirSync(shots, { recursive: true })

const cache = join(HERE, '.cache')
const video = existsSync(cache)
  ? readdirSync(cache)
      .filter((f) => f.endsWith('.mp4') && !f.includes('60min'))
      .map((f) => join(cache, f))[0]
  : null
if (!video) {
  console.log('素材が無いので中止（e2e/.cache に短い mp4 を置いてください）')
  process.exit(0)
}

const dir = mkdtempSync(join(tmpdir(), 'giftcut-walk-'))
const proj = join(dir, 'walk.gcproj')
writeFileSync(
  proj,
  JSON.stringify({
    version: 1,
    videoPath: video,
    sources: [{ id: 1, path: video, name: 'src.mp4' }],
    segments: [{ id: 1, srcId: 1, srcStart: 0, srcEnd: 12 }],
    cues: [
      { id: 1, start: 1, end: 6, text: '流れるテロップ', label: '#e05a5a', pos: { x: 0.5, y: 0.85 } }
    ],
    mediaItems: [{ path: video, name: 'src.mp4', kind: 'video' }]
  }),
  'utf-8'
)

const require = createRequire(import.meta.url)
const app = await electron.launch({
  executablePath: require('electron'),
  args: [ROOT, `--user-data-dir=${join(dir, 'ud')}`],
  cwd: ROOT,
  ...(SLOW ? { slowMo: 450 } : null)
})
const page = await app.firstWindow()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)))
await page.waitForSelector('.app', { timeout: 20000 })
await app.evaluate(({ dialog }, p) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
}, proj)
const skip = page.locator('.btn', { hasText: '空で始める' })
if (await skip.count()) await skip.click()
await page.keyboard.press('Control+o')
await page.waitForTimeout(3500)

// ---- 記録 ----
const found = []
let step = 0
const C = { ok: '\x1b[32m', warn: '\x1b[33m', bad: '\x1b[31m', off: '\x1b[0m', dim: '\x1b[90m' }
/** 1手ぶん記録する。verdict: 'ok' | '気になる' | 'おかしい' */
async function note(action, expect, actual, verdict, why = '') {
  const f = join(shots, `${String(++step).padStart(2, '0')}-${action.replace(/[^\w一-龥ぁ-んァ-ヶー]/g, '_').slice(0, 28)}.png`)
  await page.screenshot({ path: f })
  found.push({ step, action, expect, actual, verdict, why, shot: f })
  const c = verdict === 'ok' ? C.ok : verdict === '気になる' ? C.warn : C.bad
  const mark = verdict === 'ok' ? '✓' : verdict === '気になる' ? '△' : '✗'
  console.log(`${c}${mark}${C.off} ${action}`)
  if (verdict !== 'ok') console.log(`   ${C.dim}期待: ${expect}${C.off}\n   実際: ${actual}`)
}

const seek = async (sec) => {
  const r = await page.locator('.ruler').boundingBox()
  const zoom = Number(await page.locator('.tl-zoom input').inputValue())
  await page.mouse.click(r.x + sec * zoom, r.y + r.height / 2)
  await page.waitForTimeout(400)
}
const telopX = () =>
  page.evaluate(() =>
    Math.round(
      document.querySelector('.telop-overlay .telop-textmain')?.getBoundingClientRect().x ?? -1
    )
  )
const rowState = (label) =>
  page.evaluate((l) => {
    const row = [...document.querySelectorAll('.mo-row')].find((r) =>
      r.querySelector('.mo-label')?.textContent?.includes(l)
    )
    if (!row) return null
    const val = row.querySelector('.mo-val')
    const keys = row.querySelector('.mo-keys')
    const rb = row.getBoundingClientRect()
    const kb = keys?.getBoundingClientRect()
    return {
      value: val?.value,
      on: !!row.querySelector('.mo-watch.on'),
      diamond: !!row.querySelector('.mo-diamond.on'),
      // ボタンが行からはみ出していないか（見切れの検出）
      keysCut: kb ? kb.right > rb.right + 1 : true
    }
  }, label)

console.log(`\n使用感チェック（モーション）${SLOW ? ' — ゆっくり動かします' : ''}\n`)

// 1 --------------------------------------------------------------------------
await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
await page.waitForTimeout(600)
{
  const empty = await page.locator('.panel-body .empty').first().textContent().catch(() => null)
  await note(
    'テロップを選ばずにモーションタブを開く',
    '何をすればいいかが書いてある',
    empty ? `案内が出る: ${empty.replace(/\s+/g, ' ').trim()}` : '何も出ない',
    empty ? 'ok' : '気になる'
  )
}

// 2 --------------------------------------------------------------------------
await page.locator('.telop-clip').first().click()
await page.waitForTimeout(500)
{
  const r = await rowState('位置 X')
  await note(
    'テロップを選ぶ',
    '位置・拡大・回転・不透明度が出る',
    r ? `位置X = ${r.value}` : '出ない',
    r ? 'ok' : 'おかしい'
  )
  await note(
    '操作ボタン（◀◆▶）が見えているか',
    '行の中に収まっている',
    r?.keysCut ? '行からはみ出して見切れている' : '収まっている',
    r?.keysCut ? '気になる' : 'ok',
    'パネルの幅が狭いと、印を打つボタンに手が届かない'
  )
}

// 3 --------------------------------------------------------------------------
await seek(1.5)
const rowX = page.locator('.mo-row').filter({ hasText: '位置 X' }).first()
const x0 = await telopX()
await rowX.locator('.mo-watch').click()
await page.waitForTimeout(600)
{
  const r = await rowState('位置 X')
  await note(
    '1.5秒で ⏱ を押す',
    'その位置に印が置かれ、◆ が光る',
    `⏱=${r.on ? 'ON' : 'OFF'} / ◆=${r.diamond ? '光る' : '光らない'}`,
    r.on && r.diamond ? 'ok' : 'おかしい'
  )
}

// 4 --------------------------------------------------------------------------
await seek(5)
await rowX.locator('.mo-val').fill('300')
await rowX.locator('.mo-val').press('Enter')
await page.waitForTimeout(800)
const x1 = await telopX()
await note(
  '5秒で 位置X を 300 にする',
  'テロップが左へ動く（元は中央＝960）',
  `${x0} → ${x1}`,
  x1 < x0 - 20 ? 'ok' : 'おかしい'
)

// 5 --------------------------------------------------------------------------
await seek(3)
const xMid = await telopX()
await note(
  '途中（3秒）を見る',
  '2つの印の間にいる（なめらかにつながっている）',
  `${x0} / ${xMid} / ${x1}`,
  xMid < x0 - 5 && xMid > x1 + 5 ? 'ok' : 'おかしい'
)

// 6 --------------------------------------------------------------------------
{
  const marks = await page.locator('.telop-clip .kf-mark').count()
  await note(
    'タイムラインの帯を見る',
    '打った印がクリップの上に見える（プレミアと同じ）',
    marks ? `印が ${marks} 個見える` : '印が見えない',
    marks ? 'ok' : '気になる',
    '後から「どこに印を打ったか」をタイムラインから探せない'
  )
}

// 7 --------------------------------------------------------------------------
{
  const before = await page.evaluate(
    () => document.querySelectorAll('.mo-diamond.on').length
  )
  const tb = await page.locator('.telop-overlay .telop-textmain').first().boundingBox()
  if (tb) {
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2)
    await page.mouse.down()
    await page.mouse.move(tb.x + tb.width / 2 - 60, tb.y + tb.height / 2, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(700)
  }
  const r = await rowState('位置 X')
  await note(
    '⏱ が付いた状態で、プレビューのテロップを掴んで動かす',
    'その位置に印が増える（プレミアと同じ）',
    r?.diamond ? 'その位置に印が置かれた' : `印は増えず、元の位置が動いた（位置X=${r?.value}）`,
    r?.diamond ? 'ok' : '気になる',
    '動きを付ける一番自然なやり方が使えない。数値入力でしか打てない'
  )
}

// 8 --------------------------------------------------------------------------
await seek(1.2)
await page.keyboard.press('Space')
await page.waitForTimeout(2200)
const xPlay = await telopX()
await page.keyboard.press('Space')
await page.waitForTimeout(300)
await note(
  '再生して見る',
  '再生に合わせてテロップが流れる',
  `再生中の位置 ${xPlay}（止めていたとき ${xMid}）`,
  Math.abs(xPlay - xMid) > 5 ? 'ok' : '気になる'
)

// 9 --------------------------------------------------------------------------
await rowX.locator('.mo-watch').click()
await page.waitForTimeout(600)
{
  const r = await rowState('位置 X')
  await note(
    '⏱ をもう一度押して動きをやめる',
    '打った印が消える。消す前に確認があるとなお良い',
    r.on ? 'まだ動きが付いたまま' : '印が全部消えた（確認は出ない）',
    r.on ? 'おかしい' : '気になる',
    '何個も打ったあとで押すと、確認なしで全部消える'
  )
}

// 10 -------------------------------------------------------------------------
await page.keyboard.press('Control+z')
await page.waitForTimeout(900)
{
  // 戻したあと、選んでいた物が選ばれたままか（プレミアは選択を保つ）
  const stillSelected = !!(await rowState('位置 X'))
  await note(
    'Ctrl+Z で戻したあと、選んでいたテロップは選ばれたままか',
    '選んだままで、そのまま続けられる',
    stillSelected ? '選ばれたまま' : '選択が外れて、モーション欄が空になる',
    stillSelected ? 'ok' : '気になる',
    '戻すたびに選び直しになる。打っている最中は何度も戻すので手数が増える'
  )
  // 選び直して、動きが戻っているかを見る
  if (!stillSelected) {
    await page.locator('.telop-clip').first().click()
    await page.waitForTimeout(500)
  }
  const r = await rowState('位置 X')
  await note(
    '戻したあと、消した動きは残っているか',
    '⏱ が付いた状態に戻っている',
    r?.on ? '戻っている' : '戻っていない',
    r?.on ? 'ok' : 'おかしい'
  )
}

// ---- まとめ ----
const bad = found.filter((f) => f.verdict === 'おかしい')
const warn = found.filter((f) => f.verdict === '気になる')
const md = [
  '# 使用感チェック（モーション）',
  '',
  `実行: ${new Date().toISOString()}`,
  '',
  `- 期待どおり: ${found.length - bad.length - warn.length} / ${found.length}`,
  `- 気になる: ${warn.length}`,
  `- おかしい: ${bad.length}`,
  `- 画面のエラー: ${pageErrors.length ? pageErrors.join(' / ') : 'なし'}`,
  '',
  '| # | 操作 | 期待 | 実際 | 判定 | なぜ困るか |',
  '|---|---|---|---|---|---|',
  ...found.map(
    (f) =>
      `| ${f.step} | ${f.action} | ${f.expect} | ${f.actual} | ${f.verdict === 'ok' ? '✓' : f.verdict === '気になる' ? '△' : '✗'} | ${f.why} |`
  ),
  '',
  '画面: `e2e/walk/` に1手ずつ入っています。'
].join('\n')
writeFileSync(join(shots, 'report.md'), md, 'utf-8')

console.log(
  `\n結果: 期待どおり ${found.length - bad.length - warn.length} / 気になる ${warn.length} / おかしい ${bad.length}`
)
console.log(`まとめ: ${join(shots, 'report.md')}`)
if (pageErrors.length) console.log('画面のエラー:', pageErrors)
// **そのまま閉じない。** 触った後は未保存なので、閉じようとすると
// 「保存しますか」の確認が出て、そこで止まってしまう（実際に止まった）。
// ここは確認を見るための道具ではないので、確認を通さずに終わらせる。
await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
process.exit(bad.length ? 1 : 0)
