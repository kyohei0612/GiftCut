// 報告された「書き出しが失敗する」を、そのプロジェクトの条件で再現する。
//
// ## なぜ要るか
//
// 落ちた画面の写真だけでは、原因を当てずっぽうで探すことになる。実際に一度
// 「テロップの枚数が多すぎるせい」と読み違えた。**同じ条件で焼いてみるのが一番早い。**
//
// 素材（動画・画像・音）は手元に無いので、同じ長さ・同じ fps の代わりを作って
// 差し替える。**それ以外（カット・テロップ・エフェクト・寄り・書き出し設定）は
// 報告されたプロジェクトのまま**にする。壊れているのはそちら側だから。
//
// 使い方:
//   node e2e/repro-export.mjs <報告された.gcproj>
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FFMPEG = join(ROOT, 'resources', 'ffmpeg', 'ffmpeg.exe')

const src = process.argv[2]
if (!src) {
  console.error('使い方: node e2e/repro-export.mjs <.gcproj>')
  process.exit(2)
}
if (!existsSync(join(ROOT, 'out/main/index.js'))) {
  console.error('先に `npm run build` を実行してください。')
  process.exit(2)
}

const sh = (cmd, args) =>
  new Promise((res) => {
    const p = spawn(cmd, args)
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (code) => res({ code, err }))
  })

const dir = mkdtempSync(join(tmpdir(), 'giftcut-repro-'))
const userData = join(dir, 'ud')
const outDir = join(dir, 'out')
mkdirSync(userData, { recursive: true })
mkdirSync(outDir, { recursive: true })

const proj = JSON.parse(readFileSync(src, 'utf-8'))

// ---- 代わりの素材（長さと fps は報告のものに合わせる）----
// 尺は「一番後ろに置かれている物」より長く取る。足りないと最後が黒くなって
// 再現にならない（落ちる前に別の理由で結果が変わる）。
const endOf = (arr, f) => (arr || []).reduce((m, c) => Math.max(m, f(c)), 0)
const need = Math.ceil(
  Math.max(
    endOf(proj.cues, (c) => c.end),
    endOf(proj.seClips, (c) => c.tStart + (c.duration ?? 2)),
    endOf(proj.imgClips, (c) => c.tStart + (c.duration ?? 2)),
    endOf(proj.segments, (s) => (s.srcEnd ?? 0)),
    10
  ) + 5
)
// 素材の fps は「素材と同じ」で書き出す設定のときに効くので、報告に合わせて 60 にする
const SRC_FPS = 60
const video = join(dir, 'src.mp4')
const image = join(dir, 'img.png')
const sound = join(dir, 'se.wav')
console.log(`代わりの素材を作成中… (${need}秒 / ${SRC_FPS}fps)`)
let r = await sh(FFMPEG, [
  '-y',
  '-f', 'lavfi', '-i', `testsrc=size=1080x1920:rate=${SRC_FPS}:duration=${need}`,
  '-f', 'lavfi', '-i', `sine=frequency=440:duration=${need}`,
  '-c:v', 'libopenh264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video
])
if (r.code !== 0) {
  console.error('素材の動画が作れなかった:\n' + r.err.slice(-800))
  process.exit(1)
}
await sh(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=400x400:d=1', '-frames:v', '1', image])
await sh(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2', sound])

// ---- 素材の場所だけ差し替える ----
const isAudio = (p) => /\.(wav|mp3|m4a|aac|flac|ogg)$/i.test(p || '')
const isImage = (p) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(p || '')
const swap = (p) => (isAudio(p) ? sound : isImage(p) ? image : video)
proj.videoPath = video
proj.sources = (proj.sources || []).map((s) => ({ ...s, path: video }))
proj.seClips = (proj.seClips || []).map((c) => ({ ...c, path: sound }))
proj.imgClips = (proj.imgClips || []).map((c) => ({ ...c, path: image }))
proj.vClips = (proj.vClips || []).map((c) => ({ ...c, path: video }))
proj.mediaItems = (proj.mediaItems || []).map((m) => ({ ...m, path: swap(m.path) }))
proj.projectPath = null
proj.srtPath = null
const gcproj = join(dir, 'repro.gcproj')
writeFileSync(gcproj, JSON.stringify(proj), 'utf-8')

console.log(
  `中身: カット${(proj.segments || []).length} / テロップ${(proj.cues || []).length} / ` +
    `効果音${(proj.seClips || []).length} / 画像${(proj.imgClips || []).length} / ` +
    `書き出し ${JSON.stringify(proj.exportOpts)} ${proj.ratio}`
)

// ---- アプリを起こして、開いて、焼く ----
const out = join(outDir, 'repro.mp4')
const app = await electron.launch({
  executablePath: require('electron'),
  args: [ROOT, `--user-data-dir=${userData}`, '--gc-auto'],
  cwd: ROOT
})
const page = await app.firstWindow()
await page.waitForSelector('.app', { timeout: 30000 })
page.setDefaultTimeout(15000)
await app.evaluate(
  ({ dialog }, { open, save }) => {
    const g = globalThis
    g.__e2e = { open: [open], save }
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: g.__e2e.open })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: g.__e2e.save })
  },
  { open: gcproj, save: out }
)

