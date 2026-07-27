// ============================================================================
// 実物のアプリを、実際のマウス操作で上から確認していく（E2E）
//
// なぜ必要か:
//   動作確認リストの大半は「掴んで動かす」「押して離す」といった操作の連鎖で、
//   jsdom のテストでは再現できない。かといって毎回人が全部触るのは続かない。
//   ここでは Playwright から本物の Electron を起動し、本物のマウスイベントを
//   送り込んで、リストの項目を上から順に自動で消し込む。
//
//   ウィンドウは見えたまま動くので、横で眺めていられる。
//
// 安全のために:
//   --user-data-dir を一時フォルダに向けるので、**普段の自動保存や設定には
//   一切触らない**。素材も毎回 ffmpeg で作った使い捨てを使う。
//
//   npm run e2e                 通しで実行（最終確認はこれ）
//   npm run e2e -- --slow       1操作ごとに間を置いて、目で追えるようにする
//   npm run e2e -- --keep       終わってもウィンドウを閉じない
//   npm run e2e -- --only=空き  名前か章にその言葉を含むものだけ実行（開発中用）
//   （項目名の一覧は `grep "await check(" e2e/run.mjs` で見られる）
// ============================================================================
import { _electron as electron } from 'playwright'
import { spawn } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  copyFileSync,
  readdirSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const SLOW = process.argv.includes('--slow')
const KEEP = process.argv.includes('--keep')
// 開発中は追加した項目だけ回したい。--only=キーワード で名前か章を絞る。
// ただし前の項目の状態を引き継ぐ確認もあるので、**最終確認は必ず絞らずに通す**。
const argAfter = (flag) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : null
}
const ONLY =
  (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7) || argAfter('--only') || ''
const STEP = SLOW ? 600 : 0

const sh = (cmd, args) =>
  new Promise((res) => {
    const p = spawn(cmd, args)
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('error', () => res({ code: -1, err: 'spawn failed' }))
    p.on('close', (code) => res({ code, err }))
  })

// ---------------------------------------------------------------------------
// 使い捨ての素材とプロジェクトを用意する
// ---------------------------------------------------------------------------
async function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'giftcut-e2e-'))
  const userData = join(dir, 'userData')
  mkdirSync(userData, { recursive: true })
  const video = join(dir, 'test_video.mp4')
  const image = join(dir, 'test_image.png')
  const sound = join(dir, 'test_sound.wav')

  // 本物の素材があればそこから20秒だけ切り出して使う。
  // 作り物（カラーバー＋サイン波）だと、実際のコーデック・実際の音・実際の絵で
  // しか出ない問題を見逃す。ただし元ファイルは数百MB〜数GBあるので、
  // 冒頭を切り出して軽くしてから使う。無ければ作り物にする（他の環境でも動くように）。
  const DL = 'C:/Users/kyohei/Downloads'
  const pick = (re, maxBytes) => {
    try {
      return readdirSync(DL)
        .filter((f) => re.test(f))
        .map((f) => ({ f: join(DL, f), size: statSync(join(DL, f)).size }))
        .filter((x) => x.size > 0 && x.size < maxBytes)
        .sort((a, b) => a.size - b.size)[0]?.f
    } catch {
      return undefined
    }
  }
  const realVideo = pick(/\.(mp4|mov|mkv)$/i, 4e9)
  const realImage = pick(/\.(png|jpe?g)$/i, 5e6)

  // 切り出しは重いので、一度作ったら使い回す（毎回1から作り直さない）。
  // 元ファイルが変わったら作り直せるよう、名前とサイズをキャッシュ名に入れる。
  const cacheDir = join(ROOT, 'e2e', '.cache')
  mkdirSync(cacheDir, { recursive: true })
  const cached = realVideo
    ? join(cacheDir, `src-${realVideo.split(/[\\/]/).pop().replace(/[^\w.]/g, '_')}-${statSync(realVideo).size}.mp4`)
    : null

  let r = { code: 1 }
  if (realVideo && cached && existsSync(cached)) {
    console.log(`実素材（作成済みを再利用）: ${realVideo.split(/[\\/]/).pop()}`)
    copyFileSync(cached, video)
    r = { code: 0 }
  } else if (realVideo) {
    console.log(`実素材を使用: ${realVideo.split(/[\\/]/).pop()}（冒頭20秒を切り出し。次回からは再利用）`)
    r = await sh('ffmpeg', [
      '-y', '-t', '20', '-i', realVideo,
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-vf', 'scale=640:-2', '-c:a', 'aac', '-ac', '2', '-ar', '48000', video
    ])
    if (r.code === 0 && cached) {
      try {
        copyFileSync(video, cached)
      } catch {
        /* 保存できなくても動作には影響しない */
      }
    }
  }
  if (!realVideo || r.code !== 0) {
    r = await sh('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=20',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video
    ])
  }
  if (r.code !== 0) throw new Error('テスト用の動画を作れませんでした（ffmpeg が必要）: ' + r.err.slice(-300))

  r = realImage
    ? await sh('ffmpeg', ['-y', '-i', realImage, '-vf', 'scale=320:-2', '-frames:v', '1', image])
    : { code: 1 }
  if (r.code !== 0) {
    r = await sh('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=200x200:d=1', '-frames:v', '1', image])
  }
  if (r.code !== 0) throw new Error('テスト用の画像を作れませんでした')
  r = await sh('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2', sound])
  if (r.code !== 0) throw new Error('テスト用の音声を作れませんでした')

  // 起動した瞬間に「編集途中の状態」から始められるよう、自動保存を仕込んでおく。
  // 素材の読み込みは OS のファイル選択ダイアログを通るので自動化できない。
  // 自動保存からの復元なら、本番と同じ経路のままダイアログを避けられる。
  const project = {
    version: 1,
    videoPath: video,
    srtPath: null,
    sources: [{ id: 1, path: video, name: 'test_video.mp4' }],
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
    // 3つに切ったクリップ（それぞれ5秒）
    segments: [
      { id: 1, srcId: 1, srcStart: 0, srcEnd: 5 },
      { id: 2, srcId: 1, srcStart: 5, srcEnd: 10 },
      { id: 3, srcId: 1, srcStart: 10, srcEnd: 15 }
    ],
    cues: [
      { id: 1, start: 1, end: 3, text: 'ひとつめ', track: 'V2' },
      { id: 2, start: 6, end: 8, text: 'ふたつめ', track: 'V2' }
    ],
    seClips: [
      { id: 1, path: sound, name: 'test_sound.wav', tStart: 2, duration: 2, track: 'A2' }
    ],
    imgClips: [
      { id: 1, path: image, name: 'test_image.png', tStart: 1, duration: 4, track: 'V3' }
    ],
    vClips: [],
    markers: [{ id: 1, t: 12, label: 'めじるし' }],
    mediaItems: [
      { path: video, name: 'test_video.mp4', kind: 'video' },
      { path: image, name: 'test_image.png', kind: 'image' },
      { path: sound, name: 'test_sound.wav', kind: 'audio' }
    ],
    iconSide: 'l',
    iconOffset: { x: 0, y: 0 },
    iconScale: 1
  }
  writeFileSync(join(userData, 'giftcut-autosave.json'), JSON.stringify(project), 'utf-8')
  // 同じ内容をプロジェクトファイルにも書いておく。各章の前にこれを開き直して、
  // どの確認も「同じ状態から始める」ようにする（前の章の操作を引きずらない）。
  // 字幕ファイル。本物があればそれを使う（実際の改行や記号が入っているので、
  // 自分で作ったきれいなものでは出ない問題が見つかる）。
  const srt = join(dir, 'test.srt')
  const realSrt = pick(/\.srt$/i, 2e6)
  if (realSrt) {
    try {
      writeFileSync(srt, readFileSync(realSrt, 'utf-8'), 'utf-8')
    } catch {
      /* 読めなければ作り物にする */
    }
  }
  if (!existsSync(srt)) {
    const cue = (n, a, b, t) => `${n}
00:00:0${a},000 --> 00:00:0${b},000
${t}

`
    writeFileSync(
      srt,
      cue(1, 1, 3, 'よみこんだ字幕1') + cue(2, 4, 6, 'よみこんだ字幕2') + cue(3, 7, 9, 'よみこんだ字幕3'),
      'utf-8'
    )
  }
  const gcproj = join(dir, 'fixture.gcproj')
  writeFileSync(gcproj, JSON.stringify(project), 'utf-8')
  return { dir, userData, video, image, sound, srt, gcproj }
}

