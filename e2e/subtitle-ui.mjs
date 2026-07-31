// 字幕を「画面に載った実物」で測る（npm run subui <動画>）
//
// ## なぜ subcheck と別に要るか
//
// `npm run subcheck` は**部品を並べて通した結果**を測る（聞き取り→割る→合わせる）。
// これは道具としては正しいが、**画面の字幕ボタンから出てきた物とは限らない**。
// 途中の受け渡し、タイムラインへの置き方、カットとの兼ね合いで、実際に載る物は変わる。
//
// なのでこちらは、**アプリを起動して字幕ボタンを押し**、
// タイムラインに載ったテロップそのものを取り出して測る。
// 併せて**波形と並んだ絵**を撮る。数字だけだと「合っている気がする」で終わるので、
// 声の山とテロップの頭が並んでいるかを目で確かめられるようにしておく。
//
// ## 見る項目（増やしていく）
//
//   頭のズレ   … 喋り出しとテロップの頭の差（小さいほど声と合っている）
//   文字数     … 1枚に詰め込みすぎていないか
//   語の裂け   … 1〜2文字だけの札が出ていないか
//   助詞始まり … 「を〜」「に〜」で始まっていないか（切る場所を間違えた印）
//   短すぎ     … 読む間もなく消える札
//   重なり     … 前の札が消える前に次が出る
//   空         … 中身の無い札
//
//   npm run subui "C:\path\to\video.mp4"
//   npm run subui "...mp4" -- --sec=60   頭の60秒だけで試す（速い）

import { _electron as electron } from 'playwright'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { clearModals, watchdog, step } from './dismiss.mjs'
import { speechRanges } from '../src/shared/alignCues.ts'
import { DB_LADDER, enoughSilences } from '../src/shared/silenceLadder.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const argOf = (n, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${n}=`))
  return a ? a.slice(n.length + 3) : d
}
const src = process.argv.slice(2).find((a) => !a.startsWith('--'))
if (!src || !existsSync(src)) {
  console.error('動画を指定してください: npm run subui "C:\\path\\to\\video.mp4"')
  process.exit(2)
}
const SEC = Number(argOf('sec', '0'))
const MAXC = Number(argOf('chars', '17'))
const OUT = join(ROOT, 'e2e', 'audit')
mkdirSync(OUT, { recursive: true })

// 前に測った結果を使い回す（物差しを直すたびに4分待たないため）
const SAVED = join(OUT, '字幕-結果.json')
const REUSE = process.argv.includes('--from-json')

// 絵を撮るのは測り終えた後なので、アプリはここに置いておく
let app = null
let page = null

/** アプリを起動して、字幕ボタンから作らせ、載った物を取り出す */
async function collectFromApp() {
  const ud = mkdtempSync(join(tmpdir(), 'gc-subui-'))
  // 聞き取りデータは本物の置き場から使い回す（また547MB落とさない）
  const real = join(process.env.APPDATA ?? '', 'GiftCut', 'whisper')
  const MODELNAME = 'ggml-large-v3-turbo-q5_0.bin'
  if (existsSync(join(real, MODELNAME))) {
    mkdirSync(join(ud, 'whisper'), { recursive: true })
    copyFileSync(join(real, MODELNAME), join(ud, 'whisper', MODELNAME))
  }

  app = await electron.launch({
    executablePath: require('electron'),
    args: [ROOT, `--user-data-dir=${ud}`, '--gc-auto'],
    cwd: ROOT
  })
  page = await app.firstWindow()
  // 黙って止まり続けないよう、頭打ちを決めておく（e2e/dismiss.mjs）
  watchdog(25, () => app.close())
  page.on('pageerror', (e) => console.log('[画面の例外]', String(e).slice(0, 200)))
  await page.waitForSelector('.app', { timeout: 60000 })
  await page.waitForTimeout(2500)
  await clearModals(page)
  step('起動して窓をどけた')

  // 動画を読み込ませる（ファイル選びを差し替える）
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
  }, src)
  step('動画を読み込ませる')
  await page.locator('button', { hasText: 'ファイル追加' }).first().click({ timeout: 15000 })
  await page.waitForTimeout(3000)
  const card = page.locator('.media-card').first()
  if (await card.count()) {
    step('タイムラインへ置く')
    await card.dblclick()
    await page.waitForTimeout(6000)
  }

  step('字幕ボタンを押す')
  await page.locator('.mode-tab', { hasText: '字幕' }).first().click({ timeout: 15000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(OUT, '字幕-窓.png') })
  await page.locator('.restore-btns .btn-primary').first().click()
  step('聞き取りを走らせた')

  let made = 0
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(5000)
    made = await page.locator('.telop-clip').count()
    const err = await page
      .locator('.restore-warn')
      .last()
      .innerText()
      .catch(() => '')
    if (err && err.includes('できません')) {
      console.error('エラー:', err.slice(0, 200))
      await app?.close().catch(() => {})
      process.exit(1)
    }
    if (made > 0) break
    if (i % 4 === 0) {
      const hint = await page
        .locator('.restore-box .tpl-hint')
        .last()
        .innerText()
        .catch(() => '')
      if (hint) console.log('  …', hint.slice(0, 60))
    }
  }
  step(`テロップが載った（画面に見えている ${made} 枚）`)

  // ---- 載った物を取り出す ----
  //
  // **画面から数えない。** タイムラインは見えている範囲しか帯を作らないので、
  // DOM を数えると「画面の外の分」が丸ごと落ちる。
  // 自動保存の中身（＝アプリが持っている本体）から取る。
  await page.waitForTimeout(2500) // 自動保存が書かれるのを待つ
  const savePath = join(ud, 'giftcut-autosave.json')
  if (!existsSync(savePath)) {
    console.error('自動保存が見つかりません:', savePath)
    await app?.close().catch(() => {})
    process.exit(1)
  }
  const saved = JSON.parse(readFileSync(savePath, 'utf-8'))
  /** start/end/text を持つ配列を探す（保存の形が変わっても拾えるように） */
  const findCues = (o, depth = 0) => {
    if (!o || depth > 4) return null
    if (Array.isArray(o)) {
      const ok = o.length && o.every((x) => x && typeof x.start === 'number' && 'text' in x)
      return ok ? o : null
    }
    for (const v of Object.values(o)) {
      const r = findCues(v, depth + 1)
      if (r) return r
    }
    return null
  }
  const cues = (findCues(saved) ?? []).slice().sort((a, b) => a.start - b.start)
  if (!cues.length) {
    console.error('テロップが取り出せませんでした')
    await app?.close().catch(() => {})
    process.exit(1)
  }

  return cues
}