// 画面のお知らせを全部拾う（失敗の理由はここに出る）
const toasts = []
await page.exposeFunction('__reproToast', (t) => toasts.push(t))
await page.evaluate(() => {
  const seen = new Set()
  setInterval(() => {
    for (const el of document.querySelectorAll('.toast, [class*="toast"]')) {
      const t = el.textContent || ''
      if (t && !seen.has(t)) {
        seen.add(t)
        window.__reproToast(t)
      }
    }
  }, 300)
})

/** いま出ている窓の中身（どの窓で止まっているか分からないと進めない） */
const overlayText = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.export-overlay')]
      .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200))
      .join(' ／ ')
  )
/** 出ている窓を、指し示した文字のボタンで片付ける */
const dismiss = async (re) => {
  for (let i = 0; i < 4; i++) {
    const t = await overlayText()
    if (!t) return
    console.log('  窓: ' + t)
    const b = page.locator('.export-overlay button', { hasText: re }).first()
    if ((await b.count()) === 0) return
    await b.click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(600)
  }
}

// 起動直後は「テンプレートから始める」「前回の続きを復元しますか」が出る。
// 片付けないと、以降のキー操作がすべてこの窓に吸われる
await page.waitForTimeout(1500)
await dismiss(/空で始める|しない|いいえ|新規|閉じる/)

console.log('プロジェクトを開いています…')
await page.keyboard.press('Control+o')
await page.waitForTimeout(1000)
await dismiss(/はい|開く|破棄|捨て/)
await page.waitForTimeout(4000)
console.log(
  '  読み込み後のクリップ数: ' +
    (await page.locator('[data-clip], .clip, .seg').count()) +
    ' / 窓: ' +
    ((await overlayText()) || 'なし')
)

console.log('書き出しています…（長くかかります）')
const t0 = Date.now()
await page.keyboard.press('Control+m')
await page.waitForTimeout(1500)
const btn = page.locator('.export-overlay button', { hasText: 'この設定で書き出す' }).first()
if ((await btn.count()) === 0) {
  console.log('書き出しの窓が出なかった。いま出ている窓: ' + ((await overlayText()) || 'なし'))
  await app.close()
  process.exit(1)
}
await btn.click()
let done = false
try {
  await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 30 * 60 * 1000 })
  done = true
} catch {
  console.log('※ 30分たっても終わらなかった')
}
const sec = ((Date.now() - t0) / 1000).toFixed(0)

console.log('\n==== 結果 ====')
console.log(`かかった時間: ${sec}秒`)
console.log(`出来たファイル: ${existsSync(out) ? 'あり' : '**無い（失敗）**'}`)
for (const t of toasts) console.log('お知らせ: ' + t.slice(0, 400))
// **成功したときは控えを出さない。** 前の失敗が残っているだけなのに
// 「今回も失敗した」と読み違えるため（実際に一度読み違えた）
const diag = join(tmpdir(), 'giftcut-last-export-error.txt')
if (!existsSync(out) && existsSync(diag)) {
  const txt = readFileSync(diag, 'utf-8')
  console.log('\n---- 失敗の控え ----\n' + txt.slice(0, 3000))
}
if (existsSync(out)) {
  const probe = await sh(FFMPEG, ['-v', 'error', '-i', out, '-f', 'null', '-'])
  console.log(`中身の検査: ${probe.code === 0 ? 'OK' : 'NG\n' + probe.err.slice(-600)}`)
}
await app.close()
process.exit(existsSync(out) && done ? 0 : 1)