// ---------------------------------------------------------------------------
// 結果の集計
// ---------------------------------------------------------------------------
const results = []
let curSection = ''
let pageRef = null
const TOTAL_HINT = 46 // だいたいの件数（進み具合の表示用。増減しても表示が崩れないだけ）

/**
 * アプリの画面に「今なにを確認しているか」を出す。
 *
 * 操作が速すぎて何のテストか分からない、という声を受けて足した。
 * アプリのコードには一切触らず、テスト側から画面に札を貼るだけ。
 * pointer-events: none なので、テストのクリック判定には影響しない。
 */
async function banner(state) {
  if (!pageRef) return
  try {
    await pageRef.evaluate((s) => {
      let el = document.getElementById('__e2e_banner')
      if (!el) {
        el = document.createElement('div')
        el.id = '__e2e_banner'
        el.style.cssText = [
          'position:fixed', 'left:50%', 'top:14px', 'transform:translateX(-50%)',
          'z-index:2147483647', 'pointer-events:none',
          'font:13px/1.5 system-ui,sans-serif', 'color:#fff',
          'background:#0b1220f2', 'border:1px solid #ffffff26', 'border-radius:12px',
          'padding:10px 16px', 'min-width:420px', 'max-width:78vw',
          'box-shadow:0 8px 30px #0009', 'text-align:center'
        ].join(';')
        document.body.appendChild(el)
      }
      const color = s.status === 'ok' ? '#4ade80' : s.status === 'ng' ? '#f87171' : '#7dd3fc'
      const mark = s.status === 'ok' ? '✓' : s.status === 'ng' ? '✗' : '▶'
      el.innerHTML =
        `<div style="font-size:11px;opacity:.6;letter-spacing:.06em">${s.section} ・ ${s.done}/${s.total}</div>` +
        `<div style="margin-top:3px;font-size:14px;font-weight:700;color:${color}">${mark} ${s.name}</div>` +
        (s.err ? `<div style="margin-top:4px;font-size:11px;color:#fca5a5">${s.err}</div>` : '') +
        `<div style="margin-top:8px;height:3px;background:#ffffff1a;border-radius:2px;overflow:hidden">` +
        `<div style="height:100%;width:${Math.round((s.done / Math.max(1, s.total)) * 100)}%;background:${color}"></div></div>`
    }, state)
  } catch {
    /* 画面が入れ替わった直後などは無視 */
  }
}
const esc = (t) => String(t).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])

