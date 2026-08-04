// ============================================================================
// 大きなプロジェクトで重くならないかを測る（既定: 1時間の素材＋テロップ200枚）
//
// なぜ必要か:
//   「たぶん重い」「たぶん大丈夫」で作りを変えると、直したのか壊したのか
//   分からなくなる。エフェクトを足す前にここで数字を取っておけば、あとで
//   遅くなったときに「エフェクトのせい」と言い切れる。
//
// 判定は3つの目線でやる（見ているだけで分かるように、画面に札を出す）:
//   動作 … 触っている間のコマ落ち（中央値・95%・最悪・引っかかりの回数）
//   目   … 画面を撮って ffmpeg で測る（描かれているか／戻したら元に戻るか）
//   耳   … 書き出した音を測る（無音になっていないか・音量が適正か）
//
// 安全のために:
//   --user-data-dir を一時フォルダに向けるので、普段の自動保存や設定には
//   一切触らない。素材は Downloads の実素材から作った使い捨てを使う。
//
//   npm run bench                 通しで測る（書き出しまで。長い）
//   npm run bench -- --no-export  書き出しを省く（短時間で動作と目だけ）
//   npm run bench -- --min=10     素材を10分にする（既定は60分）
//   npm run bench -- --keep       終わってもウィンドウを閉じない
// ============================================================================
import { _electron as electron } from 'playwright'
import { spawn } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  statSync,
  readdirSync,
  copyFileSync,
  linkSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { watchdog } from './dismiss.mjs'
// 素材作りと測る道具は ./lib（他の測定スクリプトからも使えるように）
import { sh } from './lib/shell.mjs'
import { fmt, mb } from './lib/fmt.mjs'
import { findLimits } from './bench-limits.mjs'
import { CACHE, TELOPS, PROFILES, pickSource, makeLongVideo, makeStyle, makeCues, makeSegments, buildProject, makeProject, useRealProject, makeImages, makeClipVideos } from './lib/fixture.mjs'
// 一時フォルダが5GBを超えていたら、ここでまとめて捨てる（決まりは ./lib/e2eFixture）
import { cleanBigTemp } from './lib/e2eFixture.mjs'
import { similarity, brightness, meanVolume, silentSec, frameStats } from './lib/measure.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const SHOTS = join(ROOT, 'e2e', 'bench-shots')
const KEEP = process.argv.includes('--keep')
const DO_EXPORT = !process.argv.includes('--no-export')
const DO_LIMITS = !process.argv.includes('--no-limits')
const MINUTES = Number((process.argv.find((a) => a.startsWith('--min=')) ?? '').slice(6)) || 60
/** 本物のプロジェクトで測る（--project=<path>）。原本は触らず一時フォルダへ写す */
const REAL = (process.argv.find((a) => a.startsWith('--project=')) ?? '').slice(10) || ''
// 測定そのものが機能しているかを確かめるモード。
// わざと間違った操作をして、ちゃんと「できていない」と落ちるかを見る。
// これが無いと「何も起きていない＝軽い」を良い結果として読んでしまう
// （実際、拡大していない・掴めていないのに合格していた項目が5つあった）。
const SELFCHECK = process.argv.includes('--selfcheck')
const EDITS = 50
/**
 * **どれくらい編集された物を基準にするか**（`--profile=tv|light`。既定 tv）。
 *
 * 2026-08-03 まではテロップ200枚・カット1個で測っていた。**それは編集して
 * いないのとほぼ同じ**なので、既定を「テレビの編集マン1時間ぶん」にした。
 * 過去の数字と比べたいときだけ `--profile=light`。
 *
 * **目指すのは `light` と `tv` で1操作の重さが変わらないこと。**
 * 差が出たら「見えていない物まで作っている」印（限界値より傾きを見る）。
 */
const PROFILE = (process.argv.find((a) => a.startsWith('--profile=')) ?? '').slice(10) || 'tv'
/**
 * いま測っている基準のテロップ枚数。
 *
 * **`TELOPS`（=200）を直に見てはいけない。** プロファイルを足した日に、
 * 「1200枚あるのに 1200 / 200 枚 ＝ 合格」と出す形になっていた。
 * 数える相手と、期待する数は同じ所から取ること。
 */
const WANT_TELOPS = PROFILES[PROFILE]?.telops ?? TELOPS


const nowSec = () => Date.now() / 1000
const esc = (t) => String(t).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])

// ---------------------------------------------------------------------------
// 素材づくり（作ったものは .cache に置いて次回から使い回す）
// ---------------------------------------------------------------------------
// 結果の記録
// ---------------------------------------------------------------------------
const rows = []
let pageRef = null
let stepNo = 0
const TOTAL_STEPS = 16 + (DO_LIMITS ? 6 : 0) + (DO_EXPORT ? 4 : 0)

function row(lens, what, detail, verdict) {
  rows.push({ lens, what, detail, verdict })
  const mark = verdict === 'ok' ? '\x1b[32m✓\x1b[0m' : verdict === 'warn' ? '\x1b[33m△\x1b[0m' : '\x1b[31m✗\x1b[0m'
  console.log(`  ${mark} [${lens}] ${what}  ${detail}`)
}

/**
 * 画面に「今なにを測っているか」を出す。
 * アプリのコードには一切触らず、外から札を貼るだけ（pointer-events:none）。
 */