let cues
if (REUSE) {
  if (!existsSync(SAVED)) {
    console.error('前の結果がありません:', SAVED)
    process.exit(2)
  }
  cues = JSON.parse(readFileSync(SAVED, 'utf-8'))
  console.log(`前に測った結果を使います（${cues.length}枚）`)
} else {
  cues = await collectFromApp()
  writeFileSync(SAVED, JSON.stringify(cues, null, 2), 'utf-8')
}

// ---- 声の位置を測る（比べる相手） ----
const FFMPEG = join(ROOT, 'resources', 'ffmpeg', 'ffmpeg.exe')
const wav = join(tmpdir(), `giftcut-subui-${cues.length}-${cues[0].start}.wav`)
spawnSync(FFMPEG, [
  '-y',
  ...(SEC > 0 ? ['-t', String(SEC)] : []),
  '-i',
  src,
  '-vn',
  '-ac',
  '1',
  '-ar',
  '16000',
  '-c:a',
  'pcm_s16le',
  wav
])
// **無音は素材で変わる。** 取れるまで少しずつ緩める（アプリと同じ手順）
const total = Math.max(...cues.map((c) => c.end), 1)
let sil = []
for (const db of DB_LADDER) {
  const r = spawnSync(FFMPEG, ['-i', wav, '-af', `silencedetect=noise=${db}dB:d=0.2`, '-f', 'null', '-'], {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024
  })
  const got = []
  let st = null
  for (const line of ((r.stderr ?? '') + '').split(/\r?\n/)) {
    const a = /silence_start:\s*(-?[\d.]+)/.exec(line)
    const b = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/.exec(line)
    if (a) st = Number(a[1])
    if (b) {
      got.push({ start: st ?? Number(b[1]) - Number(b[2]), dur: Number(b[2]) })
      st = null
    }
  }
  if (got.length > sil.length) sil = got
  if (enoughSilences(sil.length, total)) break
}
rmSync(wav, { force: true })
const ranges = speechRanges(sil, total)
const dist = (t) => (ranges.length ? Math.min(...ranges.map((r) => Math.abs(r.start - t))) : NaN)

// ---- 数える ----
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0
const txt = (c) => String(c.text ?? '').trim()
const offs = cues.map((c) => dist(c.start)).filter((n) => Number.isFinite(n))
const lens = cues.map((c) => [...txt(c)].length)