async function section(name) {
  curSection = name
  console.log(`\n\x1b[1m${name}\x1b[0m`)
}
async function check(name, fn, opts = {}) {
  // setup:true の項目は「絞っても必ず通す」。ここを飛ばすと編集中の状態が
  // 作られず、以降が全部こけて何を見ているのか分からなくなる。
  if (ONLY && !opts.setup && !name.includes(ONLY) && !curSection.includes(ONLY)) {
    results.push({ name, skipped: true })
    return
  }
  const total = Math.max(TOTAL_HINT, results.length + 1)
  await banner({ status: 'run', name: esc(name), section: esc(curSection), done: results.length, total })
  // 何を確認しているか読めるだけの間を置く（--slow ならもっと長く）
  if (pageRef) await pageRef.waitForTimeout(SLOW ? 900 : 320)
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
    await banner({ status: 'ok', name: esc(name), section: esc(curSection), done: results.length, total })
  } catch (e) {
    const msg = String(e?.message ?? e).split('\n')[0]
    results.push({ name, ok: false, err: String(e?.message ?? e) })
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${msg}`)
    await banner({
      status: 'ng',
      name: esc(name),
      section: esc(curSection),
      done: results.length,
      total,
      err: esc(msg)
    })
    if (pageRef) await pageRef.waitForTimeout(1200) // 失敗は読む時間を長めに
  }
  if (pageRef) await pageRef.waitForTimeout(SLOW ? 500 : 180)
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}
function near(a, b, tol, msg) {
  assert(Math.abs(a - b) <= tol, `${msg}（実際: ${a}, 期待: ${b} ±${tol}）`)
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------
let fx, app, page
try {
  if (!existsSync(join(ROOT, 'out/main/index.js'))) {
    console.error('先に `npm run build` を実行してください（out/main/index.js が必要）。')
    process.exit(2)
  }
  console.log('テスト用の素材を作成中…')
  fx = await makeFixture()

  app = await electron.launch({
    executablePath: require('electron'),
    args: [ROOT, `--user-data-dir=${fx.userData}`],
    cwd: ROOT
  })
  page = await app.firstWindow()
  pageRef = page
  await page.waitForSelector('.app', { timeout: 20000 })
  page.setDefaultTimeout(8000)

  // OS のファイル選択・保存ダイアログは自動で操作できないので、
  // メインプロセス側で差し替えて「このファイルを選んだことにする」。
  // アプリのコードには手を入れず、テストのときだけ外から書き換える。
  const outDir = join(fx.dir, 'out')
  mkdirSync(outDir, { recursive: true })
  await app.evaluate(
    ({ dialog }, { video, image, sound, outDir }) => {
      const g = globalThis
      g.__e2e = { open: [video], save: join_(outDir, 'export.mp4') }
      function join_(a, b) {
        return a + (a.includes('\\') ? '\\' : '/') + b
      }
      g.__e2eMedia = { video, image, sound }
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: g.__e2e.open })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: g.__e2e.save })
    },
    { video: fx.video, image: fx.image, sound: fx.sound, outDir }
  )
  /** 次に「開く／保存」で選ばれるファイルを差し替える */
  const setDialogFiles = (open, save) =>
    app.evaluate(
      (_e, { open, save }) => {
        if (open) globalThis.__e2e.open = open
        if (save) globalThis.__e2e.save = save
      },
      { open, save }
    )

  // -------------------------------------------------------------------------
  // 目で見る確認（スクリーンショットを撮って ffmpeg で中身を測る）
  // -------------------------------------------------------------------------
  const shotDir = join(ROOT, 'e2e', 'shots')
  mkdirSync(shotDir, { recursive: true })
  let shotNo = 0
  /** 画面（または一部）を撮って保存する。あとから目で見返せる記録にもなる。 */
  async function shot(label, locator) {
    const f = join(shotDir, `${String(++shotNo).padStart(2, '0')}-${label.replace(/[^\w一-龥ぁ-んァ-ヶー]/g, '_').slice(0, 40)}.png`)
    if (locator) await locator.screenshot({ path: f })
    else await page.screenshot({ path: f })
    return f
  }
  /**
   * 2枚の画像がどれくらい同じか（1.0 = 完全に同じ）。
   * 「帯が出ていない＝空いている所と同じに見える」のような、
   * 数値では確かめられない見た目の判定に使う。
   */
  async function similarity(a, b) {
    const p = spawn('ffmpeg', ['-i', a, '-i', b, '-filter_complex', 'ssim', '-f', 'null', '-'])
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    await new Promise((res) => p.on('close', res))
    const m = /All:([\d.]+)/.exec(err)
    assert(m, `見た目を比べられなかった:\n${err.slice(-300)}`)
    return parseFloat(m[1])
  }
  /** 画像の平均色（0〜255）。赤くなったか、暗くなったかを測る。 */
  async function avgColor(f) {
    const p = spawn('ffmpeg', ['-i', f, '-vf', 'signalstats,metadata=print', '-f', 'null', '-'])
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    await new Promise((res) => p.on('close', res))
    const g = (k) => {
      const m = new RegExp(`lavfi\\.signalstats\\.${k}=([\\d.]+)`).exec(err)
      return m ? parseFloat(m[1]) : null
    }
    const min = g('YMIN')
    const max = g('YMAX')
    // V が大きいほど赤寄り。range は明暗の幅＝「模様があるか（帯や文字が乗っているか）」
    return {
      y: g('YAVG'),
      u: g('UAVG'),
      v: g('VAVG'),
      range: min != null && max != null ? max - min : null
    }
  }

  // -------------------------------------------------------------------------
  // 耳で聴く確認（書き出した音を ffmpeg で測る）
  // -------------------------------------------------------------------------
  const ffAudio = async (file, filter, re) => {
    const p = spawn('ffmpeg', ['-i', file, '-af', filter, '-f', 'null', '-'])
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    await new Promise((res) => p.on('close', res))
    return { err, m: re ? err.match(re) : null }
  }
  /** 平均音量(dB)。無音なら -91 付近になる。 */
  async function meanVolume(file) {
    const { err } = await ffAudio(file, 'volumedetect')
    const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(err)
    return m ? parseFloat(m[1]) : null
  }
  /** 無音が続いた区間（秒）の一覧。音の途切れを見つける。 */
  async function silences(file, thresholdDb = -50, minSec = 0.4) {
    const { err } = await ffAudio(file, `silencedetect=noise=${thresholdDb}dB:d=${minSec}`)
    const out = []
    const re = /silence_start:\s*(-?[\d.]+)[\s\S]*?silence_duration:\s*([\d.]+)/g
    let m
    while ((m = re.exec(err))) out.push({ start: parseFloat(m[1]), dur: parseFloat(m[2]) })
    return out
  }
  /** 全体のラウドネス(LUFS)。「音量が揃っているか」の判定に使う。 */
  async function loudness(file) {
    const { err } = await ffAudio(file, 'ebur128=framelog=quiet')
    const m = /I:\s*(-?[\d.]+) LUFS/.exec(err)
    return m ? parseFloat(m[1]) : null
  }

  const pause = async () => {
    if (STEP) await page.waitForTimeout(STEP)
  }
  /** 実際のマウスで掴んで動かす。dx はピクセル。修飾キーは押しっぱなしにできる。 */
  async function dragBy(locator, dx, dy = 0, mods = []) {
    const box = await locator.boundingBox()
    assert(box, '掴む対象が画面に見つかりません')
    const x = box.x + Math.min(box.width / 2, 40)
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (const m of mods) await page.keyboard.down(m)
    // 何回かに分けて動かす（一気に飛ばすと途中経過の処理が走らない）
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(x + (dx * i) / 6, y + (dy * i) / 6)
      if (STEP) await page.waitForTimeout(STEP / 6)
    }
    await page.mouse.up()
    for (const m of mods) await page.keyboard.up(m)
    await pause()
  }
  /** V1（本編）のクリップ一覧。左からの並び順で返す。 */
  const v1Clips = () => page.locator('[data-tid="V1"] .video-clip:not(.se-ghost)')
  /**
   * 用意した状態に戻す。各章の頭で呼ぶ。
   * 前の章の操作が残っていると、失敗の原因が「今見ている物」なのか
   * 「前の章の後始末漏れ」なのか分からなくなる。
   */
  async function resetProject() {
    await setDialogFiles([fx.gcproj], null)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(400)
    // 未保存の確認が出たら進める
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) {
      await cont.click()
      await page.waitForTimeout(300)
    }
    await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 15000 })
    await page.waitForTimeout(700)
    assert((await v1Clips().count()) === 3, '状態を戻せなかった（クリップが3つにならない）')
  }
  /** 秒を指定して再生位置を移す（拡大率に依存しない） */
  async function seekTo(sec) {
    const pps = (await clipW()) / 5 // クリップ1つ＝5秒
    const rb = await page.locator('.ruler').boundingBox()
    const inner = await page.locator('.track-inner').boundingBox()
    await page.mouse.click(inner.x + sec * pps, rb.y + rb.height / 2)
    await page.waitForTimeout(300)
  }
  /** クリップ1つぶんの幅（＝5秒）。拡大率が変わっても壊れないよう、距離はこれを基準にする。 */
  async function clipW() {
    const b = await v1Clips().nth(0).boundingBox()
    return b.width
  }
  /** クリップの左端の位置（px）と幅を並べたもの。移動の前後比較に使う。 */
  async function clipLayout() {
    const n = await v1Clips().count()
    const out = []
    for (let i = 0; i < n; i++) {
      const b = await v1Clips().nth(i).boundingBox()
      const t = (await v1Clips().nth(i).textContent()) ?? ''
      out.push({ x: Math.round(b.x), w: Math.round(b.width), text: t.trim() })
    }
    return out
  }

  // =========================================================================
  section('1. 起動と、前回の続きから始める')

  await check(
    '前回の続きを復元するか聞かれる',
    async () => {
    await page.waitForSelector('.restore-box', { timeout: 15000 })
      const t = await page.locator('.restore-title').textContent()
      assert(t.includes('前回の作業'), `見出しが違う: ${t}`)
    },
    { setup: true }
  )

  await check(
    '「復元する」でクリップ・文字・効果音・画像が全部戻る',
    async () => {
    await page.locator('.restore-btns button', { hasText: '復元' }).first().click()
    await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 15000 })
    await pause()
    assert((await v1Clips().count()) === 3, `本編のクリップが3つでない（${await v1Clips().count()}）`)
    assert((await page.locator('.telop-clip').count()) === 2, '文字が2つ出ていない')
    assert((await page.locator('.se-clip').count()) === 1, '効果音が出ていない')
      assert((await page.locator('.img-clip:not(.se-ghost)').count()) === 1, '画像が出ていない')
    },
    { setup: true }
  )

  // =========================================================================
  section('4. クリップを掴んで動かす')

  await resetProject()
  let before = await clipLayout()
  const W = await clipW() // クリップ1つ＝5秒ぶんの幅

  await check('掴んで動かしている間、ブラウザ標準のドラッグ（半透明の影と🚫）が始まらない', async () => {
    // 標準のドラッグが始まると dragstart が飛ぶ。1回でも飛んだらアウト。
    await page.evaluate(() => {
      window.__dragstarts = 0
      window.addEventListener('dragstart', () => (window.__dragstarts++), true)
    })
    // 隣のクリップを丸ごと踏まない量だけ動かす（踏むと上書きで数が減り、
    // 「位置が動いたか」と「上書きされたか」の区別がつかなくなる）
    await dragBy(v1Clips().nth(0), W * 0.35)
    const n = await page.evaluate(() => window.__dragstarts)
    assert(n === 0, `標準のドラッグが ${n} 回始まってしまった`)
  })

  await check('掴んで右へ動かすと、その位置へ移動する', async () => {
    const after = await clipLayout()
    assert(after.length === before.length, `クリップの数が変わった（${before.length} → ${after.length}）`)
    // 動かした跡には何も残らないので、先頭のクリップは元より右から始まる
    assert(after[0].x > before[0].x + 5, `先頭に空きができていない（${before[0].x} → ${after[0].x}）`)
  })

  await check('元の場所はただの空きになり（「空白」の帯は出ない）、他のクリップは動かない', async () => {
    const after = await clipLayout()
    const texts = after.map((c) => c.text).join(' / ')
    assert(!texts.includes('空白'), `動かした跡の帯が残っている: ${texts}`)
    // 踏んでいない最後のクリップは1ミリも動かない（後ろが押し出されない＝上書き配置）
    near(after[after.length - 1].x, before[before.length - 1].x, 2, '後ろのクリップが動いてしまった')
  })

  await check('Ctrl+Z で元の位置に戻る', async () => {
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
    const after = await clipLayout()
    assert(after.length === before.length, `クリップ数が戻っていない（${after.length} / ${before.length}）`)
    near(after[0].x, before[0].x, 2, '先頭のクリップが元の位置に戻っていない')
  })

  await check('離すと丸ごと消えるクリップが、離す前に赤く縁取られる', async () => {
    // 黙って消えると事故になるので、掴んでいる間に気づけること
    const box = await v1Clips().nth(0).boundingBox()
    const w = box.width
    const x = box.x + 20
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    // 隣のクリップをちょうど丸ごと踏む位置まで運ぶ
    for (let i = 1; i <= 6; i++) await page.mouse.move(x + (w * i) / 6, y)
    await page.waitForTimeout(250)
    const marked = await page.locator('.clip-overwrite').count()
    await page.mouse.move(x, y) // 戻してから離す（実際には動かさない）
    await page.waitForTimeout(200)
    const cleared = await page.locator('.clip-overwrite').count()
    await page.mouse.up()
    await page.waitForTimeout(300)
    assert(marked > 0, '丸ごと踏む位置に来ても警告が出ない')
    assert(cleared === 0, '踏まない位置へ戻しても警告が消えない')
    assert((await page.locator('.clip-overwrite').count()) === 0, '離したあとも警告が残っている')
  })

  await check('動かしてできた空きをクリックして選び、D で消せる（＝詰まる）', async () => {
    await resetProject()
    const base = await clipLayout()
    const W2 = await clipW()
    await dragBy(v1Clips().nth(0), W2 * 0.6) // 先頭に空きを作る
    const gap = page.locator('[data-tid="V1"] .gap-clip')
    assert(await gap.count(), '空きをクリックする場所が無い（当たり判定が無い）')
    await gap.first().click()
    await page.waitForTimeout(250)
    const selCls = (await gap.first().getAttribute('class')) ?? ''
    assert(selCls.includes('clip-selected'), '空きをクリックしても選ばれない')
    await page.keyboard.press('d') // 空きを「消す」＝その空きが無くなる＝詰まる
    await page.waitForTimeout(500)
    const after = await clipLayout()
    assert(after[0].x < base[0].x + W2 * 0.6, `空きが詰まっていない（${after[0].x}）`)
  })

  await check('空きの途中に文字があると、その手前で止まる（文字を巻き込まない）', async () => {
    await resetProject()
    const W2 = await clipW()
    // 先頭のクリップを大きく右へ動かす → 文字（1〜3秒）を含む空きができる
    await dragBy(v1Clips().nth(0), W2 * 2.2)
    const gapBefore = await page.locator('[data-tid="V1"] .gap-clip').first().boundingBox()
    assert(gapBefore, '空きができていない')
    await page.locator('[data-tid="V1"] .gap-clip').first().click()
    await page.keyboard.press('f')
    await page.waitForTimeout(500)
    // 文字は消えない（巻き込んで削らない）
    assert((await page.locator('.telop-clip').count()) === 2, '文字が消えてしまった')
    // 文字の手前までしか詰めないので、空きはまだ残っている
    const gapAfter = await page.locator('[data-tid="V1"] .gap-clip').first().boundingBox()
    assert(gapAfter, '文字を飛び越えて空きを全部消してしまった')
    assert(
      gapAfter.width < gapBefore.width - 2,
      `空きが縮んでいない（${Math.round(gapBefore.width)} → ${Math.round(gapAfter?.width ?? 0)}）`
    )
    // もう一度押すと、今度は文字が先頭に来ているので「これ以上は詰められない」と伝える
    await page.locator('[data-tid="V1"] .gap-clip').first().click()
    await page.keyboard.press('f')
    await page.waitForTimeout(400)
    assert((await page.locator('.telop-clip').count()) === 2, '2回目で文字が消えた')
  })

  await check('空きは掴んでも動かない（穴が増殖しない）', async () => {
    const n0 = await page.locator('[data-tid="V1"] .gap-clip').count()
    if (n0) {
      await dragBy(page.locator('[data-tid="V1"] .gap-clip').first(), 60)
      const n1 = await page.locator('[data-tid="V1"] .gap-clip').count()
      assert(n1 <= n0, `空きが増えた（${n0} → ${n1}）`)
    }
    await resetProject()
  })

  await check('同じ素材の断片は、元動画のどこを使っているかで見分けられる', async () => {
    const texts = await v1Clips().evaluateAll((els) => els.map((e) => e.textContent ?? ''))
    assert(texts.length > 1, 'クリップが1つしかないので確認できない')
    const ins = texts.map((t) => (t.match(/(\d+:\d+(?:\.\d+)?)〜/) ?? [])[1])
    assert(ins.every(Boolean), `イン点が出ていないクリップがある: ${texts.join(' | ')}`)
    assert(new Set(ins).size === ins.length, `イン点が重複している: ${ins.join(', ')}`)
  })

  await check('Alt+ドラッグで複製できる（元はその場に残る）', async () => {
    const n0 = await v1Clips().count()
    await dragBy(v1Clips().nth(0), W * 0.5, 0, ['Alt'])
    const n1 = await v1Clips().count()
    assert(n1 > n0, `クリップが増えていない（${n0} → ${n1}）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('Ctrl+ドラッグで割り込みできる（後ろがずれる）', async () => {
    const total0 = (await clipLayout()).reduce((a, c) => a + c.w, 0)
    await dragBy(v1Clips().nth(2), -W * 1.5, 0, ['Control'])
    const after = await clipLayout()
    const total1 = after.reduce((a, c) => a + c.w, 0)
    // 割り込みは長さの合計を変えない（空白を作らずに詰めて差し込む）
    near(total1, total0, 6, '割り込みで全体の長さが変わってしまった')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  // =========================================================================
  section('6. プレビュー画面での直接操作')

  await check('プレビューに出ている画像を掴むと、画像が動く（下の動画が動かない）', async () => {
    await seekTo(3) // 画像が映っている時刻へ
    const img = page.locator('.screen-img').first()
    assert(await img.count(), 'プレビューに画像が出ていない')
    await dragBy(img, 40, 20)
    // 画像が選ばれ、右パネルが画像の設定になっていること
    const sel = await page.locator('.img-clip.clip-selected').count()
    assert(sel > 0, '画像が選ばれていない（クリックが下の動画に吸われている）')
  })

  // =========================================================================
  section('10. リップル削除（消して後ろを詰める）')
  await resetProject()

  await check('効果音を右クリック →「リップル削除」が出る', async () => {
    await page.locator('.se-clip').first().click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const item = page.locator('.ctx-item', { hasText: 'リップル削除' })
    assert(await item.count(), 'メニューに「リップル削除」が無い')
    await page.keyboard.press('Escape')
  })

  await check('文字をリップル削除すると、同じ段の後ろだけが詰まる', async () => {
    const t0 = await page.locator('.telop-clip').nth(0).boundingBox()
    const t1 = await page.locator('.telop-clip').nth(1).boundingBox()
    await page.locator('.telop-clip').nth(0).click()
    await page.locator('.telop-clip').nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    await page.locator('.ctx-item', { hasText: 'リップル削除' }).first().click()
    await page.waitForTimeout(400)
    assert((await page.locator('.telop-clip').count()) === 1, '文字が1つになっていない')
    const rest = await page.locator('.telop-clip').first().boundingBox()
    assert(rest.x < t1.x - 5, `後ろの文字が前へ詰まっていない（${Math.round(t1.x)} → ${Math.round(rest.x)}）`)
    void t0
  })

  // =========================================================================
  section('5. 選ぶ操作とキー操作')
  await resetProject()

  await check('Ctrl+A で全部選んで Delete → 全部消える（トラックは消えない）', async () => {
    await page.locator('.track-scroll').click({ position: { x: 600, y: 30 } })
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Delete')
    await page.waitForTimeout(500)
    assert((await v1Clips().count()) === 0, '本編のクリップが残っている')
    assert((await page.locator('.telop-clip').count()) === 0, '文字が残っている')
    assert((await page.locator('[data-tid="V1"]').count()) === 1, 'トラックまで消えてしまった')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
    assert((await v1Clips().count()) > 0, 'Ctrl+Z で戻らない')
  })

  await check('音量つまみを触った直後の矢印キーで、再生位置が動く（つまみが動かない）', async () => {
    await v1Clips().nth(0).click()
    await page.waitForTimeout(200)
    const slider = page.locator('.sp-row input[type="range"]').first()
    assert(await slider.count(), '右パネルにつまみが出ていない')
    // 再生位置は「再生ヘッドの左端の座標」で見る（表示形式に依存しない）
    const headX = async () =>
      page.locator('.playhead').first().evaluate((el) => el.getBoundingClientRect().x)
    const v0 = await slider.inputValue()
    await slider.click()
    const x0 = await headX()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(300)
    const v1 = await slider.inputValue()
    const x1 = await headX()
    assert(v0 === v1, `つまみの値が矢印キーで動いた（${v0} → ${v1}）`)
    assert(Math.abs(x1 - x0) > 0.5, '再生位置が動かなかった（矢印キーがつまみに取られている）')
  })

  /** 画像や重ねた動画が映っていない時刻へ再生位置を移す（プレビュー本体を掴めるように） */
  async function seekToBareVideo() {
    await seekTo(12) // 画像は 1〜5秒。そこを外した所へ
    assert(
      (await page.locator('.screen-img').count()) === 0,
      'プレビューに画像が出たままで、映像本体を掴めない'
    )
  }

  await check('プレビューをクリックして枠を出し、Escape で枠が消える', async () => {
    await seekToBareVideo()
    await page.locator('.screen-video').first().click({ position: { x: 30, y: 30 } })
    await page.waitForTimeout(250)
    const had = await page.locator('.reframe-box').count()
    assert(had > 0, 'プレビューをクリックしても枠が出ない')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
    assert((await page.locator('.reframe-box').count()) === 0, 'Escape で枠が消えない')
  })

  await check('枠が出た状態でタイムライン上をホイールしても、映像が拡大しない', async () => {
    await seekToBareVideo()
    await page.locator('.screen-video').first().click({ position: { x: 30, y: 30 } })
    await page.waitForTimeout(200)
    const before = await page.locator('.screen-video').first().evaluate((el) => el.style.transform)
    const tl = await page.locator('.track-scroll').boundingBox()
    await page.mouse.move(tl.x + 300, tl.y + 60)
    await page.mouse.wheel(0, -400)
    await page.waitForTimeout(300)
    const after = await page.locator('.screen-video').first().evaluate((el) => el.style.transform)
    assert(before === after, `ホイールで映像が変わった（${before} → ${after}）`)
    await page.keyboard.press('Escape')
  })

  // =========================================================================
  section('7. 文字（テロップ）')
  await resetProject()

  await check('T キーで文字ができ、もう一度押すと1段上にできる', async () => {
    const n0 = await page.locator('.telop-clip').count()
    await page.locator('.track-scroll').click({ position: { x: 700, y: 30 } })
    await page.keyboard.press('t')
    await page.waitForTimeout(400)
    const n1 = await page.locator('.telop-clip').count()
    assert(n1 === n0 + 1, `文字が増えていない（${n0} → ${n1}）`)
    const onV2 = await page.locator('[data-tid="V2"] .telop-clip').count()
    assert(onV2 > 0, '上から2段目に作られていない')
    await page.keyboard.press('t')
    await page.waitForTimeout(400)
    const onV3 = await page.locator('[data-tid="V3"] .telop-clip').count()
    assert(onV3 > 0, '同じ位置で2回目を押しても1段上にできていない')
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  // =========================================================================
  section('11. トラック（段）')
  await resetProject()

  /** 指定した段のヘッダー（V1 / A1 など） */
  const trackHead = (id) => page.locator('.th', { has: page.locator('.th-name', { hasText: new RegExp(`^${id}$`) }) })

  await check('トラック名をダブルクリックして名前を変えられる', async () => {
    const name = page.locator('.th-name').first()
    const before = await name.textContent()
    await name.dblclick()
    await page.waitForTimeout(300)
    const input = page.locator('.modal-input')
    assert(await input.count(), 'ダブルクリックしても名前の入力欄が出ない')
    await input.fill('テスト段')
    await page.locator('.modal-btn.primary').click()
    await page.waitForTimeout(300)
    const after = await page.locator('.th-name').first().textContent()
    assert(after === 'テスト段', `名前が変わっていない: ${before} → ${after}`)
  })

  await check('トラック名をクリックしても、意味のない青い表示にならない', async () => {
    // 以前は「ターゲット」という、どこからも参照されない死んだ表示に占領されていた
    await page.locator('.th-name').first().click()
    await page.waitForTimeout(200)
    const cls = await page.locator('.th').first().getAttribute('class')
    assert(cls.includes('th-selected'), 'クリックしてもトラックが選択状態にならない')
  })

  await check('鍵をかけると、そのトラックのクリップを動かせない', async () => {
    const btn = trackHead('V1').locator('button[title="ロック"]').first()
    assert(await btn.count(), 'V1 の鍵ボタンが見つからない')
    const before = await clipLayout()
    await btn.click()
    await page.waitForTimeout(300)
    await dragBy(v1Clips().nth(0), W * 1.2)
    const after = await clipLayout()
    near(after[0].x, before[0].x, 2, '鍵をかけたのにクリップが動いた')
    await btn.click() // 鍵を戻す
    await page.waitForTimeout(300)
    await dragBy(v1Clips().nth(0), 150)
    const after2 = await clipLayout()
    assert(after2[0].x > before[0].x + 5, '鍵を外しても動かせないままになっている')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  // =========================================================================
  section('9・13. 音と書き出し（一番損害の大きい事故を機械で見る）')

  await check('ソロにしたまま書き出しても、他のトラックの音が消えない', async () => {
    // ソロは「自分で聞くためだけ」の機能。書き出しに効いてしまうと、
    // 出来上がった動画から本編の音が丸ごと消えるという最悪の事故になる。
    const soloBtn = trackHead('A1').locator('button[title="ソロ"]').first()
    assert(await soloBtn.count(), 'A1 のソロボタンが見つからない')

    const exportOnce = async (label) => {
      const out = join(outDir, `${label}.mp4`)
      await setDialogFiles(null, out)
      await page.keyboard.press('Control+m') // 書き出しの設定画面を開く
      await page.waitForSelector('.export-overlay', { timeout: 8000 })
      await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
      // 完了まで待つ（進捗のオーバーレイが消えるまで）
      await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 240000 })
      assert(existsSync(out), `書き出しファイルができていない: ${out}`)
      return out
    }
    const plain = await exportOnce('plain')
    await soloBtn.click() // どこかのトラックをソロにする
    await page.waitForTimeout(300)
    const solo = await exportOnce('solo')
    await soloBtn.click() // 戻す

    // 音量を測って比べる（ソロで本編の音が消えていれば無音に近くなる）
    const loud = async (f) => {
      const p = spawn('ffmpeg', ['-i', f, '-af', 'volumedetect', '-f', 'null', '-'])
      let err = ''
      p.stderr.on('data', (d) => (err += d))
      await new Promise((res) => p.on('close', res))
      const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(err)
      return m ? parseFloat(m[1]) : null
    }
    const a = await loud(plain)
    const b = await loud(solo)
    assert(a !== null && b !== null, '書き出したファイルの音量を測れなかった')
    assert(b > -60, `ソロのまま書き出したら音がほぼ消えた（${b} dB）`)
    near(b, a, 6, `ソロの有無で書き出しの音量が変わった（通常 ${a} dB / ソロ ${b} dB）`)
  })

  // =========================================================================
  section('3. 素材のドラッグと「置けません」マーク')
  await resetProject()

  /** 素材ビンのカード。しまわれている種類は先に開く。 */
  async function binCardReady(name) {
    const card = page.locator('.media-card', { hasText: name }).first()
    if (await card.isVisible().catch(() => false)) return card
    // 素材ビンは種類ごとの折りたたみ（「▶ 画像（1）」など）。閉じているものを順に開く。
    for (const label of ['画像', 'SE', '音声', '動画']) {
      const acc = page.locator('.tpl-acc', { hasText: label })
      const cnt = await acc.count()
      for (let i = 0; i < cnt; i++) {
        const one = acc.nth(i)
        if (!(await one.isVisible().catch(() => false))) continue
        const cls = (await one.getAttribute('class')) ?? ''
        if (cls.includes('open')) continue
        await one.click()
        await page.waitForTimeout(200)
        if (await card.isVisible().catch(() => false)) return card
      }
    }
    assert(
      await card.isVisible().catch(() => false),
      `素材ビンに「${name}」が見当たらない（折りたたみを開けなかった）`
    )
    return card
  }
  const binCard = (name) => page.locator('.media-card', { hasText: name }).first()
  /**
   * 素材ビンからのドラッグを再現する。
   * 掴む（dragstart）→ 重ねる（dragover）→ 離す（drop）を実際のイベントで送る。
   * 戻り値の prevented が false なら、その場所は「置けません」＝駐禁が出ている。
   */
  async function dndFromBin(name, targetSel, offset = { x: 200, y: 10 }, mods = {}) {
    await binCardReady(name)
    // 掴む。DataTransfer は使い回す必要があるので window に置いておく
    // （毎回新しく作ると、アプリ側が掴んでいる素材を見失う）。
    await page.evaluate((name) => {
      const card = [...document.querySelectorAll('.media-card')].find((e) =>
        (e.textContent ?? '').includes(name)
      )
      if (!card) throw new Error('素材カードが見つからない: ' + name)
      window.__dt = new DataTransfer()
      card.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dt })
      )
    }, name)
    // 重ねる
    const prevented = await page.evaluate(
      ({ targetSel, ox, oy, mods }) => {
        const el = document.querySelector(targetSel)
        if (!el) throw new Error('置き先が見つからない: ' + targetSel)
        const b = el.getBoundingClientRect()
        window.__dropAt = { x: b.x + ox, y: b.y + oy }
        const ev = new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: window.__dropAt.x,
          clientY: window.__dropAt.y,
          dataTransfer: window.__dt,
          ...mods
        })
        el.dispatchEvent(ev)
        return ev.defaultPrevented
      },
      { targetSel, ox: offset.x, oy: offset.y, mods }
    )
    // アプリが掴んだものを認識しているか（置く予定の影が出ているか）で確かめる。
    // これが無いと、掴めていないのに「何も起きなかった＝合格」になってしまう。
    await page.waitForTimeout(250)
    const ghost = (await page.locator('.se-ghost').count()) > 0
    // 離す
    await page.evaluate(
      ({ targetSel, mods }) => {
        const el = document.querySelector(targetSel)
        el.dispatchEvent(
          new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            clientX: window.__dropAt.x,
            clientY: window.__dropAt.y,
            dataTransfer: window.__dt,
            ...mods
          })
        )
      },
      { targetSel, mods }
    )
    await page.waitForTimeout(400)
    return { prevented, ghost }
  }

  await check('タイムラインのどこに重ねても「置けません」にならない', async () => {
    for (const [where, sel, off] of [
      ['クリップの上', '[data-tid="V1"]', { x: 60, y: 10 }],
      ['段と段の境目', '.track-scroll', { x: 300, y: 1 }],
      ['一番下の余白', '.track-scroll', { x: 300, y: 400 }],
      ['ルーラーの上', '.ruler', { x: 300, y: 5 }]
    ]) {
      const r = await dndFromBin('test_image', sel, off)
      assert(r.ghost, `${where} で、掴んだ素材の影が出なかった（アプリが認識していない）`)
      assert(r.prevented, `${where} で「置けません」になった`)
      await page.keyboard.press('Control+z')
      await page.waitForTimeout(200)
    }
  })

  await check('段の外で離しても、一番近い段に置かれる（消えない）', async () => {
    const n0 = await page.locator('.img-clip:not(.se-ghost)').count()
    await dndFromBin('test_image', '.track-scroll', { x: 400, y: 400 })
    await page.waitForTimeout(400)
    const n1 = await page.locator('.img-clip:not(.se-ghost)').count()
    assert(n1 > n0, `画像が置かれなかった（${n0} → ${n1}）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
  })

  await check('一番下の余白へ動画を落としても、本編が上書きされない', async () => {
    const before = await clipLayout()
    const r = await dndFromBin('test_video', '.track-scroll', { x: 200, y: 400 })
    assert(r.ghost, '掴んだ動画の影が出なかった（この確認が空振りになる）')
    await page.waitForTimeout(600)
    const after = await clipLayout()
    assert(
      after.length === before.length && Math.abs(after[0].w - before[0].w) < 3,
      '本編のクリップが書き換えられた'
    )
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
  })

  await check('タイムライン内のどの高さでも「置けません」にならない（段の境目を含む）', async () => {
    // 段と段の境目・グループの切れ目など、1pxでも受け付けない帯があると
    // そこだけ 🚫 が出て「置けない場所」に見える。全部の高さを刻んで確かめる。
    await binCardReady('test_video')
    await page.evaluate((name) => {
      const card = [...document.querySelectorAll('.media-card')].find((e) =>
        (e.textContent ?? '').includes(name)
      )
      window.__dt = new DataTransfer()
      card.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dt })
      )
    }, 'test_video')
    const bad = await page.evaluate(() => {
      const out = []
      // ウィンドウ全体を細かく網羅する。タイムラインの中だけでなく、
      // パネルの境目やトラック名の列も含めて「どこでも置ける」ことを確かめる。
      //
      // dragenter も見るのが要点。HTML5 のドラッグは dragenter と dragover の
      // 両方で受け入れを宣言しないと、要素をまたぐ一瞬だけ 🚫 が出る。
      // dragover だけ見ていると、この「行き来すると出る」型を見逃す。
      let prev = null
      for (let y = 2; y < window.innerHeight; y += 3) {
        for (let x = 4; x < window.innerWidth; x += 20) {
          const el = document.elementFromPoint(x, y)
          if (!el) continue
          const mk = (type) =>
            new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
              dataTransfer: window.__dt
            })
          // 要素が変わった＝またいだ瞬間。ここで dragenter が飛ぶ。
          if (el !== prev) {
            const enter = mk('dragenter')
            el.dispatchEvent(enter)
            if (!enter.defaultPrevented) {
              out.push({ x, y, ev: 'dragenter', tag: (el.className || el.tagName).toString().slice(0, 34) })
            }
            prev = el
          }
          const over = mk('dragover')
          el.dispatchEvent(over)
          if (!over.defaultPrevented) {
            out.push({ x, y, ev: 'dragover', tag: (el.className || el.tagName).toString().slice(0, 34) })
          }
        }
      }
      return out
    })
    await page.evaluate(() => {
      document.querySelector('.app').dispatchEvent(new DragEvent('dragend', { bubbles: true }))
    })
    assert(
      bad.length === 0,
      `受け付けない場所がある(${bad.length}点): ${bad.slice(0, 6).map((b) => `(${b.x},${b.y}) ${b.ev} ${b.tag}`).join(" / ")}`
    )
  })

  await check('タイムラインの外へ出ても、置き先の影が消えない', async () => {
    // 外れた瞬間に影が消えると、置けないのか場所が悪いのか分からなくなる
    for (const [where, sel, off] of [
      ['トラック名の列', '.th', { x: 20, y: 10 }],
      ['プレビュー', '.panel.monitor', { x: 200, y: 150 }],
      ['右のパネル', '.panel:not(.monitor)', { x: 60, y: 200 }],
      ['メニューバー', '.menubar', { x: 40, y: 5 }]
    ]) {
      await binCardReady('test_video')
      await page.evaluate((name) => {
        const card = [...document.querySelectorAll('.media-card')].find((e) =>
          (e.textContent ?? '').includes(name)
        )
        window.__dt = new DataTransfer()
        card.dispatchEvent(
          new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dt })
        )
      }, 'test_video')
      const prevented = await page.evaluate(
        ({ sel, ox, oy }) => {
          const el = document.querySelectorAll(sel)[0]
          if (!el) throw new Error('見つからない: ' + sel)
          const b = el.getBoundingClientRect()
          const ev = new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            clientX: b.x + ox,
            clientY: b.y + oy,
            dataTransfer: window.__dt
          })
          el.dispatchEvent(ev)
          return ev.defaultPrevented
        },
        { sel, ox: off.x, oy: off.y }
      )
      await page.waitForTimeout(200)
      assert(prevented, `${where} の上で「置けません」になった`)
      assert((await page.locator('.se-ghost').count()) > 0, `${where} の上で置き先の影が消えた`)
      await page.evaluate(() => {
        document.querySelector('.app').dispatchEvent(new DragEvent('dragend', { bubbles: true }))
      })
      await page.waitForTimeout(150)
      assert((await page.locator('.se-ghost').count()) === 0, 'やめたのに影が残っている')
    }
  })

  await check('素材ビンの中へ戻すと、何も置かれない（やめた扱い）', async () => {
    const n0 = await page.locator('.img-clip:not(.se-ghost)').count()
    await dndFromBin('test_image', '.panel:not(.monitor)', { x: 40, y: 40 })
    await page.waitForTimeout(400)
    const n1 = await page.locator('.img-clip:not(.se-ghost)').count()
    assert(n1 === n0, '素材置き場に戻したのにタイムラインへ置かれた')
  })

  await check('まだ無い段の位置へ動画を落とすと、その段と対の音声段が作られる', async () => {
    const v0 = await page.locator('[data-tid]').count()
    // 一番上の映像段より上（ルーラーのすぐ下）へ落とす
    await dndFromBin('test_video', '.track-scroll', { x: 300, y: 400 })
    await page.waitForTimeout(800)
    const ids = await page.locator('[data-tid]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-tid'))
    )
    assert(ids.length >= v0, '段が減った')
    // 映像段があれば、同じ番号の音声段も必ずある
    for (const id of ids.filter((i) => i.startsWith('V') && i !== 'V1')) {
      const pair = 'A' + id.slice(1)
      assert(ids.includes(pair), `${id} に対する ${pair} が作られていない`)
    }
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
  })

  // =========================================================================
  section('4. カットとキー操作の続き')
  await resetProject()

  await check('C でカッター、V で矢印に戻る', async () => {
    await page.keyboard.press('c')
    await page.waitForTimeout(150)
    let cls = await page.locator('.track-inner').getAttribute('class')
    const razorOn = await page.locator('.tool.tool-on').evaluateAll((els) =>
      els.some((e) => (e.textContent ?? '').includes('✂'))
    )
    assert(razorOn, 'C でカッターにならない')
    await page.keyboard.press('v')
    await page.waitForTimeout(150)
    const stillRazor = await page.locator('.tool.tool-on').evaluateAll((els) =>
      els.some((e) => (e.textContent ?? '').includes('✂'))
    )
    assert(!stillRazor, 'V で矢印に戻らない')
    void cls
  })

  await check('Ctrl+K で再生位置にカットが入る', async () => {
    await seekTo(7) // 2番目のクリップの真ん中
    const n0 = await v1Clips().count()
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(400)
    const n1 = await v1Clips().count()
    assert(n1 === n0 + 1, `カットが増えていない（${n0} → ${n1}）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
  })

  await check('D は「消すだけ」— 後ろのクリップも文字も動かない', async () => {
    await resetProject()
    const before = await clipLayout()
    assert((await page.locator('.telop-clip').count()) === 2, '文字が2つある状態から始められていない')
    const cue0 = await page.locator('.telop-clip').last().boundingBox()
    await v1Clips().nth(0).click()
    await page.keyboard.press('d')
    await page.waitForTimeout(500)
    const after = await clipLayout()
    assert(after.length === before.length - 1, `クリップが1つ減っていない（${before.length} → ${after.length}）`)
    // 残ったクリップは1ミリも動かない
    near(after[0].x, before[1].x, 2, '後ろのクリップが前へ詰まってしまった')
    const cue1 = await page.locator('.telop-clip').last().boundingBox()
    near(cue1.x, cue0.x, 2, '文字が動いてしまった')
    // 消した所は「空き」として残り、クリックできる
    assert((await page.locator('[data-tid="V1"] .gap-clip').count()) > 0, '空きが残っていない')
  })

  await check('F は「消して詰める」— 後ろが前へ寄る', async () => {
    await resetProject()
    const before = await clipLayout()
    assert((await page.locator('.telop-clip').count()) === 2, '文字が2つある状態から始められていない')
    const cue0 = await page.locator('.telop-clip').last().boundingBox()
    await v1Clips().nth(0).click()
    await page.keyboard.press('f')
    await page.waitForTimeout(500)
    const after = await clipLayout()
    assert(after.length === before.length - 1, 'クリップが1つ減っていない')
    near(after[0].x, before[0].x, 2, '先頭に詰まっていない')
    assert((await page.locator('[data-tid="V1"] .gap-clip').count()) === 0, '詰めたのに空きが残っている')
    const cue1 = await page.locator('.telop-clip').last().boundingBox()
    assert(cue1.x < cue0.x - 5, '文字が一緒に前へ寄っていない')
  })

  await check('D と Delete と Backspace が同じ動きをする', async () => {
    const trial = async (key) => {
      const n0 = await v1Clips().count()
      await v1Clips().nth(0).click()
      await page.keyboard.press(key)
      await page.waitForTimeout(400)
      const n1 = await v1Clips().count()
      await page.keyboard.press('Control+z')
      await page.waitForTimeout(400)
      return n0 - n1
    }
    const d = await trial('d')
    const del = await trial('Delete')
    const bs = await trial('Backspace')
    assert(d === del && del === bs, `減り方が違う（D:${d} Delete:${del} Backspace:${bs}）`)
  })

  await check('複数のクリップを選んでまとめて動かせる', async () => {
    await resetProject()
    const before = await clipLayout()
    await v1Clips().nth(1).click()
    await v1Clips().nth(2).click({ modifiers: ['Control'] })
    await page.waitForTimeout(200)
    await dragBy(v1Clips().nth(1), W * 0.6)
    const after = await clipLayout()
    assert(after.length >= before.length, 'クリップが消えた')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  // =========================================================================
  section('12. 元に戻す・やり直す')
  await resetProject()

  await check('動かす → Ctrl+Z で戻る → Ctrl+Y でやり直せる', async () => {
    const before = await clipLayout()
    await dragBy(v1Clips().nth(0), W * 0.8)
    const moved = await clipLayout()
    assert(moved[0].x > before[0].x + 5, '動かせていない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
    const undone = await clipLayout()
    near(undone[0].x, before[0].x, 2, 'Ctrl+Z で戻っていない')
    assert(undone.length === before.length, 'クリップ数が戻っていない')
    await page.keyboard.press('Control+y')
    await page.waitForTimeout(400)
    const redone = await clipLayout()
    assert(redone[0].x > before[0].x + 5, 'Ctrl+Y でやり直せていない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('Ctrl+Shift+Z でもやり直せる', async () => {
    const base = await clipLayout()
    await dragBy(v1Clips().nth(0), 130)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
    await page.keyboard.press('Control+Shift+z')
    await page.waitForTimeout(400)
    const after = await clipLayout()
    assert(after[0].x > base[0].x + 5, 'Ctrl+Shift+Z でやり直せない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  // =========================================================================
  section('15. クリップの色分け')
  await resetProject()

  await check('右クリックから色を付けられて、Ctrl+Z で戻る', async () => {
    const bg = () => v1Clips().nth(0).evaluate((el) => getComputedStyle(el).backgroundColor)
    const before = await bg()
    await v1Clips().nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const swatch = page.locator('.ctx-swatch:not(.ctx-swatch-none)').first()
    if (!(await swatch.count())) {
      await page.keyboard.press('Escape')
      throw new Error('右クリックメニューに色の選択肢が無い')
    }
    await swatch.click()
    await page.waitForTimeout(400)
    const after = await bg()
    assert(after !== before, `色が変わっていない（${before}）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
    assert((await bg()) === before, 'Ctrl+Z で色が戻らない')
  })

  // =========================================================================
  section('13. 書き出しの設定が効いているか')

  await check('解像度の設定が、できあがりの動画に反映される', async () => {
    const out = join(outDir, 'res720.mp4')
    await setDialogFiles(null, out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
    // .pq-select はプレビュー解像度の選択にも使われているので、
    // 書き出しダイアログの中に限定して選ぶ
    await page.locator('.export-overlay .pq-select').first().selectOption('720')
    await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
    await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 240000 })
    assert(existsSync(out), '書き出しファイルができていない')
    const probe = spawn('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out
    ])
    let o = ''
    probe.stdout.on('data', (d) => (o += d))
    await new Promise((res) => probe.on('close', res))
    const [w, h] = o.trim().split(',').map(Number)
    assert(h === 720, `高さが720になっていない（${w}x${h}）`)
  })

  await check('Ctrl+M でも書き出しの設定画面が出る（いきなり始まらない）', async () => {
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay', { timeout: 5000 })
    const txt = await page.locator('.export-overlay').textContent()
    assert(txt.includes('書き出す'), '設定画面ではなく書き出しが始まった')
    await page.locator('.export-overlay').click({ position: { x: 5, y: 5 } })
    await page.waitForTimeout(300)
  })

  // =========================================================================
  section('14. 見た目の表記ゆれ')

  await check('時間の目盛りと再生位置の時刻が同じ形式（00:00:00:00）', async () => {
    const cur = await page.locator('.transport, .tl-foot, .statusbar').first().textContent()
    const m = cur.match(/\d{2}:\d{2}:\d{2}[:.]\d{2}/)
    assert(m, `再生位置の時刻が見つからない: ${cur.slice(0, 80)}`)
    assert(m[0].includes(':') && m[0].split(/[:.]/).length === 4, `形式が違う: ${m[0]}`)
  })

  await check('左右のパネルの折りたたみ矢印が同じ記号', async () => {
    const arrows = await page.locator('.panel .collapse, .panel .pane-toggle').evaluateAll((els) =>
      els.map((e) => (e.textContent ?? '').trim())
    )
    if (arrows.length >= 2) {
      const uniq = [...new Set(arrows.map((a) => a.replace(/[<>]/g, '')))]
      assert(uniq.length <= 2, `矢印の記号が揃っていない: ${arrows.join(' / ')}`)
    }
  })

  // =========================================================================
  section('字幕ファイル（SRT）の読み込み')
  await resetProject()

  await check('文字がある状態でSRTを読むと、件数つきで確認が出る', async () => {
    await setDialogFiles([fx.srt], null)
    const n0 = await page.locator('.telop-clip').count()
    assert(n0 > 0, '文字が無い状態から始まっている')
    await page.locator('button', { hasText: 'SRT読込' }).first().click()
    await page.waitForSelector('.modal-box', { timeout: 8000 })
    const title = await page.locator('.modal-title').textContent()
    assert(
      title.includes(String(n0)) && title.includes('置き換え'),
      `件数つきの確認になっていない: ${title}`
    )
  })

  await check('その確認で「中止」を押すと、今ある文字が消えない', async () => {
    const n0 = await page.locator('.telop-clip').count()
    await page.locator('.modal-btn', { hasText: '中止' }).first().click()
    await page.waitForTimeout(400)
    assert((await page.locator('.modal-box').count()) === 0, '確認が閉じていない')
    assert((await page.locator('.telop-clip').count()) === n0, '中止したのに文字が消えた')
  })

  await check('「置き換える」を選ぶと、SRTの中身に入れ替わる', async () => {
    await setDialogFiles([fx.srt], null)
    await page.locator('button', { hasText: 'SRT読込' }).first().click()
    await page.waitForSelector('.modal-box', { timeout: 8000 })
    await page.locator('.modal-btn', { hasText: '置き換える' }).first().click()
    await page.waitForTimeout(900)
    const n1 = await page.locator('.telop-clip').count()
    assert(n1 > 0, '読み込んだ文字が1つも出ていない')
    // 読み込んだ字幕の1つ目が、実際に画面に出ていること
    const txt = await page.locator('.telop-clip').first().textContent()
    assert(txt.trim().length > 0, '文字の中身が空になっている')
  })

  // =========================================================================
  section('目で見る確認（画面を撮って中身を測る）')
  await resetProject()

  await check('動かした跡が、本当に「何も無い」ように見えている', async () => {
    // 「帯が残っていない」は数値では確かめられないので、画面を撮って見比べる。
    // 同じ場所を動かす前と後で撮り、(1) 見た目が変わったこと（クリップが消えた）
    // (2) 後の絵が平坦なこと（模様＝帯や文字が無い）の2つで判定する。
    const rect = await page.evaluate(() => {
      const row = document.querySelector('[data-tid="V1"]')
      const b = row.getBoundingClientRect()
      return {
        x: Math.round(b.x + 8),
        y: Math.round(b.y + 5),
        width: 40,
        height: Math.round(b.height - 10)
      }
    })
    const a = join(shotDir, 'cmp-before.png')
    const b = join(shotDir, 'cmp-after.png')
    await page.screenshot({ path: a, clip: rect })
    const W2 = await clipW()
    await dragBy(v1Clips().nth(0), W2 * 0.6)
    await page.waitForTimeout(300)
    await page.screenshot({ path: b, clip: rect })
    const sim = await similarity(a, b)
    assert(sim < 0.95, `動かしたのに見た目が変わっていない（一致度 ${sim.toFixed(3)}）`)
    const after = await avgColor(b)
    assert(after.range != null, '明暗の幅を測れなかった')
    // クリップにはサムネや文字があるので明暗の幅が大きい。跡は平坦なはず。
    assert(
      after.range < 40,
      `跡に模様が残っている（明暗の幅 ${after.range}）。帯やサムネが残っている疑い`
    )
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('上書きされるクリップが、見た目にはっきり赤くなる', async () => {
    const target = v1Clips().nth(1)
    const before = join(shotDir, 'ov-before.png')
    const after = join(shotDir, 'ov-after.png')
    await target.screenshot({ path: before })
    const box = await v1Clips().nth(0).boundingBox()
    const w = box.width
    await page.mouse.move(box.x + 20, box.y + box.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + 20 + (w * i) / 6, box.y + box.height / 2)
    await page.waitForTimeout(350)
    await target.screenshot({ path: after })
    await page.mouse.move(box.x + 20, box.y + box.height / 2)
    await page.mouse.up()
    await page.waitForTimeout(300)
    const c0 = await avgColor(before)
    const c1 = await avgColor(after)
    assert(c0.v != null && c1.v != null, '色を測れなかった')
    // V が大きいほど赤寄り。警告中は赤縁が乗るので上がるはず。
    assert(c1.v > c0.v + 1, `赤くなっていない（V: ${c0.v?.toFixed(1)} → ${c1.v?.toFixed(1)}）`)
  })

  // =========================================================================
  section('耳で聴く確認（書き出した音を測る）')
  await resetProject()

  await check('書き出した動画に、途中で音が途切れる所が無い', async () => {
    const out = join(outDir, 'audio-check.mp4')
    await setDialogFiles(null, out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
    await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
    await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 240000 })
    assert(existsSync(out), '書き出しファイルができていない')
    const vol = await meanVolume(out)
    assert(vol !== null && vol > -60, `全体が無音になっている（${vol} dB）`)
    // 0.6秒以上の無音が続いていたら、音が抜けている疑い
    const gaps = await silences(out, -50, 0.6)
    assert(
      gaps.length === 0,
      `音が途切れている所がある: ${gaps.map((g) => `${g.start.toFixed(1)}秒から${g.dur.toFixed(1)}秒`).join(' / ')}`
    )
  })

  await check('書き出した動画の音量が、狙った大きさに揃っている', async () => {
    const out = join(outDir, 'audio-check.mp4')
    const lufs = await loudness(out)
    assert(lufs !== null, 'ラウドネスを測れなかった')
    // 画面の設定は -14 LUFS。実測がそこから大きく外れていたら揃っていない。
    assert(Math.abs(lufs + 14) < 3, `狙いの -14 LUFS から離れている（実測 ${lufs} LUFS）`)
  })

  // =========================================================================
  section('画面の記録')

  await check('最後の画面をスクリーンショットに残す', async () => {
    await page.screenshot({ path: join(ROOT, 'e2e', 'last-run.png') })
  })
} catch (e) {
  console.error('\n\x1b[31m実行そのものに失敗しました:\x1b[0m', e?.message ?? e)
  results.push({ name: '（実行）', ok: false, err: String(e?.message ?? e) })
} finally {
  const ok = results.filter((r) => r.ok).length
  const skipped = results.filter((r) => r.skipped).length
  const ng = results.filter((r) => !r.ok && !r.skipped)
  console.log(`\n\x1b[1m結果: ${ok} / ${results.length} 件が期待どおり\x1b[0m`)
  if (ng.length) {
    console.log('\n直すべきもの:')
    for (const r of ng) console.log(`  ・${r.name}\n      ${r.err}`)
  }
  if (app && !KEEP) {
    try {
      await app.evaluate(({ app: a }) => a.exit(0))
    } catch {
      /* すでに落ちている */
    }
  }
  if (fx && !KEEP) {
    try {
      rmSync(fx.dir, { recursive: true, force: true })
    } catch {
      /* 使用中なら残す */
    }
  }
  process.exit(ng.length ? 1 : 0)
}