async function banner(state) {
  if (!pageRef) return
  try {
    await pageRef.evaluate((s) => {
      let el = document.getElementById('__bench_banner')
      if (!el) {
        el = document.createElement('div')
        el.id = '__bench_banner'
        el.style.cssText = [
          'position:fixed', 'left:50%', 'top:14px', 'transform:translateX(-50%)',
          'z-index:2147483647', 'pointer-events:none',
          'font:13px/1.5 system-ui,sans-serif', 'color:#fff',
          'background:#0b1220f2', 'border:1px solid #ffffff26', 'border-radius:12px',
          'padding:10px 16px', 'min-width:460px', 'max-width:80vw',
          'box-shadow:0 8px 30px #0009', 'text-align:center'
        ].join(';')
        document.body.appendChild(el)
      }
      const color = s.status === 'ok' ? '#4ade80' : s.status === 'ng' ? '#f87171' : s.status === 'warn' ? '#fbbf24' : '#7dd3fc'
      const mark = s.status === 'ok' ? '✓' : s.status === 'ng' ? '✗' : s.status === 'warn' ? '△' : '▶'
      el.innerHTML =
        `<div style="font-size:11px;opacity:.6;letter-spacing:.06em">負荷チェック ・ ${s.lens} ・ ${s.done}/${s.total}</div>` +
        `<div style="margin-top:3px;font-size:14px;font-weight:700;color:${color}">${mark} ${s.name}</div>` +
        (s.detail ? `<div style="margin-top:4px;font-size:11px;opacity:.85">${s.detail}</div>` : '') +
        `<div style="margin-top:8px;height:3px;background:#ffffff1a;border-radius:2px;overflow:hidden">` +
        `<div style="height:100%;width:${Math.round((s.done / Math.max(1, s.total)) * 100)}%;background:${color}"></div></div>`
    }, state)
  } catch {
    /* 画面が入れ替わった直後などは無視 */
  }
}
const say = (lens, name, detail = '') =>
  banner({ status: 'run', lens, name: esc(name), detail: esc(detail), done: stepNo, total: TOTAL_STEPS })
async function done(lens, what, detail, verdict) {
  stepNo++
  row(lens, what, detail, verdict)
  await banner({ status: verdict, lens, name: esc(what), detail: esc(detail), done: stepNo, total: TOTAL_STEPS })
  await new Promise((r) => setTimeout(r, 700)) // 目で読める間を置く
}

