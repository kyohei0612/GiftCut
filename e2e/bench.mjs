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
  writeFileSync,
  rmSync,
  existsSync,
  statSync,
  readdirSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const CACHE = join(ROOT, 'e2e', '.cache')
const SHOTS = join(ROOT, 'e2e', 'bench-shots')
const KEEP = process.argv.includes('--keep')
const DO_EXPORT = !process.argv.includes('--no-export')
const DO_LIMITS = !process.argv.includes('--no-limits')
const MINUTES = Number((process.argv.find((a) => a.startsWith('--min=')) ?? '').slice(6)) || 60
const TELOPS = 200
const EDITS = 50

const sh = (cmd, args) =>
  new Promise((res) => {
    const p = spawn(cmd, args)
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', () => res({ code: -1, out: '', err: 'spawn failed' }))
    p.on('close', (code) => res({ code, out, err }))
  })

const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—')
const mb = (bytes) => fmt(bytes / 1024 / 1024, 1) + ' MB'
const nowSec = () => Date.now() / 1000
const esc = (t) => String(t).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])

// ---------------------------------------------------------------------------
// 素材づくり（作ったものは .cache に置いて次回から使い回す）
// ---------------------------------------------------------------------------
/** Downloads から一番大きい動画を選ぶ。作り物では出ない問題があるので実素材を使う。 */
function pickSource() {
  const dl = join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Downloads')
  if (!existsSync(dl)) return null
  const vids = readdirSync(dl)
    .filter((f) => /\.(mp4|mov|mkv|m4v)$/i.test(f))
    .map((f) => join(dl, f))
    .filter((f) => {
      try {
        return statSync(f).isFile()
      } catch {
        return false
      }
    })
  if (!vids.length) return null
  return vids.sort((a, b) => statSync(b).size - statSync(a).size)[0]
}

/**
 * 長い素材を作る。
 *
 * 元のまま1時間ぶん繋ぐと数十GBになるので、
 *   1回目: 先頭の一部を 720p30 に落として「1単位」を作る（ここだけ時間がかかる）
 *   2回目: それを必要な回数つなぐ（作り直さないので一瞬）
 * の2段でやる。中身は実素材なので、コーデックも音も本物のまま。
 */
async function makeLongVideo(minutes) {
  mkdirSync(CACHE, { recursive: true })
  const out = join(CACHE, `bench-${minutes}min.mp4`)
  if (existsSync(out) && statSync(out).size > 1e6) {
    console.log(`素材: 作成済みのものを使う（${mb(statSync(out).size)}）`)
    return out
  }
  const src = pickSource()
  if (!src) {
    console.error('Downloads に動画が見つかりません。素材を1つ置いてください。')
    process.exit(2)
  }
  const unit = join(CACHE, 'bench-unit.mp4')
  const UNIT_SEC = 300
  if (!existsSync(unit) || statSync(unit).size < 1e6) {
    console.log(`素材: ${src} から ${UNIT_SEC / 60} 分ぶんを 720p30 で作成中…（初回だけ）`)
    const r = await sh('ffmpeg', [
      '-v', 'error', '-y', '-t', String(UNIT_SEC), '-i', src,
      '-vf', 'scale=-2:720', '-r', '30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      '-c:a', 'aac', '-b:a', '128k',
      unit
    ])
    if (r.code !== 0) {
      console.error('素材の作成に失敗しました:\n' + r.err.slice(0, 800))
      process.exit(2)
    }
  }
  const loops = Math.ceil((minutes * 60) / UNIT_SEC)
  console.log(`素材: ${minutes} 分ぶんに繋ぎ合わせ中…`)
  const r = await sh('ffmpeg', [
    '-v', 'error', '-y',
    '-stream_loop', String(loops), '-i', unit,
    '-t', String(minutes * 60),
    '-c', 'copy', '-fflags', '+genpts',
    out
  ])
  if (r.code !== 0) {
    console.error('素材の繋ぎ合わせに失敗しました:\n' + r.err.slice(0, 800))
    process.exit(2)
  }
  return out
}

