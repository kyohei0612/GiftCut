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
  readdirSync,
  copyFileSync,
  linkSync
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
// 測定そのものが機能しているかを確かめるモード。
// わざと間違った操作をして、ちゃんと「できていない」と落ちるかを見る。
// これが無いと「何も起きていない＝軽い」を良い結果として読んでしまう
// （実際、拡大していない・掴めていないのに合格していた項目が5つあった）。
const SELFCHECK = process.argv.includes('--selfcheck')
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
/**
 * テロップの見た目を作る。
 * strokes: 縁取りの枚数 / shadows: 影の枚数 / kinds: 何種類のスタイルを混ぜるか
 * 装飾はプレビューを描くたびに効いてくるので、重さの軸になる。
 */
function makeStyle(i, { strokes = 1, shadows = 0, kinds = 1 } = {}) {
  const k = kinds > 1 ? i % kinds : 0
  const hue = (k * 37) % 360
  return {
    fontFamily: 'Noto Sans JP',
    fontSize: 60 + (k % 5) * 4,
    bold: k % 2 === 0,
    italic: false,
    align: 'center',
    tracking: (k % 7) * 5,
    leading: (k % 3) * 4,
    fill: { enabled: true, color: `hsl(${hue} 90% 60%)` },
    strokes: Array.from({ length: strokes }, (_, s) => ({
      enabled: true,
      color: `hsl(${(hue + s * 24) % 360} 70% ${20 + s * 5}%)`,
      width: 10 - Math.min(8, s),
      position: 'outside'
    })),
    background: { enabled: k % 4 === 0, color: '#000000', opacity: 40 },
    shadow: { enabled: shadows > 0, color: '#000000', opacity: 70, angle: 135, distance: 6, blur: 8 },
    shadows: Array.from({ length: Math.max(0, shadows - 1) }, (_, s) => ({
      enabled: true,
      color: '#000000',
      opacity: 50,
      angle: (135 + s * 20) % 360,
      distance: 4 + s * 2,
      blur: 6 + s * 3
    }))
  }
}