// ---------------------------------------------------------------------------
// 目と耳（ffmpeg で測る）
// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------
let app, page, fx
try {
  if (!existsSync(join(ROOT, 'out/main/index.js'))) {
    console.error('先に `npm run build` を実行してください（out/main/index.js が必要）。')
    process.exit(2)
  }
  rmSync(SHOTS, { recursive: true, force: true })
  mkdirSync(SHOTS, { recursive: true })
  let shotNo = 0
  /**
   * 画面を撮る。撮る前に自分が貼った札を隠す。
   * 隠さないと、札の文言の違いだけで「見た目が変わった」と誤判定する
   * （実際にそれで一致度が 0.89 まで落ちた）。
   */
  const shot = async (label, locator) => {
    const f = join(SHOTS, `${String(++shotNo).padStart(2, '0')}-${label}.png`)
    const setBanner = (v) =>
      page.evaluate((vis) => {
        const el = document.getElementById('__bench_banner')
        if (el) el.style.visibility = vis
      }, v)
    await setBanner('hidden')
    await page.waitForTimeout(120)
    if (locator) await locator.screenshot({ path: f })
    else await page.screenshot({ path: f })
    await setBanner('visible')
    return f
  }

  cleanBigTemp()
  // --project=<path> があれば**本物のプロジェクト**で測る（作り物を作らない）。
  // 作り物は「テロップが等間隔に並ぶ」素直な形になりがちで、実際の編集で出る
  // 重さ（段が11本・切片が細かい・効果音が重なる）が出てこない。
  let totalSec = MINUTES * 60
  // **`video` はここで宣言すること。** else の中で `const` にすると、
  // 最後の `findLimits(... video ...)` から見えず `video is not defined` で落ちる。
  // **最初のコミット（87e5234）からずっとそうなっていた**＝限界さがしは
  // 一度も走ったことがない。19項目ぶん測ったあとの最後に落ちるので、
  // 「途中まで結果が出る」ぶん気づきにくかった（2026-08-04 に見つけた）。
  let video = ''
  if (REAL) {
    fx = useRealProject(REAL)
    const d = JSON.parse(readFileSync(REAL, 'utf-8'))
    // 限界さがしは作り物のプロジェクトを組み立てるので、素材だけ本物から借りる
    video = d.videoPath ?? d.sources?.[0]?.path ?? ''
    const cues = d.cues ?? []
    totalSec = Math.ceil(
      Math.max(0, ...cues.map((c) => c.end ?? 0), ...(d.segments ?? []).map((s) => s.tEnd ?? 0))
    )
    console.log(
      `
[1m負荷チェック（本物のプロジェクト）[0m  ${REAL}
` +
        `  尺 ${Math.round(totalSec)}秒 / テロップ${cues.length}枚 / 切片${(d.segments ?? []).length} / ` +
        `効果音${(d.seClips ?? []).length} / 段${(d.tracks ?? []).length} / ` +
        `プロジェクト ${fmt(fx.bytes / 1024, 0)} KB
`
    )
  } else {
    video = await makeLongVideo(MINUTES)
    const prof = PROFILES[PROFILE]
    if (!prof) {
      console.error(
        `--profile=${PROFILE} は知らない名前です（${Object.keys(PROFILES).join(' / ')}）`
      )
      process.exit(2)
    }
    // **本物の画像と動画を用意する。** ここを渡さないと path が元動画を指したままで、
    // デコードもサムネもメモリも1度も測らないまま「軽い」と出る
    //（2026-08-04 まで実際そうだった）。
    // 枚数は元ファイルの上限。置く数は prof.imgs / prof.vids で、使い回して並べる。
    const imgFiles = prof.imgs ? await makeImages(Math.min(prof.imgs, 40), 1920) : null
    const vidFiles = prof.vids ? await makeClipVideos(Math.min(prof.vids, 20), 3) : null
    fx = makeProject(video, totalSec, { ...prof, imgFiles, vidFiles })
    const n = (k) => prof[k] ?? 0
    console.log(
      `  基準 ${PROFILE}${PROFILE === 'tv' ? '（テレビの編集マン1時間ぶん）' : '（2026-08-03 までの基準）'}
  テロップ${n('telops')}枚 / カット${n('clips')} / 効果音${n('se')} / 画像${n('imgs')} / 動画クリップ${n('vids')}
  動き${n('motions')} / 切り替え効果${n('trans')} / めじるし${n('marks')} / 素材ビン${n('media')}`
    )
    console.log(
      `
[1m負荷チェック[0m  ${MINUTES}分 / プロジェクト ${fmt(fx.bytes / 1024, 0)} KB` +
        `${DO_LIMITS ? ' / 限界さがしあり' : ''}${DO_EXPORT ? ' / 書き出しあり' : ''}
`
    )
  }

  app = await electron.launch({
    executablePath: require('electron'),
    // --expose-gc: メモリを測る前に一度ゴミを片付ける
    // --enable-precise-memory-info: これが無いと使用量が丸められて、
    //   何をしても同じ数字しか返ってこない（実際それで気づいた）
    args: [
      ROOT,
      `--user-data-dir=${fx.userData}`, '--gc-auto',
      '--js-flags=--expose-gc',
      '--enable-precise-memory-info'
    ],
    cwd: ROOT
  })
  page = await app.firstWindow()
  // 黙って止まり続けないよう、頭打ちを決めておく（e2e/dismiss.mjs）
  watchdog(60, () => app.close())
  pageRef = page
  await page.waitForSelector('.app', { timeout: 30000 })
  page.setDefaultTimeout(20000)

  const outDir = join(fx.dir, 'out')
  mkdirSync(outDir, { recursive: true })
  const exportPath = join(outDir, 'bench-export.mp4')
  await app.evaluate(
    ({ dialog }, { gcproj, save }) => {
      const g = globalThis
      g.__e2e = { open: [gcproj], save }
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: g.__e2e.open })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: g.__e2e.save })
    },
    { gcproj: fx.gcproj, save: exportPath }
  )

  const heap = async () => {
    await page.evaluate(() => {
      if (typeof window.gc === 'function') window.gc()
    })
    await page.waitForTimeout(400)
    return page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0)
  }

  /** 操作している間の描画のコマ落ちを記録する */
  /**
   * 操作しながら重さを測る。
   *
   * fn は「操作が成立しなかったら throw する」こと。成立の確認が無い項目は、
   * 何も起きていないのに「軽い」という数字を出してしまう。
   *
   * broken を渡すと --selfcheck でそれを実行し、**落ちることを確かめる**。
   * 落ちなければ、その項目は何も見ていないということ。
   */
  async function measure(name, fn, broken) {
    if (SELFCHECK) {
      if (!broken) {
        await done('自己点検', name, 'わざと間違える手順が用意されていない', 'warn')
        return
      }
      await say('自己点検', name, 'わざと間違えて、ちゃんと落ちるかを見る')
      let threw = false
      try {
        await broken()
      } catch {
        threw = true
      }
      await done(
        '自己点検',
        name,
        threw ? 'わざと間違えると、ちゃんと落ちる' : '間違えても合格してしまう（何も見ていない）',
        threw ? 'ok' : 'ng'
      )
      return
    }
    await say('動作', name, '触っている間のコマ落ちを記録中')
    await page.evaluate(() => {
      window.__frames = []
      window.__sampling = true
      let last = performance.now()
      const tick = (t) => {
        window.__frames.push(t - last)
        last = t
        if (window.__sampling) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    const t0 = nowSec()
    let failed = null
    try {
      await fn()
    } catch (e) {
      failed = e?.message ?? String(e) // 操作そのものが成立しなかった
    }
    const elapsed = nowSec() - t0
    const frames = await page.evaluate(() => {
      window.__sampling = false
      return window.__frames
    })
    const s = frameStats(frames)
    if (failed) return done('動作', name, `操作が成立しなかった: ${failed}`, 'ng')
    if (!s) return done('動作', name, '（描画が記録できなかった）', 'warn')
    const detail =
      `中央値 ${fmt(s.median)}ms / 95% ${fmt(s.p95)}ms / 最悪 ${fmt(s.worst)}ms` +
      ` / 引っかかり ${s.janky}回（${fmt(elapsed)}秒間）`
    // 60fps=16.7ms。33ms(30fps)までは普通に触れる。50ms超が続くともたつきを感じる。
    await done('動作', name, detail, s.p95 <= 33 ? 'ok' : s.p95 <= 60 ? 'warn' : 'ng')
  }

  // ---- 1. 読み込み -----------------------------------------------------
  await say('動作', 'プロジェクトを開く', `${MINUTES}分・テロップ${WANT_TELOPS}枚を復元中`)
  const restore = page.locator('.restore-btns button', { hasText: '復元' }).first()
  await restore.waitFor({ timeout: 30000 })
  const tOpen = nowSec()
  await restore.click()
  await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 300000 })
  await page.waitForTimeout(2000)
  const openSec = nowSec() - tOpen
  await done(
    '動作',
    'プロジェクトを開く',
    `${fmt(openSec)}秒`,
    openSec <= 10 ? 'ok' : openSec <= 30 ? 'warn' : 'ng'
  )

  // ---- 2. 目: 中身がちゃんと描かれているか -----------------------------
  await say('目', '画面に中身が出ているか', 'タイムラインとプレビューを撮って測る')
  const shotStart = await shot('起動直後')
  // 画面に出ている帯の数と、プロジェクトが持っているテロップの数は**別物**。
  // 画面に出ていない帯は作らない作りにしたので、帯を数えると
  // 「テロップが減った」と誤読する（実際に要注意として報告してしまった）。
  const telopBands = await page.locator('.telop-clip').count()
  const statusTxt = (await page.locator('.statusbar').first().textContent()) ?? ''
  const telopCount = Number(/(\d+) テロップ/.exec(statusTxt)?.[1] ?? 0)
  await done(
    '動作',
    'テロップが全部読み込まれている',
    `${telopCount} / ${WANT_TELOPS} 枚（画面に出ている帯は ${telopBands} 本）`,
    telopCount >= WANT_TELOPS ? 'ok' : telopCount > 0 ? 'warn' : 'ng'
  )

  const shotTl = await shot('タイムライン', page.locator('.track-inner').first())
  const tl = await brightness(shotTl)
  await done(
    '目',
    'タイムラインが空白でない',
    `明るさ 平均${fmt(tl.avg, 0)} 幅${fmt(tl.max - tl.min, 0)}（のっぺりなら幅が小さい）`,
    tl.max - tl.min > 40 ? 'ok' : 'ng'
  )

  const prev = page.locator('.monitor-stage').first()
  const shotPv = await shot('プレビュー', prev)
  const pv = await brightness(shotPv)
  await done(
    '目',
    'プレビューに絵が出ている',
    `明るさ 平均${fmt(pv.avg, 0)}（真っ黒なら 16 付近）`,
    pv.avg > 24 ? 'ok' : 'warn'
  )
  void shotStart

  const heap0 = await heap()
  await done('動作', '開いた直後のメモリ', mb(heap0), heap0 < 600e6 ? 'ok' : 'warn')

  // ---- 3. 動作: 触ったときのもたつき -----------------------------------
  const inner = await page.locator('.track-inner').boundingBox()
  const vis = await page.locator('.track-scroll').boundingBox()
  /**
   * ホイールを回す高さ。**`.track-inner` ではなく `.track-scroll` から取る。**
   *
   * `.track-inner` は中身そのものなので、段が多くて縦に送られていると
   * **箱の上端が見える範囲より上へはみ出す**（実測: inner.y=379 / scroll.y=511）。
   * そこへホイールを送ると狙いが外れ、拡大も横送りも起きないのに
   * 「重くない」という数字だけが出る。実データ（段11本）で3項目が
   * 黙って測れていなかった（2026-08-03 に気づいた）。
   */
  const visY = (dy) => (vis?.y ?? inner.y) + dy
  const clip = page.locator('[data-tid="V1"] .video-clip').first()
  /**
   * タイムラインを拡大する。
   * ※拡大は Ctrl（か Alt）を押しながらのホイール。ただのホイールは横スクロール。
   *   ここを間違えると「拡大したつもりで何も起きていない」測定になる（実際なっていた）。
   */
  const zoomIn = async (x, y, times) => {
    await page.keyboard.down('Control')
    await page.mouse.move(x, y)
    for (let i = 0; i < times; i++) {
      await page.mouse.wheel(0, -120)
      await page.waitForTimeout(120)
    }
    await page.keyboard.up('Control')
    await page.waitForTimeout(200)
  }
  /**
   * 拡大率をきっちり指定する（px/秒。6〜120）。
   *
   * ホイールで寄せると前の測定から積み上がり、寄りすぎ・引きすぎのどちらでも
   * 操作が成立しなくなる。毎回同じ値から始められるように、
   * ツールバーの「拡大」つまみへ直接入れる。
   * ※range に fill() は使えない（Malformed value）。値を入れて input を起こす。
   */
  const setZoom = async (v) => {
    const inp = page.locator('input[type="range"][title*="拡大率"]').first()
    await inp.evaluate((el, val) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      ).set
      setter.call(el, String(val))
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, v)
    await page.waitForTimeout(250)
  }
  const timelineWidth = () =>
    page.locator('.track-inner').evaluate((e) => Math.round(e.getBoundingClientRect().width))
  /** 先頭へ頭出し（プレビューの絵を揃えたいとき） */
  const seekTo0 = async () => {
    const r = await page.locator('.ruler').boundingBox()
    await page.keyboard.press('Escape')
    await page.mouse.click(Math.max(inner.x, 0) + 10, r.y + r.height / 2)
    await page.waitForTimeout(600)
  }
  // .track-inner は画面の外まで続いている。そのまま幅で割ると押す場所の大半が
  // 窓の外に出て、押しても何も起きない（実際それで50回切ったつもりが1回だった）。
  const vp = page.viewportSize() ?? { width: 1280, height: 800 }
  const visL = Math.max(inner.x, 0) + 8
  const visR = Math.min(inner.x + inner.width, vp.width) - 8
  const visMid = (visL + visR) / 2

  await measure('クリップを掴んで動かす', async () => {
    // 端のクリップは磁石で元の位置へ戻る。真ん中あたりを掴む。
    const all = page.locator('[data-tid="V1"] .video-clip')
    // ★「真ん中の帯」ではなく「画面に見えている帯」を選ぶ。
    //   見えない帯は作らない作りなので、並び順の真ん中が窓の外にあることがある
    //   （実際 x=1764 の画面外を掴んで、何も起きていなかった）。
    const vwA = (page.viewportSize() ?? { width: 1280 }).width
    const iA = await all.evaluateAll((els, w) => {
      const hit = []
      for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect()
        if (r.x > 200 && r.x + r.width < w - 200) hit.push(i)
      }
      if (hit.length) return hit[Math.floor(hit.length / 2)]
      for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect()
        if (r.x < w - 250 && r.x + r.width > 250) return i
      }
      return -1
    }, vwA)
    if (iA < 0) throw new Error('掴める帯が画面に無い')
    const t = all.nth(iA)
    let b = await t.boundingBox()
    // 細いクリップは掴めない。人と同じで、掴める幅まで拡大してから動かす。
    for (let g = 0; g < 12 && b.width < 24; g++) {
      await zoomIn(b.x + b.width / 2, b.y + b.height / 2, 1)
      await t.scrollIntoViewIfNeeded().catch(() => {})
      b = (await t.boundingBox()) ?? b
    }
    // 動かせたかは「並び全体が変わったか」で見る。n番目を見張ると、
    // ずれた別のクリップが同じ番号に来て「動いていない」ことになる。
    const layout = () =>
      all.evaluateAll((els) =>
        els
          .map((e) => {
            const r = e.getBoundingClientRect()
            return Math.round(r.x) + ':' + Math.round(r.width)
          })
          .join(',')
      )
    const l0 = await layout()
    const x0 = b.x + b.width / 2
    const dx = Math.max(3, Math.min(8, (b.width * 1.5) / 40))
    await page.mouse.move(x0, b.y + b.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 40; i++) {
      await page.mouse.move(x0 + i * dx, b.y + b.height / 2)
      await page.waitForTimeout(8)
    }
    await page.mouse.up()
    await page.waitForTimeout(300)
    const l1 = await layout()
    if (l1 === l0)
      throw new Error(
        `掴んで動かせていない（掴んだ所 x=${Math.round(x0)} 幅=${Math.round(b.width)} 1回=${dx}px×40 / 帯 ${l0.split(',').length}本）`
      )
    await page.keyboard.press('Control+z') // 元に戻しておく
    await page.waitForTimeout(500)
  },
  // わざと間違える: 掴まずに0pxだけ動かす（＝何も起きない）
  async () => {
    const all = page.locator('[data-tid="V1"] .video-clip')
    const t = all.nth(Math.floor((await all.count()) / 2))
    const b = await t.boundingBox()
    const layout = () =>
      all.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)).join(','))
    const l0 = await layout()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.up()
    await page.waitForTimeout(300)
    if ((await layout()) === l0) throw new Error('掴んで動かせていない')
  })
  void clip

  await measure('タイムラインを拡大・縮小する', async () => {
    const w0 = await timelineWidth()
    await zoomIn(visMid, visY(40), 10)
    const w1 = await timelineWidth()
    if (w1 <= w0 * 1.2) throw new Error(`拡大できていない（${w0} → ${w1}px）`)
    await page.keyboard.down('Control')
    await page.mouse.move(visMid, visY(40))
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 120)
      await page.waitForTimeout(120)
    }
    await page.keyboard.up('Control')
    await page.waitForTimeout(200)
    const w2 = await timelineWidth()
    if (w2 >= w1 * 0.9) throw new Error(`縮小できていない（${w1} → ${w2}px）`)
  },
  // わざと間違える: Ctrl を押さずにホイールする（＝横スクロールするだけ）
  async () => {
    const w0 = await timelineWidth()
    await page.mouse.move(visMid, visY(40))
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, -120)
      await page.waitForTimeout(80)
    }
    const w1 = await timelineWidth()
    if (w1 <= w0 * 1.2) throw new Error(`拡大できていない（${w0} → ${w1}px）`)
  })

  /** 再生ヘッドの画面上の位置（動いたかを確かめるのに使う） */
  const headX = async () => (await page.locator('.playhead').first().boundingBox())?.x ?? NaN
  await measure(
    '再生ヘッドを掴んで動かす',
    async () => {
      const rb = await page.locator('.ruler').boundingBox()
      const step = (visR - visL) / 40
      const x0 = await headX()
      await page.mouse.move(visL, rb.y + rb.height / 2)
      await page.mouse.down()
      for (let i = 1; i <= 40; i++) {
        await page.mouse.move(visL + i * step, rb.y + rb.height / 2)
        await page.waitForTimeout(8)
      }
      await page.mouse.up()
      await page.waitForTimeout(300)
      if (Math.abs((await headX()) - x0) < 10) throw new Error('再生ヘッドが動いていない')
    },
    // わざと間違える: 押して離すだけで動かさない
    async () => {
      const rb = await page.locator('.ruler').boundingBox()
      const x0 = await headX()
      await page.mouse.move(visL, rb.y + rb.height / 2)
      await page.mouse.down()
      await page.mouse.up()
      await page.waitForTimeout(300)
      if (Math.abs((await headX()) - x0) < 10) throw new Error('再生ヘッドが動いていない')
    }
  )

  /** テロップ全部の画面上の位置（一緒に動いたかを確かめるのに使う） */
  const telopPos = () =>
    page
      .locator('.telop-clip')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)).join(','))
  /** 一番左のクリップの画面上の位置（横スクロールしたかを確かめるのに使う） */
  const firstClipX = async () =>
    (await page.locator('[data-tid="V1"] .video-clip').first().boundingBox())?.x ?? NaN
  await measure(
    'タイムラインを横にスクロールする',
    async () => {
      const x0 = await firstClipX()
      await page.mouse.move(visMid, visY(60))
      for (let i = 0; i < 20; i++) {
        await page.mouse.wheel(160, 0)
        await page.waitForTimeout(25)
      }
      if (Math.abs((await firstClipX()) - x0) < 10) throw new Error('横にスクロールしていない')
      for (let i = 0; i < 20; i++) await page.mouse.wheel(-160, 0) // 戻す
      await page.waitForTimeout(300)
    },
    // わざと間違える: タイムラインの外（プレビューの上）でホイールする。
    // ※縦にホイールしても横に動くので、それでは「間違い」にならない
    //   （このアプリはただのホイール＝横スクロール）。
    async () => {
      const pv = await page.locator('.monitor-stage').first().boundingBox()
      const x0 = await firstClipX()
      await page.mouse.move(pv.x + pv.width / 2, pv.y + pv.height / 2)
      for (let i = 0; i < 20; i++) {
        await page.mouse.wheel(160, 0)
        await page.waitForTimeout(25)
      }
      if (Math.abs((await firstClipX()) - x0) < 10) throw new Error('横にスクロールしていない')
    }
  )

  await measure('テロップを掴んで動かす', async () => {
    const tel = page.locator('.telop-clip')
    const n = await tel.count()
    if (!n) throw new Error('テロップが1つも出ていない')
    // テロップの帯は最低12pxで描かれるので、拡大率が低いと隣どうしが重なり、
    // 狙った帯ではなく手前の帯を掴んでしまう。まず拡大してから、
    // 「いま画面に見えていて掴める幅のもの」を選び直す。
    // （拡大すると狙った帯が画面外へ出るので、先に決めておくと空振りする）
    await zoomIn(visMid, visY(40), 10)
    const vw = (page.viewportSize() ?? { width: 1280 }).width
    const idx = await tel.evaluateAll((els, w) => {
      for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect()
        if (r.width >= 20 && r.x > 80 && r.x + r.width < w - 120) return i
      }
      return -1
    }, vw)
    if (idx < 0) throw new Error('掴める幅のテロップが画面に無い')
    const t = tel.nth(idx)
    let b = await t.boundingBox()
    await t.click() // 掴む前に選んでおく
    await page.waitForTimeout(200)
    b = (await t.boundingBox()) ?? b
    const shot0 = await tel.evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().x)).join(',')
    )
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 30; i++) {
      await page.mouse.move(b.x + b.width / 2 + i * 8, b.y + b.height / 2)
      await page.waitForTimeout(8)
    }
    await page.mouse.up()
    await page.waitForTimeout(300)
    const shot1 = await tel.evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().x)).join(',')
    )
    if (shot0 === shot1)
      throw new Error(`テロップを動かせていない（幅 ${Math.round(b.width)}px・${n}枚）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  },
  // わざと間違える: 拡大せず、重なって細いままの帯を掴もうとする
  async () => {
    const tel = page.locator('.telop-clip')
    const t = tel.nth(Math.floor((await tel.count()) / 2))
    const b = await t.boundingBox()
    const pos = () => tel.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)).join(','))
    const p0 = await pos()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.up()
    await page.waitForTimeout(300)
    if ((await pos()) === p0) throw new Error('テロップを動かせていない')
  })

  await measure('テロップの文字を打ち直す', async () => {
    // 1文字打つたびに画面全体が作り直されると、長い動画ほど入力が遅れる
    //
    // テロップが出ている時刻へ移る。**帯の真ん中を押してはいけない**。
    // 帯は細くなりすぎないよう最低12pxで描かれるので、引いた状態では
    // 「帯の真ん中」と「テロップが出ている時刻」がずれる（60分だと数秒ぶん）。
    // ずれた所へ再生ヘッドを置くと、プレビューに文字が出ず、
    // アプリの不具合のように見える（実際にそう報告してしまった）。
    // 帯そのものを押して選び、その中身の時刻へ移る。
    const band = page.locator('.telop-clip').nth(1)
    await page.keyboard.press('Escape')
    await band.click()
    await page.waitForTimeout(400)
    // 選んだテロップの開始時刻＋わずかに後ろ（確実に表示される所）へ。
    // 時刻は帯の left（＝開始秒×拡大率）から割り戻す。
    // アプリ側にテスト用の属性は足さない（本番のコードに仕掛けを入れない）。
    const at = await page.evaluate(() => {
      const el = document.querySelector('.telop-clip.clip-selected')
      if (!el) return null
      const left = parseFloat(el.style.left || '0')
      return Number.isFinite(left) ? left : null
    })
    const rr = await page.locator('.ruler').boundingBox()
    // **帯そのものの箱から押す所を決める。** 前は拡大スライダー
    // （`.tl-zoom input[type=range]`）の値で秒→pxを換算していたが、
    // 2026-08-03 に拡大UIが下のバーへ移ってスライダーが**消えた**ため、
    // ここは20秒待って必ず落ちていた（＝この項目は測れていなかった）。
    // 帯の真ん中は必ずその文字が出ている時刻なので、換算そのものが要らない。
    void at
    const bb = await band.boundingBox()
    if (!bb) throw new Error('選んだ帯が画面に無い')
    await page.mouse.click(bb.x + bb.width / 2, rr.y + rr.height / 2)
    await page.waitForTimeout(700)
    const tel = page.locator('.telop-overlay > *').first()
    if (!(await tel.count())) throw new Error('プレビューに文字が出ていない')
    await tel.dblclick()
    await page.waitForTimeout(400)
    const ed = page.locator('.telop-editor textarea, .telop-editor input').first()
    if (!(await ed.count())) throw new Error('打ち直す欄が出ない')
    const before = await ed.inputValue()
    for (const ch of 'あいうえおかきくけこ') {
      await page.keyboard.type(ch)
      await page.waitForTimeout(12)
    }
    const after = await ed.inputValue()
    if (after === before) throw new Error('文字が入っていない')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
  },
  // わざと間違える: 打ち直す欄を開かずに打つ（どこにも入らない）
  async () => {
    const tel = page.locator('.telop-overlay > *').first()
    const before = (await tel.textContent()) ?? ''
    await page.keyboard.type('あいうえお')
    await page.waitForTimeout(400)
    const after = (await tel.textContent()) ?? ''
    if (after === before) throw new Error('文字が入っていない')
  })

  await measure('全部選んでまとめて動かす', async () => {
    // **決まった見え方から始める。** 手前の項目（拡大・横送り）が残した倍率と
    // 位置のまま掴むと、同じ px を動かしても意味する秒数が毎回変わり、
    // 磁石に吸い戻されたりはみ出したりして「動かせていない」と出る。
    // 「↔ 全体表示」を押して基準へ戻す（2026-08-03）。
    const fit = page.locator('.tl-zoom button').first()
    if (await fit.count()) await fit.click().catch(() => {})
    await page.waitForTimeout(500)
    await page.keyboard.press('Escape')
    const all = page.locator('[data-tid="V1"] .video-clip')
    // 画面に見えていて掴める幅のものを選ぶ（拡大率は前の項目で変わっている）
    const vw2 = (page.viewportSize() ?? { width: 1280 }).width
    // 拡大していると1つが画面より広いこともある。画面に見えている部分があれば掴める。
    //
    // **縦も見る。** 横だけで選んでいたので、段が多い（実データは11本）と
    // V1 が縦にはみ出していても「見えている」と数えてしまい、画面の外を掴んで
    // 「まとめて動かせていない」と出ていた（2026-08-03。前の項目で拡大が
    // 効くようになって初めて表に出た）。
    const i2 = await all.evaluateAll((els, w) => {
      const sc = document.querySelector('.track-scroll')?.getBoundingClientRect()
      for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect()
        const yOk = !sc || (r.y + r.height / 2 > sc.top + 8 && r.y + r.height / 2 < sc.bottom - 8)
        if (r.x < w - 200 && r.x + r.width > 200 && yOk) return i
      }
      return -1
    }, vw2)
    if (i2 < 0) throw new Error('掴めるクリップが画面に無い')
    const t = all.nth(i2)
    const tp0 = await telopPos()
    await page.keyboard.press('Control+a')
    await page.waitForTimeout(400)
    const b = await t.boundingBox()
    const l0 = await all.evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().x)).join(',')
    )
    // **動かす量は「秒」で決める。** 150px 固定にしていたので、拡大が効いた状態だと
    // 1秒未満になり、**磁石で元の位置へ吸い戻されて「動かせていない」**と出ていた
    // （2026-08-03。前の項目の拡大が直って初めて表に出た）。
    const pps =
      (await page.locator('.track-inner').evaluate((e) => parseFloat(e.style.width || '0'))) /
      Math.max(1, totalSec)
    const dist = Math.max(150, Math.round(2 * pps)) // 2秒ぶん（最低150px）
    const stepN = 30
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= stepN; i++) {
      await page.mouse.move(b.x + b.width / 2 + (i * dist) / stepN, b.y + b.height / 2)
      await page.waitForTimeout(8)
    }
    await page.mouse.up()
    await page.waitForTimeout(400)
    const l1 = await all.evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().x)).join(',')
    )
    if (l0 === l1) throw new Error('まとめて動かせていない')
    // 「まとめて」なので、テロップも一緒に動いていること
    if ((await telopPos()) === tp0) throw new Error('クリップだけ動いてテロップが残っている')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
    await page.keyboard.press('Escape')
  },
  // わざと間違える: 全選択せずに動かす（クリップだけ動いてテロップは残る）
  async () => {
    await page.keyboard.press('Escape')
    const all = page.locator('[data-tid="V1"] .video-clip')
    const t = all.nth(Math.floor((await all.count()) / 2))
    const b = await t.boundingBox()
    const tp0 = await telopPos()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(b.x + b.width / 2 + i * 5, b.y + b.height / 2)
      await page.waitForTimeout(8)
    }
    await page.mouse.up()
    await page.waitForTimeout(400)
    if ((await telopPos()) === tp0) throw new Error('クリップだけ動いてテロップが残っている')
  })

  await measure(
    '再生してみる（3秒）',
    async () => {
      await seekTo0()
      const x0 = await headX()
      await page.keyboard.press('Space')
      await page.waitForTimeout(3000)
      await page.keyboard.press('Space')
      await page.waitForTimeout(300)
      if (Math.abs((await headX()) - x0) < 5) throw new Error('再生が進んでいない')
    },
    // わざと間違える: 再生を始めずに待つだけ
    async () => {
      await seekTo0()
      const x0 = await headX()
      await page.waitForTimeout(3000)
      if (Math.abs((await headX()) - x0) < 5) throw new Error('再生が進んでいない')
    }
  )

  // 自己点検はここまで（この先は「測る」ではなく「壊れていないか見る」なので、
  // わざと間違える対象ではない）
  if (SELFCHECK) {
    const bad = rows.filter((r) => r.verdict !== 'ok').length
    console.log(`\n自己点検: ${rows.length - bad} / ${rows.length} 項目が、わざと間違えると落ちる`)
    if (!KEEP) await app.close()
    process.exit(bad ? 1 : 0)
  }

  // ---- 4. 動作: 50回編集して元に戻す -----------------------------------
  const rb = await page.locator('.ruler').boundingBox()
  /** タイムラインの真ん中あたりに再生位置を移す（前後で同じ絵を見くらべるため） */
  const seekMid = async () => {
    await page.keyboard.press('Escape')
    await page.mouse.click(visL + (visR - visL) * 0.5, rb.y + rb.height / 2)
    await page.waitForTimeout(900) // プレビューが描き変わるのを待つ
  }
  /** クリップの位置と幅の一覧。元に戻したときに並びが復元したかを見る。 */
  const clipLayout = async () => {
    const boxes = await page.locator('[data-tid="V1"] .video-clip').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect()
        return { x: Math.round(r.x), w: Math.round(r.width) }
      })
    )
    return boxes
  }
  await seekMid()
  const shotPvBefore = await shot('編集前のプレビュー', prev)
  const layoutBefore = await clipLayout()

  const before = await page.locator('[data-tid="V1"] .video-clip').count()
  await say('動作', `${EDITS}回続けて切る`, '履歴を積んだときのメモリを見る')
  const tEdit = nowSec()
  for (let i = 1; i <= EDITS; i++) {
    // 選択を外してから切る。クリップを選んだままだと Ctrl+K が
    // 「選択中のものだけ分割」に切り替わり、動画が切れない。
    await page.keyboard.press('Escape')
    await page.mouse.click(visL + ((visR - visL) * i) / (EDITS + 1), rb.y + rb.height / 2)
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(30)
  }
  await page.waitForTimeout(1500)
  const editSec = nowSec() - tEdit
  const after = await page.locator('[data-tid="V1"] .video-clip').count()
  await done(
    '動作',
    `${EDITS}回続けて切る`,
    `クリップ ${before} → ${after} 個 / ${fmt(editSec)}秒（1回 ${fmt((editSec * 1000) / EDITS, 0)}ms）`,
    after > before ? 'ok' : 'ng'
  )
  const heap1 = await heap()
  await done(
    '動作',
    `${EDITS}回ぶんの履歴を積んだあとのメモリ`,
    `${mb(heap1)}（開いた直後から ${mb(heap1 - heap0)} 増）`,
    heap1 - heap0 < 300e6 ? 'ok' : heap1 - heap0 < 800e6 ? 'warn' : 'ng'
  )

  await say('動作', `${EDITS}回ぶん元に戻す`, '戻したあとに元の見た目へ戻るかも見る')
  const tUndo = nowSec()
  for (let i = 0; i < EDITS; i++) {
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(20)
  }
  await page.waitForTimeout(1500)
  const undoSec = nowSec() - tUndo
  const back = await page.locator('[data-tid="V1"] .video-clip').count()
  await done(
    '動作',
    `${EDITS}回ぶん元に戻す`,
    `クリップ ${after} → ${back} 個 / ${fmt(undoSec)}秒`,
    back === before ? 'ok' : 'warn'
  )
  const heap2 = await heap()
  await done(
    '動作',
    '元に戻したあとのメモリ',
    `${mb(heap2)}（開いた直後との差 ${mb(heap2 - heap0)}）`,
    heap2 - heap0 < 300e6 ? 'ok' : 'warn'
  )

  // ---- 5. 目と動作: 戻したら元どおりか ---------------------------------
  // 画面全体を見くらべると、再生ヘッドの位置や選択の枠まで差として出てしまう。
  // 「戻ったか」を見たいので、同じ時点のプレビューの絵と、クリップの並びで見る。
  await say('目', '元に戻したら映像も戻る', '同じ位置のプレビューを見くらべる')
  await seekMid()
  const shotPvAfter = await shot('元に戻したあとのプレビュー', prev)
  const sim = await similarity(shotPvBefore, shotPvAfter)
  await done(
    '目',
    '元に戻したら映像も戻る',
    `同じ位置のプレビューの一致度 ${fmt(sim, 3)}（1.0 で完全一致）`,
    sim >= 0.97 ? 'ok' : sim >= 0.9 ? 'warn' : 'ng'
  )

  const layoutAfter = await clipLayout()
  const sameLayout =
    layoutBefore.length === layoutAfter.length &&
    layoutBefore.every((b, i) => Math.abs(b.x - layoutAfter[i].x) < 2 && Math.abs(b.w - layoutAfter[i].w) < 2)
  await done(
    '動作',
    '元に戻したらクリップの並びも戻る',
    `クリップ ${layoutBefore.length} 個の位置と幅を照合`,
    sameLayout ? 'ok' : 'ng'
  )
  await shot('元に戻したあと')

  // ---- 6. どこまで耐えるか（限界さがし） --------------------------------
  // 「重いかどうか」だけだと、どこまで足していいのか分からない。
  // 現実にありうる範囲から少しずつ上げて、崩れる手前を見つける。
  // 中身は ./bench-limits.mjs（約380行あるので別ファイル）
  if (DO_LIMITS) await findLimits({ ROOT, nowSec, say, done, app, fx, page, setZoom, heap, video, totalSec })

  // ---- 7. 書き出し（目と耳） -------------------------------------------
  if (DO_EXPORT) {
    await say('耳', `${MINUTES}分ぶんを書き出す`, '完走するか・音が抜けないかを見る')
    const t0 = nowSec()
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
    await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
    let finished = true
    try {
      await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 4 * 3600 * 1000 })
    } catch {
      finished = false
    }
    const sec = nowSec() - t0
    const size = existsSync(exportPath) ? statSync(exportPath).size : 0
    await done(
      '動作',
      `${MINUTES}分ぶんの書き出しが完走する`,
      finished && size > 0
        ? `${fmt(sec / 60)}分 / ${mb(size)}（実時間の ${fmt(sec / totalSec, 2)}倍）`
        : '完走しなかった',
      finished && size > 0 ? 'ok' : 'ng'
    )

    if (size > 0) {
      const vol = await meanVolume(exportPath)
      await done(
        '耳',
        '書き出した音が入っている',
        `平均音量 ${fmt(vol)}dB（無音なら -90 付近）`,
        vol > -40 ? 'ok' : 'ng'
      )
      const sil = await silentSec(exportPath)
      await done(
        '耳',
        '音が途中で抜けていない',
        `無音区間 合計 ${fmt(sil)}秒 / 全体 ${totalSec}秒`,
        sil < totalSec * 0.2 ? 'ok' : 'warn'
      )
      // 書き出した動画の真ん中あたりを1コマ抜いて、絵が入っているか見る
      const frame = join(SHOTS, 'export-frame.png')
      await sh('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.floor(totalSec / 2)), '-i', exportPath, '-frames:v', '1', frame])
      if (existsSync(frame)) {
        const b = await brightness(frame)
        await done(
          '目',
          '書き出した映像が黒くない',
          `明るさ 平均${fmt(b.avg, 0)} 幅${fmt(b.max - b.min, 0)}`,
          b.max - b.min > 40 ? 'ok' : 'ng'
        )
      }
    }
  }

  // ---- まとめ ----------------------------------------------------------
  const ng = rows.filter((r) => r.verdict === 'ng').length
  const warn = rows.filter((r) => r.verdict === 'warn').length
  // **本物のプロジェクトで測ったときに「60分・テロップ200枚」と出さない。**
  // 見出しが嘘だと、あとで数字を読み返したときに何を測ったのか分からなくなる。
  const head = REAL
    ? `本物のプロジェクト・編集${EDITS}回`
    : `${MINUTES}分・基準${PROFILE}・テロップ${WANT_TELOPS}枚・編集${EDITS}回`
  // **1つも測れていないなら落とす。** 「0 良好 / 0 問題あり」は緑に見えるが、
  // 測っていないだけ。決まりは CLAUDE.md の7番:
  // 「測る側は**成立しなければ落ちる**に倒すこと」（stutter 側にも同じ穴があった）
  if (!rows.length) {
    console.error('\n**1つも測れませんでした。** 測る項目が1件も成立していません。')
    process.exit(1)
  }
  console.log(
    `\n\x1b[1m結果\x1b[0m: ${rows.length - ng - warn} 良好 / ${warn} 要注意 / ${ng} 問題あり（${head}）`
  )
  console.log(`撮った画面: ${SHOTS}`)

  // 次に測ったときに比べられるよう、数字をファイルに残す
  const md =
    `# 負荷チェックの結果\n\n条件: ${head}\n\n` +
    '| 目線 | 見たこと | 数字 | 判定 |\n|---|---|---|---|\n' +
    rows
      .map(
        (r) =>
          `| ${r.lens} | ${r.what} | ${r.detail} | ${r.verdict === 'ok' ? '良好' : r.verdict === 'warn' ? '要注意' : '問題あり'} |`
      )
      .join('\n') +
    '\n'
  const resultPath = join(ROOT, 'e2e', 'bench-result.md')
  writeFileSync(resultPath, md, 'utf-8')
  console.log(`数字の控え: ${resultPath}`)

  await banner({
    status: ng ? 'ng' : warn ? 'warn' : 'ok',
    lens: 'まとめ',
    name: `${rows.length - ng - warn} 良好 / ${warn} 要注意 / ${ng} 問題あり`,
    detail: esc(head),
    done: TOTAL_STEPS,
    total: TOTAL_STEPS
  })
  await page.waitForTimeout(KEEP ? 0 : 2500)
  if (!KEEP) await app.close()
  process.exit(ng ? 1 : 0)
} catch (e) {
  console.error('\n測定中に落ちました:', e?.message ?? e)
  try {
    if (page) await page.screenshot({ path: join(SHOTS, '99-落ちた時点.png') })
  } catch {
    /* 画面が無ければ諦める */
  }
  try {
    if (!KEEP && app) await app.close()
  } catch {
    /* すでに閉じている */
  }
  process.exit(1)
} finally {
  if (!KEEP && fx?.dir) {
    try {
      rmSync(fx.dir, { recursive: true, force: true })
    } catch {
      /* 使用中なら次回に片付く */
    }
  }
}