/**
 * テロップぶんの内容を作る。長さも文字数もバラつかせて実際に近づける。
 * chars: 1枚あたりのだいたいの文字数（限界を探すときに増やす）
 */
function makeCues(count, totalSec, chars = 12) {
  const gap = totalSec / count
  const words = ['ここ大事', 'なるほど', 'えっ', 'そういうこと', '待って', '結論から言うと']
  const fill = (i) => {
    let t = ''
    let k = i
    while (t.length < chars) {
      t += words[k++ % words.length] + (t.length % 37 < 6 ? '\n' : '')
    }
    return t.slice(0, chars)
  }
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    start: +(i * gap + 0.2).toFixed(2),
    end: +(i * gap + 0.2 + Math.min(gap * 0.8, 1.2 + (i % 5) * 0.4)).toFixed(2),
    text: fill(i),
    track: 'V2'
  }))
}

/** 動画をn個のクリップに切り分けた状態を作る（切った直後と同じ形） */
function makeSegments(count, totalSec) {
  const len = totalSec / count
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    srcId: 1,
    srcStart: +(i * len).toFixed(3),
    srcEnd: +((i + 1) * len).toFixed(3)
  }))
}

/** プロジェクトの中身を組み立てる（枚数・文字数・クリップ数を変えられる） */
function buildProject(video, totalSec, { telops = TELOPS, chars = 12, clips = 1 } = {}) {
  const project = {
    version: 1,
    videoPath: video,
    srtPath: null,
    sources: [{ id: 1, path: video, name: 'bench.mp4' }],
    ratio: '16:9',
    tracks: [
      { id: 'V3', name: 'V3', kind: 'video' },
      { id: 'V2', name: 'V2', kind: 'video' },
      { id: 'V1', name: 'V1', kind: 'video' },
      { id: 'A1', name: 'A1', kind: 'audio' },
      { id: 'A2', name: 'A2', kind: 'audio' },
      { id: 'A3', name: 'A3', kind: 'audio' }
    ],
    trackStates: {},
    segments: makeSegments(clips, totalSec),
    cues: makeCues(telops, totalSec, chars),
    seClips: [],
    imgClips: [],
    vClips: [],
    markers: [],
    mediaItems: [{ path: video, name: 'bench.mp4', kind: 'video' }],
    iconSide: 'l',
    iconOffset: { x: 0, y: 0 },
    iconScale: 1
  }
  return project
}

function makeProject(video, totalSec) {
  const dir = mkdtempSync(join(tmpdir(), 'giftcut-bench-'))
  const userData = join(dir, 'userData')
  mkdirSync(userData, { recursive: true })
  // 1分に1カットくらいは入っている想定にする。クリップが1つだけだと、
  // 掴んで動かしても磁石で元の位置へ戻るので「動かせていない」ことに気づけない。
  const json = JSON.stringify(
    buildProject(video, totalSec, { clips: Math.max(6, Math.round(totalSec / 60)) })
  )
  // 自動保存から復元する経路で開く。ファイル選択ダイアログを触らずに済み、
  // しかも本番と同じ読み込み経路をそのまま通せる。
  writeFileSync(join(userData, 'giftcut-autosave.json'), json, 'utf-8')
  const gcproj = join(dir, 'bench.gcproj')
  writeFileSync(gcproj, json, 'utf-8')
  return { dir, userData, gcproj, bytes: Buffer.byteLength(json) }
}