// **疑うのは「同じ文を割った札」だけ。**
// 単独の「これ」や「でも俺の」は、実際にそう喋っただけかもしれない。
// 前の札から続けて出ている（間がほぼ無い）札が短かったり助詞で始まったら、
// それは割る場所を間違えた印。
const 続き = (c, i) => i > 0 && c.start - cues[i - 1].end < 0.05
// 「やっぱ」「かなり」のように語の頭にも来る仮名は入れない（数えすぎる）
const JOSHI = /^[をにがはでとも へ]/
const bad = {
  文字数超過: cues.filter((c) => [...txt(c)].length > MAXC),
  語の裂け: cues.filter((c, i) => 続き(c, i) && [...txt(c)].length <= 2),
  助詞始まり: cues.filter((c, i) => 続き(c, i) && JOSHI.test(txt(c))),
  // ちょうど下限に延ばした札を弾かない（0.4秒が 0.39999… になる）
  短すぎ: cues.filter((c) => c.end - c.start < 0.4 - 1e-3),
  空: cues.filter((c) => !txt(c)),
  重なり: cues.filter((c, i) => i > 0 && c.start < cues[i - 1].end - 0.001)
}

// **全部を同じ物差しで測らない。**
// 長い一文を途中で割った札は、声の途中で始まって当たり前。
// 「話の区切りの先頭に当たる札」だけが、喋り出しと合うべき物。
// 前の札との間が空いている札を、その先頭とみなす。
const isHead = (c, i) => i === 0 || c.start - cues[i - 1].end > 0.35
const heads = cues.filter(isHead)
const headOffs = heads.map((c) => dist(c.start)).filter((n) => Number.isFinite(n))
const pct = (a, n) => ((a.filter((o) => o <= n).length / (a.length || 1)) * 100).toFixed(0)

console.log('')
console.log(`テロップ ${cues.length}枚（うち区切りの先頭 ${heads.length}枚） / 喋りの区間 ${ranges.length}`)
console.log('')
console.log('喋り出しからのズレ（秒）— 小さいほど声と合っている')
console.log(
  `  区切りの先頭  平均 ${avg(headOffs).toFixed(3)} / 中央 ${med(headOffs).toFixed(3)} / 最大 ${Math.max(0, ...headOffs).toFixed(3)}  （0.3秒以内 ${pct(headOffs, 0.3)}%）`
)
console.log(
  `  全部まとめて  平均 ${avg(offs).toFixed(3)} / 中央 ${med(offs).toFixed(3)} / 最大 ${Math.max(0, ...offs).toFixed(3)}  （0.3秒以内 ${pct(offs, 0.3)}%）`
)
console.log('')
console.log(`1枚の文字数  平均 ${avg(lens).toFixed(1)} / 最長 ${Math.max(0, ...lens)}`)
console.log('')
let ng = 0
for (const [name, list] of Object.entries(bad)) {
  if (!list.length) {
    console.log(`  ${name}: なし`)
    continue
  }
  ng += list.length
  const ex = list
    .slice(0, 4)
    .map((c) => `${c.start.toFixed(2)}「${txt(c)}」`)
    .join(' ')
  console.log(`  ※ ${name}: ${list.length}枚  ${ex}`)
}
console.log('')
for (const c of cues.slice(0, 12))
  console.log(`  ${c.start.toFixed(2)} → ${c.end.toFixed(2)}  (ズレ ${dist(c.start).toFixed(2)})  ${txt(c)}`)

// ---- 絵で見る ----
//
// **数字だけだと「合っている気がする」で終わる。**
// 波形とテロップの頭が並んでいる所を撮って、目で確かめられるようにしておく。
if (page) {
step('波形と並べて撮る')
// **寄って撮る。** 4分ぶん全体を1枚に写しても、頭が0.5秒ずれているかは見えない。
// 拡大のつまみを矢印キーで動かす（React の onChange が素直に走る）。
const zoomSlider = page.locator('input[type=range]').first()
if (await zoomSlider.count()) {
  await zoomSlider.click().catch(() => {})
  for (let i = 0; i < 14; i++) await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(600)
}

// 頭・中ほど・終わりの3か所。**画面の中身に触らず、横に送るだけ**にする
//（アプリの内側に手を入れると、測っている物が測るために変わってしまう）
for (const [i, ratio] of [0, 0.5, 0.9].entries()) {
  await page.evaluate((r) => {
    const el = document.querySelector('.timeline')
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) * r
  }, ratio)
  await page.waitForTimeout(700)
  const box = await page.locator('.timeline').boundingBox()
  const f = join(OUT, `字幕-波形${i + 1}.png`)
  if (box) await page.screenshot({ path: f, clip: box })
}
await page.screenshot({ path: join(OUT, '字幕-全体.png') })
console.log('')
console.log('撮った絵:', OUT)
}
console.log(ng === 0 ? '気になる札はありません' : `気になる札 合計 ${ng}枚`)
await app?.close().catch(() => {})