function makeCues(count, totalSec, chars = 12, styleOpts = null) {
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
    track: 'V2',
    ...(styleOpts ? { style: makeStyle(i, styleOpts) } : {})
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

/** プロジェクトの中身を組み立てる（種類ごとに数を変えられる） */
function buildProject(
  video,
  totalSec,
  {
    telops = TELOPS,
    chars = 12,
    clips = 1,
    se = 0,
    imgs = 0,
    marks = 0,
    media = 1,
    /** 素材ビンに並べる「別ファイル」の一覧。省略すると全部同じファイルになる */
    mediaFiles = null,
    strokes = 0,
    shadows = 0,
    kinds = 0
  } = {}
) {
  const styleOpts =
    strokes || shadows || kinds
      ? { strokes: strokes || 1, shadows: shadows || 0, kinds: kinds || 1 }
      : null
  const spread = (n, make) =>
    Array.from({ length: n }, (_, i) => make(i, (totalSec * (i + 0.3)) / Math.max(1, n)))
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
    cues: makeCues(telops, totalSec, chars, styleOpts),
    // 効果音・画像は素材ファイルが要るが、ここで見たいのは「並んでいる数の重さ」。
    // 元動画を指しておけば、読み込みに失敗しても帯は並ぶ。
    seClips: spread(se, (i, t) => ({
      id: i + 1,
      path: video,
      name: 'se.mp4',
      tStart: +t.toFixed(2),
      duration: 1.5,
      track: 'A2'
    })),
    imgClips: spread(imgs, (i, t) => ({
      id: i + 1,
      path: video,
      name: 'img.png',
      tStart: +t.toFixed(2),
      duration: 2,
      track: 'V3'
    })),
    vClips: [],
    markers: spread(marks, (i, t) => ({ id: i + 1, t: +t.toFixed(2), label: 'め' + i })),
    // 素材ビンの中身。
    //
    // **全部が同じファイルだと、実際より軽く出る。** アプリは「同じファイルの
    // サムネは作り直さない」ので、1件ぶんの手間しかかからない。
    // 実際にフォルダを丸ごと読み込むときは全部が別ファイルなので、
    // mediaFiles（別ファイルの一覧）が渡されたらそちらを使う。
    mediaItems: Array.from({ length: media }, (_, i) => ({
      path: mediaFiles?.[i % Math.max(1, mediaFiles.length)] ?? video,
      name: `bench${i}.mp4`,
      kind: 'video'
    })),
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
  // 画面に出ている帯の数と、プロジェクトが持っているテロップの数は**別物**。
  // 画面に出ていない帯は作らない作りにしたので、帯を数えると
  // 「テロップが減った」と誤読する（実際に要注意として報告してしまった）。
  const telopBands = await page.locator('.telop-clip').count()
  const statusTxt = (await page.locator('.statusbar').first().textContent()) ?? ''
  const telopCount = Number(/(\d+) テロップ/.exec(statusTxt)?.[1] ?? 0)
  await done(
    '動作',
    'テロップが全部読み込まれている',
    `${telopCount} / ${TELOPS} 枚（画面に出ている帯は ${telopBands} 本）`,
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
    await zoomIn(visMid, inner.y + 40, 10)
    const w1 = await timelineWidth()
    if (w1 <= w0 * 1.2) throw new Error(`拡大できていない（${w0} → ${w1}px）`)
    await page.keyboard.down('Control')
    await page.mouse.move(visMid, inner.y + 40)
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
    await page.mouse.move(visMid, inner.y + 40)
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
      await page.mouse.move(visMid, inner.y + 60)
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
    await zoomIn(visMid, inner.y + 40, 10)
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
    const inner = await page.locator('.track-inner').boundingBox()
    const zoomV = await page
      .locator('.tl-zoom input[type="range"]')
      .first()
      .inputValue()
      .then(Number)
    if (at !== null && zoomV > 0) {
      // at は px（開始秒×拡大率）。0.2秒ぶん後ろへずらして、確実に表示される所を押す
      await page.mouse.click(inner.x + at + 0.2 * zoomV, rr.y + rr.height / 2)
    } else {
      const bb = await band.boundingBox()
      await page.mouse.click(bb.x + bb.width / 2, rr.y + rr.height / 2)
    }
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
    const all = page.locator('[data-tid="V1"] .video-clip')
    // 画面に見えていて掴める幅のものを選ぶ（拡大率は前の項目で変わっている）
    const vw2 = (page.viewportSize() ?? { width: 1280 }).width
    // 拡大していると1つが画面より広いこともある。画面に見えている部分があれば掴める。
    const i2 = await all.evaluateAll((els, w) => {
      for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect()
        if (r.x < w - 200 && r.x + r.width > 200) return i
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
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 30; i++) {
      await page.mouse.move(b.x + b.width / 2 + i * 5, b.y + b.height / 2)
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
  if (DO_LIMITS) {
    /**
     * 別の中身のプロジェクトを開いて、開く時間・触ったときの重さ・メモリを見る。
     * what: 何を掴むか。増やした物そのものを掴まないと、その物の重さを測ったことに
     *       ならない（テロップを4000枚に増やして動画を掴んでも、テロップの重さは出ない）。
     */
    async function probe(path, what = 'clip') {
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

      // ★拡大率は毎回きっちり同じ値から始める。
      //   ホイールで寄せると前の測定から積み上がり、条件が揃わない。
      await setZoom(30)

      // 掴んで動かしてみて、そのあいだの重さを見る。
      // 端のものは磁石で元の位置に戻るので、真ん中あたりを掴む。
      // 見た目の重さ（縁取り・影・種類）はプレビューを描くたびに効く。
      // 掴んで動かすのではなく、再生ヘッドを動かして描き直させて測る。
      if (what === 'scrub') {
        const rr = await page.locator('.ruler').boundingBox()
        // ★見えている範囲は .track-scroll で測る。
        //   .track-inner は中身そのものなので、拡大すると左端が画面の外へ出る。
        //   そこを起点にすると、トラック名の欄の上を掴むことになって何も起きない。
        const bx = await page.locator('.track-scroll').boundingBox()
        const vpw = (page.viewportSize() ?? { width: 1280 }).width
        const L = Math.max(bx.x, 0) + 20
        const R = Math.min(bx.x + bx.width, vpw) - 20
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
        const MOVES = 30
        const SLEEP = 8
        // 画面上の位置ではなくタイムライン上の位置で見る。
        // 拡大していると再生ヘッドが画面の外に出て、位置が読めなくなるため。
        const hx = () =>
          page.locator('.playhead').first().evaluate((e) => parseFloat(e.style.left) || 0)
        const hx0 = await hx()
        await page.mouse.move(L, rr.y + rr.height / 2)
        await page.mouse.down()
        const t1 = nowSec()
        for (let i = 1; i <= MOVES; i++) {
          await page.mouse.move(L + ((R - L) * i) / MOVES, rr.y + rr.height / 2)
          await page.waitForTimeout(SLEEP)
        }
        const sec = nowSec() - t1
        await page.mouse.up()
        await page.waitForTimeout(300)
        // 再生ヘッドが動いていなければ、プレビューを描き直させていない＝測っていない
        const hx1 = await hx()
        if (!(Math.abs(hx1 - hx0) > 10))
          return {
            openSec,
            lag: NaN,
            worst: NaN,
            heap: NaN,
            ok: false,
            note: `再生ヘッドが動かない（${fmt(hx0, 0)} → ${fmt(hx1, 0)} / 掴んだ範囲 ${fmt(L, 0)}〜${fmt(R, 0)}px）`
          }
        const fr = await page.evaluate(() => {
          window.__sampling = false
          return window.__frames
        })
        const st = frameStats(fr) ?? { worst: NaN }
        const hh = await heap()
        const lg = (sec * 1000 - MOVES * SLEEP) / MOVES
        return { openSec, lag: lg, worst: st.worst, heap: hh, ok: openSec <= 30 && lg <= 50, note: '' }
      }
      const sel = {
        clip: '[data-tid="V1"] .video-clip',
        telop: '.telop-clip',
        se: '[data-tid="A2"] .se-clip',
        img: '[data-tid="V3"] .img-clip'
      }
      const clips = page.locator(sel[what] ?? sel.clip)
      const nClips = await clips.count()
      if (!nClips) return { openSec, lag: NaN, worst: NaN, heap: NaN, ok: false, note: '掴む物が無い' }
      // 数が多いと1個が数pxしかなく、掴もうとしても外れる。人と同じで先に拡大する。
      // ★拡大すると狙った物が画面の外へ出るので、拡大してから選び直すこと。
      //   先に決めておくと、画面に無い場所を押して空振りする。
      // 見えている範囲は .track-scroll で測る（.track-inner は拡大で画面外へ出る）
      const box0 = await page.locator('.track-scroll').boundingBox()
      const vpw0 = (page.viewportSize() ?? { width: 1280 }).width
      const visLeft = Math.max(box0.x, 0) + 20
      const visRight = Math.min(box0.x + box0.width, vpw0) - 20
      // 掴める幅の物が画面に出るまで、拡大率を段階的に上げる（上限120）
      const findPick = (minW) =>
        clips.evaluateAll(
          (els, o) => {
            for (let i = 0; i < els.length; i++) {
              const r = els[i].getBoundingClientRect()
              if (r.width >= o.minW && r.x > o.l && r.x + r.width < o.r) return i
            }
            // 拡大しすぎて1個が画面より広い場合は、見えている部分があれば掴める
            for (let i = 0; i < els.length; i++) {
              const r = els[i].getBoundingClientRect()
              if (r.x < o.r - 100 && r.x + r.width > o.l + 100) return i
            }
            return -1
          },
          { minW, l: visLeft, r: visRight }
        )
      for (const z of [30, 50, 80, 120]) {
        if ((await findPick(24)) >= 0) break
        await setZoom(z)
      }
      const pick = await findPick(20)
      if (pick < 0)
        return { openSec, lag: NaN, worst: NaN, heap: NaN, ok: false, note: '掴める物が画面に無い' }
      const target = clips.nth(pick)
      const c = await target.boundingBox()
      if (!c) return { openSec, lag: NaN, worst: NaN, heap: NaN, ok: false, note: '掴む物が見つからない' }
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
      // 掴む点は「クリップの上」かつ「見えている範囲」に収める
      const x0 = Math.min(Math.max(c.x + 12, visLeft + 10), Math.min(c.x + c.width - 12, visRight - 260))
      const MOVES = 30
      const SLEEP = 8
      const dx = Math.max(4, Math.min(8, (c.width * 1.5) / MOVES)) // 1.5個ぶん動かす
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
        base: { telops: 100 },
        grab: 'clip'
      },
      {
        name: '効果音の数',
        key: 'se',
        values: [50, 200, 500, 1000],
        label: (v) => `${v}個`,
        base: { telops: 50, clips: 12 },
        grab: 'se'
      },
      {
        name: '画像の数',
        key: 'imgs',
        values: [50, 200, 500, 1000],
        label: (v) => `${v}枚`,
        base: { telops: 50, clips: 12 },
        grab: 'img'
      },
      {
        name: 'めじるしの数',
        key: 'marks',
        values: [200, 1000, 3000, 8000],
        label: (v) => `${v}個`,
        base: { telops: 50, clips: 12 },
        grab: 'clip'
      },
      {
        name: 'テロップの縁取りの枚数',
        key: 'strokes',
        values: [1, 3, 6, 10],
        label: (v) => `${v}枚`,
        base: { telops: 200, clips: 12, shadows: 1 },
        grab: 'scrub'
      },
      {
        name: 'テロップの影の枚数',
        key: 'shadows',
        values: [1, 3, 6, 12],
        label: (v) => `${v}枚`,
        base: { telops: 200, clips: 12, strokes: 2 },
        grab: 'scrub'
      },
      {
        name: 'テロップのスタイルの種類数',
        key: 'kinds',
        values: [1, 10, 50, 200],
        label: (v) => `${v}種`,
        base: { telops: 200, clips: 12, strokes: 2, shadows: 2 },
        grab: 'scrub'
      },
      {
        name: '素材ビンの数（同じファイル）',
        key: 'media',
        values: [10, 100, 500, 2000],
        label: (v) => `${v}件`,
        base: { telops: 50, clips: 12 },
        grab: 'clip'
      },
      {
        // フォルダを丸ごと読み込む使い方は、全部が別ファイルになる。
        // 同じファイルを並べた測定より重いはずで、そこが実際の上限になる。
        name: '素材ビンの数（全部が別ファイル）',
        key: 'media',
        values: [100, 500, 2000],
        label: (v) => `${v}件`,
        base: { telops: 50, clips: 12, mediaFiles: makeDistinctMedia(2000) },
        grab: 'clip'
      }
    ]

    /**
     * 別ファイルを n 個作る（素材ビンの「フォルダ丸ごと読み込み」を再現する）。
     *
     * 中身は同じでよいが、**パスは全部違う**必要がある。アプリは同じファイルの
     * サムネを作り直さないので、同じパスを並べると1件ぶんの手間しか出ない。
     */
    function makeDistinctMedia(n) {
      const dir = join(fx.dir, 'many')
      mkdirSync(dir, { recursive: true })
      // 元は短いものを使う（本編の10分素材を2000個ぶん解析すると、
      // 測定そのものが何時間もかかって終わらない）。
      const cacheDir = join(ROOT, 'e2e', '.cache')
      const short = existsSync(cacheDir)
        ? readdirSync(cacheDir)
            .filter((f) => f.endsWith('.mp4') && !f.startsWith('bench-'))
            .map((f) => join(cacheDir, f))[0]
        : null
      const src = short ?? video
      const out = []
      for (let i = 0; i < n; i++) {
        const f = join(dir, `m${String(i).padStart(4, '0')}.mp4`)
        if (!existsSync(f)) {
          // 中身は同じでよく、違う必要があるのは**パスだけ**。
          // 2000個コピーすると数GB使うので、ハードリンクで済ませる。
          try {
            linkSync(src, f)
          } catch {
            copyFileSync(src, f)
          }
        }
        out.push(f)
      }
      return out
    }

    for (const sw of sweeps) {
      let lastOk = null
      let broke = null
      const pts = [] // 1つあたりの重さを出すために全部の点を残す
      for (const v of sw.values) {
        const opts = { ...sw.base, [sw.key]: v }
        const p = join(fx.dir, `limit-${sw.key}-${v}.gcproj`)
        writeFileSync(p, JSON.stringify(buildProject(video, totalSec, opts)), 'utf-8')
        await say('動作', `どこまで耐えるか: ${sw.name}`, `${sw.label(v)} を開いて触ってみる`)
        // 増やした物そのものを掴む（テロップの軸ならテロップを動かす）。
        // ここを合わせないと「置いてあるだけの重さ」しか測れない。
        const r = await probe(p, sw.grab ?? 'telop')
        const line =
          `${sw.label(v)}: 開く ${fmt(r.openSec)}秒 / 1操作 ${fmt(r.lag)}ms` +
          ` / 最悪のコマ ${fmt(r.worst)}ms / メモリ ${mb(r.heap)}`
        console.log(`    ${r.ok ? '·' : '×'} ${line}${r.note ? ' … ' + r.note : ''}`)
        if (Number.isFinite(r.lag)) pts.push({ v, lag: r.lag, heap: r.heap })
        if (r.ok) lastOk = { v, r }
        else {
          broke = { v, r }
          break
        }
      }
      // 1つ増えるごとにどれだけ重くなるか（端どうしを結んだ傾き）。
      // 「どこで崩れるか」だけだと、あとどれくらい余裕があるか分からない。
      let slope = ''
      if (pts.length >= 2) {
        const a = pts[0]
        const b = pts[pts.length - 1]
        const dv = b.v - a.v
        if (dv > 0) {
          // 単位は試した範囲に合わせる。1〜10 の軸を1000倍に伸ばすと、
          // 誤差が1000倍になって「+97MB」のような意味の無い数字が出る。
          const unit = b.v >= 200 ? 1000 : b.v >= 20 ? 100 : 1
          const ms = ((b.lag - a.lag) / dv) * unit
          const mem = ((b.heap - a.heap) / dv) * unit / 1024 / 1024
          const sign = (x) => (x >= 0 ? '+' : '')
          slope =
            ` ／ ${unit}増えるごとに ${sign(ms)}${fmt(ms)}ms・${sign(mem)}${fmt(mem)}MB` +
            (Math.abs(ms) < 2 ? '（ほぼ変わらない）' : '')
        }
      }
      const detail =
        (broke
          ? `${lastOk ? sw.label(lastOk.v) : '最小の設定'} までは平気 / ${sw.label(broke.v)} で崩れる` +
            `（開く ${fmt(broke.r.openSec)}秒・1操作 ${fmt(broke.r.lag)}ms${broke.r.note ? '・' + broke.r.note : ''}）`
          : `試した上限 ${sw.label(sw.values[sw.values.length - 1])} まで平気` +
            `（そこで 開く ${fmt(lastOk.r.openSec)}秒・1操作 ${fmt(lastOk.r.lag)}ms・メモリ ${mb(lastOk.r.heap)}）`) +
        slope
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