// ---------------------------------------------------------------------------
// 結果の記録
// ---------------------------------------------------------------------------
const rows = []
let pageRef = null
let stepNo = 0
const TOTAL_STEPS = 11 + (DO_LIMITS ? 3 : 0) + (DO_EXPORT ? 4 : 0)

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
/** 2枚の画像がどれくらい同じか（1.0 = 完全に同じ） */
async function similarity(a, b) {
  const r = await sh('ffmpeg', ['-v', 'info', '-i', a, '-i', b, '-lavfi', 'ssim', '-f', 'null', '-'])
  const m = (r.err + r.out).match(/All:([\d.]+)/)
  return m ? Number(m[1]) : NaN
}
/** 画像の明るさの分布。真っ黒・真っ白・のっぺりを見分ける。 */
async function brightness(file) {
  // signalstats は数値をフレームの付帯情報に入れるだけなので、metadata=print で吐かせる
  const r = await sh('ffmpeg', ['-i', file, '-vf', 'signalstats,metadata=print', '-f', 'null', '-'])
  const t = r.err + r.out
  const get = (k) => {
    const m = t.match(new RegExp(`lavfi\\.signalstats\\.${k}=([\\d.]+)`))
    return m ? Number(m[1]) : NaN
  }
  return { avg: get('YAVG'), min: get('YMIN'), max: get('YMAX') }
}
/** 音の平均音量(dB)。無音なら -91 付近になる。 */
async function meanVolume(file) {
  const r = await sh('ffmpeg', ['-v', 'info', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'])
  const m = (r.err + r.out).match(/mean_volume:\s*(-?[\d.]+) dB/)
  return m ? Number(m[1]) : NaN
}
/** 無音区間の合計（秒）。音が丸ごと抜けていないかを見る。 */
async function silentSec(file) {
  const r = await sh('ffmpeg', [
    '-v', 'info', '-i', file, '-af', 'silencedetect=noise=-50dB:d=1.5', '-f', 'null', '-'
  ])
  const t = r.err + r.out
  return [...t.matchAll(/silence_duration:\s*([\d.]+)/g)].reduce((a, m) => a + Number(m[1]), 0)
}

/** 60fps なら 16.7ms。どれくらい引っかかったかを分布で見る。 */
function frameStats(frames) {
  const f = frames.filter((x) => x > 0).sort((a, b) => a - b)
  if (!f.length) return null
  const at = (p) => f[Math.min(f.length - 1, Math.floor(f.length * p))]
  return { n: f.length, median: at(0.5), p95: at(0.95), worst: f[f.length - 1], janky: f.filter((x) => x > 50).length }
}

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

  const totalSec = MINUTES * 60
  const video = await makeLongVideo(MINUTES)
  fx = makeProject(video, totalSec)
  console.log(
    `\n\x1b[1m負荷チェック\x1b[0m  ${MINUTES}分 / テロップ${TELOPS}枚 / プロジェクト ${fmt(fx.bytes / 1024, 0)} KB` +
      `${DO_LIMITS ? ' / 限界さがしあり' : ''}${DO_EXPORT ? ' / 書き出しあり' : ''}\n`
  )

  app = await electron.launch({
    executablePath: require('electron'),
    // --expose-gc: メモリを測る前に一度ゴミを片付ける
    // --enable-precise-memory-info: これが無いと使用量が丸められて、
    //   何をしても同じ数字しか返ってこない（実際それで気づいた）
    args: [
      ROOT,
      `--user-data-dir=${fx.userData}`,
      '--js-flags=--expose-gc',
      '--enable-precise-memory-info'
    ],
    cwd: ROOT
  })
  page = await app.firstWindow()
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
  async function measure(name, fn) {
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
  await say('動作', 'プロジェクトを開く', `${MINUTES}分・テロップ${TELOPS}枚を復元中`)
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
  const telopCount = await page.locator('.telop-clip').count()
  await done(
    '動作',
    'テロップが並んでいる',
    `${telopCount} / ${TELOPS} 枚`,
    telopCount >= TELOPS ? 'ok' : telopCount > 0 ? 'warn' : 'ng'
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
  const clip = page.locator('[data-tid="V1"] .video-clip').first()
  // .track-inner は画面の外まで続いている。そのまま幅で割ると押す場所の大半が
  // 窓の外に出て、押しても何も起きない（実際それで50回切ったつもりが1回だった）。
  const vp = page.viewportSize() ?? { width: 1280, height: 800 }
  const visL = Math.max(inner.x, 0) + 8
  const visR = Math.min(inner.x + inner.width, vp.width) - 8
  const visMid = (visL + visR) / 2

  await measure('クリップを掴んで動かす', async () => {
    // 端のクリップは磁石で元の位置へ戻る。真ん中あたりを掴む。
    const all = page.locator('[data-tid="V1"] .video-clip')
    const t = all.nth(Math.floor((await all.count()) / 2))
    const b = await t.boundingBox()
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
    if ((await layout()) === l0) throw new Error('掴んで動かせていない')
    await page.keyboard.press('Control+z') // 元に戻しておく
    await page.waitForTimeout(500)
  })
  void clip

  await measure('タイムラインを拡大・縮小する', async () => {
    await page.mouse.move(visMid, inner.y + 40)
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, -120)
      await page.waitForTimeout(40)
    }
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 120)
      await page.waitForTimeout(40)
    }
  })

  await measure('再生ヘッドを掴んで動かす', async () => {
    const rb = await page.locator('.ruler').boundingBox()
    const step = (visR - visL) / 40
    await page.mouse.move(visL, rb.y + rb.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 40; i++) {
      await page.mouse.move(visL + i * step, rb.y + rb.height / 2)
      await page.waitForTimeout(8)
    }
    await page.mouse.up()
    await page.waitForTimeout(300)
  })

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
  if (DO_LIMITS) {
    /** 別の中身のプロジェクトを開いて、開く時間・触ったときのコマ落ち・メモリを見る */
    async function probe(path) {
      await app.evaluate((_e, p) => {
        globalThis.__e2e.open = [p]
      }, path)
      const t0 = nowSec()
      await page.keyboard.press('Control+o')
      await page.waitForTimeout(500)
      const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
      if (await cont.count()) {
        await cont.click()
        await page.waitForTimeout(200)
      }
      try {
        await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 120000 })
      } catch {
        return { openSec: nowSec() - t0, p95: NaN, heap: NaN, ok: false, note: '開けなかった' }
      }
      await page.waitForTimeout(1200)
      const openSec = nowSec() - t0

      // 掴んで動かしてみて、そのあいだのコマ落ちを見る。
      // 端のクリップは磁石で元の位置に戻るので、真ん中あたりのものを掴む。
      const clips = page.locator('[data-tid="V1"] .video-clip')
      const nClips = await clips.count()
      const target = clips.nth(Math.min(nClips - 1, Math.floor(nClips / 2)))
      await target.scrollIntoViewIfNeeded().catch(() => {})
      let c = await target.boundingBox()
      if (!c) return { openSec, lag: NaN, worst: NaN, heap: NaN, ok: false, note: 'クリップが見つからない' }
      // クリップ数が多いと1個が数pxしかなく、掴もうとしても外れる。
      // 人間も同じことをするので、掴める幅になるまで拡大してから測る。
      for (let g = 0; g < 12 && c.width < 24; g++) {
        await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2)
        await page.mouse.wheel(0, -120)
        await page.waitForTimeout(140)
        await target.scrollIntoViewIfNeeded().catch(() => {})
        c = (await target.boundingBox()) ?? c
      }
      if (c.width < 8) return { openSec, lag: NaN, worst: NaN, heap: NaN, ok: false, note: '拡大しても掴める幅にならない' }
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
      // 動かせたかは「並び全体が変わったか」で見る。
      // n番目のクリップを見張ると、動かした結果ずれた別のクリップが
      // 同じ番号に来てしまい、動いていないように見える。
      const layout = () =>
        clips.evaluateAll((els) =>
          els.map((e) => Math.round(e.getBoundingClientRect().x) + ':' + Math.round(e.getBoundingClientRect().width)).join(',')
        )
      const before = await layout()
      const x0 = c.x + c.width / 2
      const MOVES = 30
      const SLEEP = 8
      const dx = Math.max(3, Math.min(8, (c.width * 1.5) / MOVES)) // 1.5クリップぶん動かす
      await page.mouse.move(x0, c.y + c.height / 2)
      await page.mouse.down()
      const tDrag = nowSec()
      for (let i = 1; i <= MOVES; i++) {
        await page.mouse.move(x0 + i * dx, c.y + c.height / 2)
        await page.waitForTimeout(SLEEP)
      }
      const dragSec = nowSec() - tDrag
      await page.mouse.up()
      await page.waitForTimeout(300)
      // 本当に掴めたかを確かめる。掴めていないと「何も起きない＝軽い」に見えてしまう
      // （実際、最初はこれで全部の設定が「平気」と出ていた）。
      const moved = (await layout()) !== before
      await page.keyboard.press('Control+z')
      await page.waitForTimeout(400)
      const frames = await page.evaluate(() => {
        window.__sampling = false
        return window.__frames
      })
      const s = frameStats(frames) ?? { p95: NaN, worst: NaN, janky: 0 }
      const h = await heap()
      // 1回のマウス移動あたり、待ち時間を差し引いて何ミリ秒余計にかかったか。
      // これがアプリ側の手間そのもの（コマ落ちの分布より素直に効く）。
      const lag = (dragSec * 1000 - MOVES * SLEEP) / MOVES
      // 開くのに30秒／1操作あたり50ms超かかるようなら、そこから先は実用に耐えない
      const ok = moved && openSec <= 30 && lag <= 50
      return { openSec, lag, worst: s.worst, heap: h, ok, note: moved ? '' : '掴めなかった' }
    }

    const sweeps = [
      {
        name: 'テロップの枚数',
        key: 'telops',
        values: [200, 500, 1000, 2000, 4000],
        label: (v) => `${v}枚`,
        base: { clips: 12 }
      },
      {
        name: 'テロップ1枚の文字数',
        key: 'chars',
        values: [12, 40, 120, 400, 1000],
        label: (v) => `1枚 ${v}字`,
        base: { telops: 300, clips: 12 }
      },
      {
        name: 'クリップの数',
        key: 'clips',
        values: [50, 200, 500, 1000, 2000],
        label: (v) => `${v}個`,
        base: { telops: 100 }
      }
    ]

    for (const sw of sweeps) {
      let lastOk = null
      let broke = null
      for (const v of sw.values) {
        const opts = { ...sw.base, [sw.key]: v }
        const p = join(fx.dir, `limit-${sw.key}-${v}.gcproj`)
        writeFileSync(p, JSON.stringify(buildProject(video, totalSec, opts)), 'utf-8')
        await say('動作', `どこまで耐えるか: ${sw.name}`, `${sw.label(v)} を開いて触ってみる`)
        const r = await probe(p)
        const line =
          `${sw.label(v)}: 開く ${fmt(r.openSec)}秒 / 1操作 ${fmt(r.lag)}ms` +
          ` / 最悪のコマ ${fmt(r.worst)}ms / メモリ ${mb(r.heap)}`
        console.log(`    ${r.ok ? '·' : '×'} ${line}${r.note ? ' … ' + r.note : ''}`)
        if (r.ok) lastOk = { v, r }
        else {
          broke = { v, r }
          break
        }
      }
      const detail = broke
        ? `${lastOk ? sw.label(lastOk.v) : '最小の設定'} までは平気 / ${sw.label(broke.v)} で崩れる` +
          `（開く ${fmt(broke.r.openSec)}秒・1操作 ${fmt(broke.r.lag)}ms${broke.r.note ? '・' + broke.r.note : ''}）`
        : `試した上限 ${sw.label(sw.values[sw.values.length - 1])} まで平気` +
          `（そこで 開く ${fmt(lastOk.r.openSec)}秒・1操作 ${fmt(lastOk.r.lag)}ms・メモリ ${mb(lastOk.r.heap)}）`
      await done('動作', `どこまで耐えるか: ${sw.name}`, detail, broke ? 'warn' : 'ok')
    }

    // 元のプロジェクトに戻しておく（このあとの書き出しを本来の条件でやるため）
    await app.evaluate((_e, p) => {
      globalThis.__e2e.open = [p]
    }, fx.gcproj)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(600)
    const cont2 = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont2.count()) await cont2.click()
    await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 120000 })
    await page.waitForTimeout(1200)
  }

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
  const head = `${MINUTES}分・テロップ${TELOPS}枚・編集${EDITS}回`
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
