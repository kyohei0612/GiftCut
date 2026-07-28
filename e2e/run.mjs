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
// 見た目を見たいだけのとき用。確認は一切せず、起動して復元して1枚撮って終わる。
// これが無いと、画面を見るためだけにテストを回すことになる。
const SHOT_ONLY = process.argv.includes('--shot')
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
/**
 * 前回までの置き土産を片付ける。
 *
 * 途中で落ちたり --keep で終わった回の一時フォルダが temp に残り続ける。
 * 1回あたりは小さくても、回すたびに増えるので毎回まとめて消す。
 * 撮ったスクリーンショットも「最後に回した1回ぶん」だけ残す。
 */
function cleanLeftovers() {
  let n = 0
  try {
    for (const f of readdirSync(tmpdir())) {
      if (!f.startsWith('giftcut-e2e-')) continue
      try {
        rmSync(join(tmpdir(), f), { recursive: true, force: true })
        n++
      } catch {
        /* 使用中なら次回に回す */
      }
    }
  } catch {
    /* temp が読めない環境では何もしない */
  }
  // 前回のスクリーンショットは消す（今回の結果と混ざると読み違える）。
  // ただし撮るだけのときは、前の記録を残しておく。
  if (!SHOT_ONLY) {
    try {
      rmSync(join(ROOT, 'e2e', 'shots'), { recursive: true, force: true })
    } catch {
      /* 無ければ何もしない */
    }
  }
  // 切り出しキャッシュは新しい2つだけ残す（素材を替えるたびに増えていくため）
  try {
    const cd = join(ROOT, 'e2e', '.cache')
    const files = readdirSync(cd)
      .map((f) => ({ f: join(cd, f), t: statSync(join(cd, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const x of files.slice(2)) rmSync(x.f, { force: true })
  } catch {
    /* まだ無い */
  }
  if (n) console.log(`前回までの一時フォルダを ${n} 件片付けました`)
}

async function makeFixture() {
  cleanLeftovers()
  const dir = mkdtempSync(join(tmpdir(), 'giftcut-e2e-'))
  const userData = join(dir, 'userData')
  mkdirSync(userData, { recursive: true })
  const video = join(dir, 'test_video.mp4')
  const image = join(dir, 'test_image.png')
  const spare = join(dir, 'spare_image.png') // タイムラインでは使わない素材（削除の確認用）
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
  await sh('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x160:d=1', '-frames:v', '1', spare])
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
      { path: spare, name: 'spare_image.png', kind: 'image' },
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
  // 手つかずの控え。保存のテストは開いているファイルへ上書き保存するので、
  // これが無いと以降のリセットが「編集後の状態」から始まってしまう
  // （実際に、後の確認が2件それで落ちた）。リセットのたびに書き戻す。
  const gcprojOrig = join(dir, 'fixture.orig.gcproj')
  writeFileSync(gcprojOrig, JSON.stringify(project), 'utf-8')
  return { dir, userData, video, image, spare, sound, srt, gcproj, gcprojOrig }
}

// ---------------------------------------------------------------------------
// 結果の集計
// ---------------------------------------------------------------------------
const results = []
// 前のリセット以降に確認を実行したか（実行していれば状態が変わっている可能性がある）
const touchedRef = { dirty: true }
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
  // --shot は「今の画面を見たいだけ」。確認は全部飛ばす。
  if (SHOT_ONLY && !opts.setup) {
    results.push({ name, skipped: true })
    return
  }
  if (ONLY && !opts.setup && !name.includes(ONLY) && !curSection.includes(ONLY)) {
    results.push({ name, skipped: true })
    return
  }
  const total = Math.max(TOTAL_HINT, results.length + 1)
  await banner({ status: 'run', name: esc(name), section: esc(curSection), done: results.length, total })
  // 何を確認しているか読めるだけの間を置く（--slow ならもっと長く）
  if (pageRef) await pageRef.waitForTimeout(SLOW ? 900 : 320)
  try {
    touchedRef.dirty = true
    await fn()
    results.push({ name, ok: true })
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
    await banner({ status: 'ok', name: esc(name), section: esc(curSection), done: results.length, total })
  } catch (e) {
    const msg = String(e?.message ?? e).split('\n')[0]
    const state = await ngState()
    let png = null
    if (pageRef) {
      png = join(ROOT, 'e2e', 'shots', `NG-${String(results.length + 1).padStart(2, '0')}.png`)
      try {
        mkdirSync(dirname(png), { recursive: true })
        await pageRef.screenshot({ path: png })
      } catch {
        png = null
      }
    }
    results.push({ name, ok: false, err: String(e?.message ?? e), state, png })
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${msg}`)
    if (state) console.log(`      \x1b[90m落ちた時の画面: ${JSON.stringify(state)}\x1b[0m`)
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
/**
 * 落ちた瞬間の「画面がどうなっていたか」を残す。
 *
 * 通しでだけ落ちる項目は、単体で回すと通ってしまうので、あとから調べ直せない。
 * メッセージだけでは「押したのに効かなかった」としか分からず、
 * 前の項目が何を残したのかが読めない。撮るのは落ちたときだけ。
 */
async function ngState() {
  if (!pageRef) return null
  try {
    return await pageRef.evaluate(() => {
      const txt = (el) => (el?.textContent ?? '').trim().replace(/\s+/g, ' ')
      const all = (sel) => [...document.querySelectorAll(sel)]
      return {
        // 開いたままの物（これが残っていると、以降のクリックが全部吸われる）
        メニュー: all('.ctx-menu').length,
        ダイアログ: all('.modal, .restore-box').map((e) => txt(e).slice(0, 40)),
        // パネルの配置
        選ばれているタブ: all('.panel-tabs-strip').map((s) => txt(s.querySelector('.tab-on'))),
        切り離し中: all('.pane-float').length,
        パネル幅: {
          左: localStorage.getItem('gc.leftW'),
          右: localStorage.getItem('gc.rightW'),
          並び: localStorage.getItem('giftcut.tabOrder'),
          切り離し: localStorage.getItem('giftcut.floatPanes')
        },
        モニタ: txt(document.querySelector('.panel.monitor .tab-on')),
        // 素材ビン
        見えている素材: all('.media-card')
          .filter((e) => e.getBoundingClientRect().height > 0)
          .map((e) => txt(e).slice(0, 24)),
        折りたたみ: all('.tpl-acc').map((e) => `${txt(e).slice(0, 12)}:${e.className.includes('open') ? '開' : '閉'}`),
        // タイムライン
        クリップ数: all('[data-tid="V1"] .video-clip:not(.se-ghost)').length,
        選択中: all('.video-clip.sel, .telop-clip.sel, .img-clip.sel').length,
        再生位置: txt(document.querySelector('.tc-cur'))
      }
    })
  } catch {
    return null
  }
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
  // 画面の配置に関わる保存先。プロジェクトの中身ではないので、
  // プロジェクトを開き直しても戻らない。
  const LAYOUT_KEYS = [
    'giftcut.floatPanes', // 切り離したパネルの位置
    'giftcut.tabOrder', // タブの並び順
    'gc.leftW',
    'gc.rightW',
    'gc.timelineH',
    'gc.videoTrackH',
    'gc.audioTrackH'
  ]
  /**
   * 画面の配置が既定からずれていないかを見る。
   *
   * ずれたまま次の項目へ進むと、探している物が「そこに無い」だけで落ちる。
   * 単体で回すと前の項目を飛ばすので再現せず、**通しでだけ落ちる**という
   * 一番たちの悪い形になる（実際に14件がこれだった）。
   */
  // 起動直後の配置。既定値を直接書くと、アプリ側で既定を変えた瞬間に
  // 毎回「ずれている」と言い出すので、実際の値を1回だけ控える。
  let layoutBase = null
  let zoomBase = null
  async function layoutDrifted() {
    const now = await page.evaluate((keys) => {
      const txt = (el) => (el?.textContent ?? '').trim()
      const strips = [...document.querySelectorAll('.panel-tabs-strip')]
      return {
        float: document.querySelectorAll('.pane-float').length,
        menu: document.querySelectorAll('.ctx-menu').length,
        // 素材ビンは右パネルが「プロジェクト」のときだけ描かれる。
        // トランジションの持ち手を触ると勝手に「設定」へ切り替わるので、ここが最有力。
        right: txt(strips[strips.length - 1]?.querySelector('.tab-on')),
        monitor: txt(document.querySelector('.panel.monitor .tab-on')),
        ls: Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)]))
      }
    }, LAYOUT_KEYS)
    if (!layoutBase) {
      layoutBase = now
      return ''
    }
    if (now.float) return '切り離したパネルが残っている'
    if (now.menu) return '右クリックのメニューが開いたまま'
    if (now.right !== layoutBase.right) return `右パネルのタブが「${now.right}」のまま`
    if (now.monitor !== layoutBase.monitor) return `モニタが「${now.monitor}」のまま`
    for (const k of LAYOUT_KEYS) {
      if (now.ls[k] !== layoutBase.ls[k])
        return `${k} が起動時と違う（${String(layoutBase.ls[k]).slice(0, 20)} → ${String(now.ls[k]).slice(0, 20)}）`
    }
    return ''
  }
  /**
   * 画面の配置を既定へ戻す。
   *
   * 配置は localStorage と画面の状態にあり、プロジェクトを開き直しても戻らない。
   * 消してから読み込み直すのが、取りこぼしの無い唯一の方法。
   * ずれているときだけ呼ぶ（毎回やると読み込み直しの時間で通しが倍になる）。
   */
  async function resetLayout(why) {
    console.log(`  \x1b[90m画面の配置を既定へ戻します（${why}）\x1b[0m`)
    await page.evaluate((keys) => {
      for (const k of keys) localStorage.removeItem(k)
      // 右パネルのタブは「前回の続き」として giftcut.session に入っている。
      // ここを消さないと、読み込み直しても同じタブが復活する。
      try {
        const s = JSON.parse(localStorage.getItem('giftcut.session') || '{}')
        delete s.tab
        delete s.rsx
        localStorage.setItem('giftcut.session', JSON.stringify(s))
      } catch {
        localStorage.removeItem('giftcut.session')
      }
    }, LAYOUT_KEYS)
    await page.reload()
    // 読み込み直すと「前回の作業が残っています」が出る。
    // どちらを選んでもこの直後にプロジェクトを開き直すので、破棄でよい。
    const box = page.locator('.restore-btns button', { hasText: '破棄' })
    try {
      await box.first().waitFor({ timeout: 20000 })
      await box.first().click()
    } catch {
      /* 下書きが無ければ出ない */
    }
    await page.waitForTimeout(600)
  }
  /**
   * 用意した状態に戻す。各章の頭で呼ぶ。
   * 前の章の操作が残っていると、失敗の原因が「今見ている物」なのか
   * 「前の章の後始末漏れ」なのか分からなくなる。
   */
  async function resetProject() {
    if (SHOT_ONLY) return
    // 画面の配置は、何も編集していなくてもずれる（タブが切り替わるだけでずれる）。
    // なので dirty の判定より先に見る。
    const drift = await layoutDrifted()
    if (drift) {
      await resetLayout(drift)
      touchedRef.dirty = true // 開き直したので、中身も戻す
    }
    // 前のリセット以降に何も実行していなければ、戻す必要が無い。
    // 毎回戻すと、同じ画面を何度も作り直すだけで時間を食う。
    if (!touchedRef.dirty) return
    touchedRef.dirty = false
    // これは確認そのものではなく「次の確認のための片付け」。
    // 何も出さないと、同じ確認を繰り返しているように見えてしまう。
    await banner({
      status: 'run',
      name: '状態を元に戻しています（確認ではありません）',
      section: esc(curSection),
      done: results.filter((r) => !r.skipped).length,
      total: Math.max(TOTAL_HINT, results.length)
    })
    // 毎回まっさらな内容に書き戻してから開く（前の確認の保存を持ち越さない）
    copyFileSync(fx.gcprojOrig, fx.gcproj)
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
    // タイムラインの「見ている場所」はプロジェクトの中身ではないので、開き直しても戻らない。
    // 左へ寄せておかないと、1つ目のクリップが左端に埋もれて一部しか掴めず、
    // 「動かせていない」「詰まっていない」という**別物の失敗**になる。
    // 実際、通しでだけ落ちていた14件のうち5件がこれだった。
    await page.evaluate(() => {
      const el = document.querySelector('.track-scroll')
      if (el) el.scrollLeft = 0
    })
    await page.waitForTimeout(250)
    const sx = await page.evaluate(() => document.querySelector('.track-scroll')?.scrollLeft ?? 0)
    assert(sx < 2, `タイムラインを左端に戻せなかった（scrollLeft=${sx}）`)
    // 拡大率も戻す。Ctrl+ホイールで拡大する項目があり、そのままだと以降の章で
    // 「クリップ1つぶんの幅」が変わる。同じ距離を動かしたつもりが磁石に吸い戻され、
    // 「動かせていない」という別物の失敗になる（負荷チェックでも同じ失敗をした）。
    const zoomEl = page.locator('.tl-zoom input[type="range"]').first()
    if (await zoomEl.count()) {
      const cur = await zoomEl.inputValue()
      if (zoomBase === null) zoomBase = cur
      else if (cur !== zoomBase) {
        await zoomEl.evaluate((el, val) => {
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
          ).set
          setter.call(el, String(val))
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }, zoomBase)
        await page.waitForTimeout(350)
        const back = await zoomEl.inputValue()
        assert(back === zoomBase, `拡大率を戻せなかった（${cur} → ${back} / 起動時 ${zoomBase}）`)
      }
    }
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
    // ★拡大は Ctrl（か Alt）を押しながらのホイール。ただのホイールは横スクロールなので、
    //   押さずに回すと「何も起きない＝映像も変わらない」で必ず合格してしまっていた。
    const tlW = () => page.locator('.track-inner').evaluate((e) => Math.round(e.getBoundingClientRect().width))
    const w0 = await tlW()
    await page.keyboard.down('Control')
    await page.mouse.move(tl.x + 300, tl.y + 60)
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, -120)
      await page.waitForTimeout(80)
    }
    await page.keyboard.up('Control')
    await page.waitForTimeout(300)
    const w1 = await tlW()
    assert(w1 > w0 * 1.1, `タイムラインが拡大していない＝確認になっていない（${w0} → ${w1}px）`)
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
    await page.locator('.pq-export').first().selectOption('720')
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
  section('1・3. 起動直後と素材の配置')
  await resetProject()

  await check('起動直後の画質設定が「原本（最高画質）」になっている', async () => {
    const v = await page.locator('.pq-preview').first().inputValue()
    assert(v === 'orig', `画質設定が原本になっていない（${v}）`)
  })

  await check('タイムラインが中身の長さに収まっている（左端の小さな塊にならない）', async () => {
    const { content, view } = await page.evaluate(() => {
      const inner = document.querySelector('.track-inner').getBoundingClientRect()
      const scroll = document.querySelector('.track-scroll').getBoundingClientRect()
      const clips = [...document.querySelectorAll('[data-tid="V1"] .video-clip:not(.se-ghost)')]
      const last = clips[clips.length - 1].getBoundingClientRect()
      return { content: last.right - inner.x, view: scroll.width }
    })
    // 中身が画面幅の半分以上を占めていれば「収まっている」とみなす
    assert(content > view * 0.5, `中身が画面の左端に寄っている（${Math.round(content)} / ${Math.round(view)}）`)
  })

  await check('素材を追加しても、タイムラインには載らない', async () => {
    const n0 = await v1Clips().count()
    await setDialogFiles([fx.video], null)
    await page.locator('button', { hasText: 'ファイル追加' }).first().click()
    await page.waitForTimeout(900)
    assert((await v1Clips().count()) === n0, '追加しただけでタイムラインに載った')
  })

  await check('ビンからドラッグして落とすと、その位置から始まる', async () => {
    await resetProject()
    const r = await dndFromBin('test_image', '[data-tid="V3"]', { x: 300, y: 10 })
    assert(r.ghost, '掴んだ素材の影が出なかった')
    await page.waitForTimeout(500)
    const imgs = await page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)').all()
    assert(imgs.length >= 2, `落とした画像が増えていない（${imgs.length}）`)
    const boxes = await Promise.all(imgs.map((i) => i.boundingBox()))
    const inner = await page.locator('.track-inner').boundingBox()
    // 落とした位置（+300px）の近くから始まっているものがある
    assert(
      boxes.some((b) => Math.abs(b.x - (inner.x + 300)) < 25),
      `落とした位置から始まっていない（${boxes.map((b) => Math.round(b.x - inner.x)).join(',')}）`
    )
  })

  await check('動画を上から2段目に置くと、対の音声段に音が入って連動する', async () => {
    await resetProject()
    const r = await dndFromBin('test_video', '[data-tid="V2"]', { x: 200, y: 10 })
    assert(r.ghost, '掴んだ動画の影が出なかった')
    await page.waitForTimeout(1500)
    const v2 = await page.locator('[data-tid="V2"] .clip:not(.se-ghost)').count()
    const a2 = await page.locator('[data-tid="A2"] .clip:not(.se-ghost)').count()
    assert(v2 > 0, 'V2 に動画が置かれていない')
    assert(a2 > 0, '対の音声段（A2）に音が入っていない')
  })

  await check('お知らせが積み上がらず、多くても2つまでで消える', async () => {
    await resetProject()
    // わざと立て続けに操作してお知らせを何度も出す
    for (let i = 0; i < 4; i++) {
      await v1Clips().nth(0).click({ button: 'right' })
      await page.waitForSelector('.ctx-menu')
      await page.locator('.ctx-swatch:not(.ctx-swatch-none)').nth(i % 3).click()
      await page.waitForTimeout(120)
    }
    const n = await page.locator('.toast').count()
    assert(n <= 2, `お知らせが ${n} 件たまっている`)
    await page.waitForTimeout(3600)
    assert((await page.locator('.toast').count()) === 0, 'しばらく経ってもお知らせが消えない')
  })

  // =========================================================================
  section('2. 保存とプロジェクトの切り替え')
  await resetProject()

  await check('保存するとタイトルの「＊」が消える', async () => {
    // 見た目で確実に分かる編集をする（クリップを動かす）
    const before = await clipLayout()
    await dragBy(v1Clips().nth(0), (await clipW()) * 0.4)
    await page.waitForTimeout(600)
    const after = await clipLayout()
    assert(after[0].x > before[0].x + 5, '編集（クリップの移動）ができていない')
    // 「＊」は編集が止まってから見直される（以前の0.8秒ごとの総当たりをやめた）
    await page.waitForTimeout(600)
    const dirty = await page.locator('.modebar-title').first().textContent()
    assert(dirty.includes('*'), `編集したのに「＊」が出ていない: ${dirty.slice(0, 60)}`)
    // 開いているファイルへ上書き保存される（別名保存のダイアログは出ない）
    await page.keyboard.press('Control+s')
    await page.waitForTimeout(1600)
    const clean = await page.locator('.modebar-title').first().textContent()
    assert(!clean.includes('*'), `保存したのに「＊」が残っている: ${clean.slice(0, 60)}`)
  })

  await check('元に戻して保存時と同じ内容になれば「＊」も消える', async () => {
    // 「＊」は保存した内容と今の内容を直接くらべて決めている。
    // 変わった回数を数える作りにすると、元に戻しても「＊」が残ってしまう。
    const before = await clipLayout()
    await dragBy(v1Clips().nth(0), (await clipW()) * 0.3)
    await page.waitForTimeout(700)
    const dirty = await page.locator('.modebar-title').first().textContent()
    assert(dirty.includes('*'), `動かしたのに「＊」が出ていない: ${dirty.slice(0, 60)}`)

    await page.keyboard.press('Control+z')
    await page.waitForTimeout(700)
    const after = await clipLayout()
    assert(Math.abs(after[0].x - before[0].x) < 3, '元に戻せていない（位置が戻っていない）')
    const clean = await page.locator('.modebar-title').first().textContent()
    assert(!clean.includes('*'), `保存時と同じ内容なのに「＊」が残っている: ${clean.slice(0, 60)}`)
  })

  await check('保存すると「最近使ったプロジェクト」に増える', async () => {
    const fileMenu = page.locator('.menu-item', { hasText: 'ファイル' }).first()
    await fileMenu.click()
    await page.waitForTimeout(300)
    const items = await page.locator('.menu-drop-recent').allTextContents()
    assert(
      items.some((t) => t.includes('fixture.gcproj')),
      `開いて保存したファイルが一覧に出ていない: ${items.join(', ')}`
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  })

  await check('取り消せない操作の実行ボタンが赤い', async () => {
    await setDialogFiles([fx.srt], null)
    await page.locator('button', { hasText: 'SRT読込' }).first().click()
    await page.waitForSelector('.modal-box')
    const danger = await page.locator('.modal-btn.danger').count()
    assert(danger > 0, '置き換えのボタンが赤（danger）になっていない')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    assert((await page.locator('.modal-box').count()) === 0, 'Escape で確認を中止できない')
  })

  // =========================================================================
  section('4-5. 編集とキー操作')
  await resetProject()

  await check('Q で、ひとつ前の編集点まで詰めて削除できる', async () => {
    await seekTo(12) // 3つ目のクリップの中
    const before = (await clipLayout()).reduce((a, c) => a + c.w, 0)
    await page.keyboard.press('q')
    await page.waitForTimeout(500)
    const after = (await clipLayout()).reduce((a, c) => a + c.w, 0)
    assert(after < before - 5, `詰まっていない（${before} → ${after}）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('文字が乗っている所で Q を押すと、文字の手前で止まる', async () => {
    // 文字は 1〜3秒 と 6〜8秒。7.5秒から Q を押すと 6秒（文字の頭）で止まるはず。
    await seekTo(7.5)
    const n0 = await page.locator('.telop-clip').count()
    await page.keyboard.press('q')
    await page.waitForTimeout(500)
    assert((await page.locator('.telop-clip').count()) === n0, '文字が巻き添えで消えた')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('波形の帯（A1）を掴んでも、映像と一緒に動く', async () => {
    const before = await clipLayout()
    const audio = page.locator('[data-tid="A1"] .audio-clip:not(.se-ghost)').first()
    assert(await audio.count(), 'A1 に波形の帯が出ていない')
    await dragBy(audio, (await clipW()) * 0.5)
    const after = await clipLayout()
    assert(after[0].x > before[0].x + 5, '音声側を掴んでも映像が動かない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('目印を選んだあと本編をクリックして Delete → 本編が消える', async () => {
    const marker = page.locator('.marker, .ruler-marker, [class*="marker"]').first()
    if (await marker.count()) {
      await marker.click()
      await page.waitForTimeout(250)
    }
    const n0 = await v1Clips().count()
    await v1Clips().nth(0).click()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(500)
    assert((await v1Clips().count()) === n0 - 1, '本編が消えていない（目印だけ消えた疑い）')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('スペースキーで再生が始まり、もう一度で止まる', async () => {
    const headX = async () =>
      page.locator('.playhead').first().evaluate((el) => el.getBoundingClientRect().x)
    await seekTo(2)
    const x0 = await headX()
    await page.keyboard.press('Space')
    await page.waitForTimeout(900)
    const x1 = await headX()
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    const x2 = await headX()
    await page.waitForTimeout(600)
    const x3 = await headX()
    assert(x1 > x0 + 2, '再生が始まらない')
    assert(Math.abs(x3 - x2) < 3, 'もう一度押しても止まらない')
  })

  // =========================================================================
  section('4-5. 編集の残り')
  await resetProject()

  await check('W で、次の編集点まで削って詰められる', async () => {
    await seekTo(11) // 3つ目のクリップの中（文字や効果音が無い所）
    const before = (await clipLayout()).reduce((a, c) => a + c.w, 0)
    await page.keyboard.press('w')
    await page.waitForTimeout(500)
    const after = (await clipLayout()).reduce((a, c) => a + c.w, 0)
    assert(after < before - 3, `詰まっていない（${before} → ${after}）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('クリップを消すと、文字・効果音・画像も一緒にずれる', async () => {
    await resetProject()
    const cue0 = await page.locator('.telop-clip').last().boundingBox()
    const se0 = await page.locator('.se-clip').first().boundingBox()
    const img0 = await page.locator('.img-clip:not(.se-ghost)').first().boundingBox()
    await v1Clips().nth(0).click()
    await page.keyboard.press('f') // 消して詰める
    await page.waitForTimeout(600)
    const cue1 = await page.locator('.telop-clip').last().boundingBox()
    const se1 = await page.locator('.se-clip').first().boundingBox()
    const img1 = await page.locator('.img-clip:not(.se-ghost)').first().boundingBox()
    assert(cue1.x < cue0.x - 5, '文字が一緒にずれていない')
    assert(se1.x < se0.x - 5, '効果音が一緒にずれていない')
    assert(img1.x < img0.x - 5, '画像が一緒にずれていない')
  })

  await check('掴んだ後で Alt を押すと「複製」に切り替わる', async () => {
    await resetProject()
    const box = await v1Clips().nth(0).boundingBox()
    const W2 = await clipW()
    await page.mouse.move(box.x + 20, box.y + box.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 4; i++)
      await page.mouse.move(box.x + 20 + (W2 * 0.5 * i) / 4, box.y + box.height / 2)
    await page.waitForTimeout(250)
    const moving = await page.locator('.se-ghost .clip-text').first().textContent()
    assert(moving.includes('移動'), `最初が「移動」になっていない: ${moving}`)
    await page.keyboard.down('Alt')
    await page.mouse.move(box.x + 20 + W2 * 0.55, box.y + box.height / 2)
    await page.waitForTimeout(250)
    const copying = await page.locator('.se-ghost .clip-text').first().textContent()
    assert(copying.includes('複製'), `Alt で「複製」に変わらない: ${copying}`)
    await page.keyboard.down('Control')
    await page.keyboard.up('Alt')
    await page.mouse.move(box.x + 20 + W2 * 0.6, box.y + box.height / 2)
    await page.waitForTimeout(250)
    const inserting = await page.locator('.se-ghost .clip-text').first().textContent()
    assert(inserting.includes('割り込み'), `Ctrl で「割り込み」に変わらない: ${inserting}`)
    await page.keyboard.up('Control')
    await page.mouse.move(box.x + 20, box.y + box.height / 2)
    await page.mouse.up()
    await page.waitForTimeout(400)
  })

  await check('Ctrl を押して動かさずクリックすると、複数選びになる', async () => {
    await resetProject()
    await v1Clips().nth(0).click()
    await v1Clips().nth(1).click({ modifiers: ['Control'] })
    await page.waitForTimeout(300)
    const sel = await page.locator('[data-tid="V1"] .video-clip.clip-selected').count()
    assert(sel === 2, `2つ選ばれていない（${sel}）`)
    await v1Clips().nth(1).click({ modifiers: ['Control'] })
    await page.waitForTimeout(300)
    assert(
      (await page.locator('[data-tid="V1"] .video-clip.clip-selected').count()) === 1,
      'もう一度 Ctrl クリックしても選択が外れない'
    )
  })

  await check('Ctrl+A で全部選んで動かすと、文字も効果音も一緒に動く', async () => {
    await resetProject()
    const cue0 = await page.locator('.telop-clip').first().boundingBox()
    const se0 = await page.locator('.se-clip').first().boundingBox()
    await page.keyboard.press('Control+a')
    await page.waitForTimeout(300)
    await dragBy(v1Clips().nth(0), (await clipW()) * 0.4)
    await page.waitForTimeout(500)
    const cue1 = await page.locator('.telop-clip').first().boundingBox()
    const se1 = await page.locator('.se-clip').first().boundingBox()
    assert(cue1.x > cue0.x + 5, '文字が一緒に動いていない')
    assert(se1.x > se0.x + 5, '効果音が一緒に動いていない')
  })

  await check('全部選んで動かす途中で Alt を押すと、文字が元の位置に戻る', async () => {
    await resetProject()
    const cue0 = await page.locator('.telop-clip').first().boundingBox()
    await page.keyboard.press('Control+a')
    await page.waitForTimeout(300)
    const box = await v1Clips().nth(0).boundingBox()
    const W2 = await clipW()
    await page.mouse.move(box.x + 20, box.y + box.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 4; i++)
      await page.mouse.move(box.x + 20 + (W2 * 0.4 * i) / 4, box.y + box.height / 2)
    await page.waitForTimeout(300)
    const cueMoved = await page.locator('.telop-clip').first().boundingBox()
    assert(cueMoved.x > cue0.x + 5, '掴んでいる間に文字が動いていない')
    await page.keyboard.down('Alt')
    await page.mouse.move(box.x + 20 + W2 * 0.42, box.y + box.height / 2)
    await page.waitForTimeout(350)
    const cueBack = await page.locator('.telop-clip').first().boundingBox()
    near(cueBack.x, cue0.x, 4, 'Alt を押しても文字が元の位置に戻らない')
    await page.keyboard.up('Alt')
    await page.mouse.up()
    await page.waitForTimeout(400)
  })

  await check('空きにマウスを乗せると、触れる場所だと分かる枠が出る', async () => {
    await resetProject()
    await dragBy(v1Clips().nth(0), (await clipW()) * 0.6)
    const gap = page.locator('[data-tid="V1"] .gap-clip').first()
    assert(await gap.count(), '空きができていない')
    const plain = await gap.evaluate((el) => getComputedStyle(el).borderColor)
    await gap.hover()
    await page.waitForTimeout(250)
    const hovered = await gap.evaluate((el) => getComputedStyle(el).borderColor)
    assert(hovered !== plain, `乗せても見た目が変わらない（${plain}）`)
  })

  await check('詰めきれない空きは、理由を教えてくれる', async () => {
    await resetProject()
    await dragBy(v1Clips().nth(0), (await clipW()) * 2.2)
    const gap = page.locator('[data-tid="V1"] .gap-clip').first()
    await gap.click()
    await page.keyboard.press('d')
    await page.waitForTimeout(500)
    await page.locator('[data-tid="V1"] .gap-clip').first().click()
    await page.keyboard.press('d')
    await page.waitForTimeout(500)
    const toast = await page.locator('.toast').allTextContents()
    assert(
      toast.some((t) => t.includes('別のクリップ')),
      `理由が出ていない: ${toast.join(' / ')}`
    )
  })

  await check('空きを含んだまま保存して開き直すと、空きが残っている', async () => {
    await resetProject()
    await dragBy(v1Clips().nth(0), (await clipW()) * 0.6)
    const gaps0 = await page.locator('[data-tid="V1"] .gap-clip').count()
    assert(gaps0 > 0, '空きができていない')
    const saved = join(outDir, 'with-gap.gcproj')
    await setDialogFiles([saved], saved)
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.locator('.menu-drop-item', { hasText: '別名で保存' }).first().click()
    await page.waitForTimeout(1500)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(500)
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) await cont.click()
    await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 15000 })
    await page.waitForTimeout(800)
    assert(
      (await page.locator('[data-tid="V1"] .gap-clip').count()) === gaps0,
      '開き直したら空きが消えた'
    )
  })

  await check('効果音を複数選ぶと、まとめて動かせる', async () => {
    await resetProject()
    // 2つ目の効果音を作る（複製）
    await page.locator('.se-clip').first().click()
    await page.keyboard.press('Control+d')
    await page.waitForTimeout(500)
    const n = await page.locator('.se-clip').count()
    assert(n >= 2, `効果音が2つにならない（${n}）`)
    const xs0 = await page.locator('.se-clip').evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().x))
    )
    await page.locator('.se-clip').nth(0).click()
    await page.locator('.se-clip').nth(1).click({ modifiers: ['Control'] })
    await dragBy(page.locator('.se-clip').nth(0), 60)
    await page.waitForTimeout(400)
    const xs1 = await page.locator('.se-clip').evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().x))
    )
    assert(
      xs1.every((x, i) => x > xs0[i] + 5),
      `まとめて動いていない（${xs0.join(',')} → ${xs1.join(',')}）`
    )
  })

  await check('タイムラインで使っている素材は、置き場から消せず理由が出る', async () => {
    await resetProject()
    const card = await binCardReady('test_image')
    await card.click()
    await page.waitForTimeout(300)
    const bin0 = await page.locator('.media-card').count()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(500)
    assert((await page.locator('.media-card').count()) === bin0, '使用中なのに消えた')
    const toast = await page.locator('.toast').allTextContents()
    assert(toast.some((t) => t.includes('使用中')), `理由が出ていない: ${toast.join(' / ')}`)
  })

  await check('使っていない素材は、置き場から Delete で消える', async () => {
    const n0 = await v1Clips().count()
    const card = await binCardReady('spare_image')
    await card.click()
    await page.waitForTimeout(300)
    const bin0 = await page.locator('.media-card').count()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(500)
    assert((await page.locator('.media-card').count()) === bin0 - 1, '置き場の素材が消えていない')
    assert((await v1Clips().count()) === n0, 'タイムラインのクリップが消えてしまった')
  })

  // =========================================================================
  section('11-12. トラックと元に戻す')
  await resetProject()

  await check('中身が入っているトラックは削除できず、理由が出る', async () => {
    const n0 = await page.locator('[data-tid]').count()
    await trackHead('V1').locator('.th-name').click()
    await page.waitForTimeout(250)
    await page.keyboard.press('Delete')
    await page.waitForTimeout(500)
    assert((await page.locator('[data-tid]').count()) === n0, '中身があるのにトラックが消えた')
  })

  await check('鍵をかけると、端のトリム・分割・削除・複製が全部できなくなる', async () => {
    await resetProject()
    const lock = trackHead('V1').locator('button[title="ロック"]').first()
    const before = await clipLayout()

    // ★先に「鍵なしなら効く」ことを確かめる。
    //   これが無いと、操作がそもそも届いていないだけでも
    //   「鍵が効いている」と読めてしまい、鍵が壊れても気づけない。
    const trimEnd = async () => {
      const box = await v1Clips().nth(0).boundingBox()
      await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width + 80, box.y + box.height / 2, { steps: 5 })
      await page.mouse.up()
      await page.waitForTimeout(400)
    }
    const razorCut = async () => {
      await page.keyboard.press('c')
      await v1Clips().nth(0).click({ position: { x: 30, y: 8 } })
      await page.waitForTimeout(400)
      await page.keyboard.press('v')
    }
    const undo = async () => {
      await page.keyboard.press('Control+z')
      await page.waitForTimeout(500)
    }
    await trimEnd()
    assert(
      Math.abs((await clipLayout())[0].w - before[0].w) > 3,
      '鍵なしでも長さが変わらない＝確認になっていない（つまむ場所が違う疑い）'
    )
    await undo()
    await razorCut()
    assert(
      (await v1Clips().count()) === before.length + 1,
      '鍵なしでも分割できない＝確認になっていない（カッターが効いていない疑い）'
    )
    await undo()
    await v1Clips().nth(0).click()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(400)
    assert(
      (await v1Clips().count()) === before.length - 1,
      '鍵なしでも削除できない＝確認になっていない（キー割当が違う疑い）'
    )
    await undo()
    await v1Clips().nth(0).click()
    await page.keyboard.press('Control+d')
    await page.waitForTimeout(400)
    assert(
      (await v1Clips().count()) === before.length + 1,
      '鍵なしでも複製できない＝確認になっていない'
    )
    await undo()
    assert((await v1Clips().count()) === before.length, '確認の前に状態を戻せていない')

    // ここからが本題。同じ操作が、鍵をかけると全部できなくなること。
    await lock.click()
    await page.waitForTimeout(300)
    await trimEnd()
    near((await clipLayout())[0].w, before[0].w, 3, '鍵をかけたのに長さが変わった')
    await razorCut()
    assert((await v1Clips().count()) === before.length, '鍵をかけたのに分割できた')
    await v1Clips().nth(0).click()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(400)
    assert((await v1Clips().count()) === before.length, '鍵をかけたのに削除できた')
    await page.keyboard.press('Control+d')
    await page.waitForTimeout(400)
    assert((await v1Clips().count()) === before.length, '鍵をかけたのに複製できた')
    await lock.click()
    await page.waitForTimeout(300)
  })

  await check('一番下の音声の段に鍵をかけると、本編の波形も切れない', async () => {
    await resetProject()
    const lock = trackHead('A1').locator('button[title="ロック"]').first()
    const n0 = await v1Clips().count()
    const cutAudio = async () => {
      await page.keyboard.press('c')
      const audio = page.locator('[data-tid="A1"] .audio-clip:not(.se-ghost)').first()
      await audio.click({ position: { x: 40, y: 8 } })
      await page.waitForTimeout(400)
      await page.keyboard.press('v')
    }
    // ★先に「鍵なしなら切れる」ことを確かめる。切れないなら、鍵ではなく
    //   カッターが効いていないだけで合格してしまう。
    await cutAudio()
    assert(
      (await v1Clips().count()) === n0 + 1,
      '鍵なしでも切れない＝確認になっていない（カッターが効いていない疑い）'
    )
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
    assert((await v1Clips().count()) === n0, '確認の前に状態を戻せていない')

    await lock.click()
    await page.waitForTimeout(300)
    await cutAudio()
    assert((await v1Clips().count()) === n0, '音声側の鍵が効かず、本編が分割された')
    await lock.click()
    await page.waitForTimeout(300)
  })

  await check('元に戻したあと、音の波形が消えていない', async () => {
    await resetProject()
    const waveOf = async () =>
      page.locator('[data-tid="A1"] canvas').count()
    const w0 = await waveOf()
    assert(w0 > 0, 'そもそも波形が出ていない')
    await v1Clips().nth(0).click()
    await page.keyboard.press('f')
    await page.waitForTimeout(500)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(700)
    assert((await waveOf()) >= w0, `元に戻したら波形が消えた（${w0} → ${await waveOf()}）`)
  })

  await check('トラックの追加も元に戻せる', async () => {
    const n0 = await page.locator('[data-tid]').count()
    await page.locator('.th-add').first().click()
    await page.waitForTimeout(500)
    assert((await page.locator('[data-tid]').count()) > n0, 'トラックが増えていない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)
    assert((await page.locator('[data-tid]').count()) === n0, '元に戻していない')
  })

  await check('トラックを追加すると、番号順の正しい位置に入る', async () => {
    await page.locator('.th-add').first().click() // 映像トラックを追加
    await page.waitForTimeout(500)
    const ids = await page.locator('[data-tid]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-tid') ?? '')
    )
    const vs = ids.filter((i) => i.startsWith('V')).map((i) => Number(i.slice(1)))
    assert(
      JSON.stringify(vs) === JSON.stringify([...vs].sort((a, b) => b - a)),
      `映像トラックの並びが番号順でない: ${vs.join(',')}`
    )
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  // =========================================================================
  section('6-8. プレビュー操作・文字・重ねた動画')
  await resetProject()

  /** 重ねた動画を V2 に1つ用意する（無いと章8が確認できない） */
  async function placePiP() {
    const r = await dndFromBin('test_video', '[data-tid="V2"]', { x: 150, y: 10 })
    assert(r.ghost, '掴んだ動画の影が出なかった')
    await page.waitForTimeout(1800)
    const n = await page.locator('[data-tid="V2"] .clip:not(.se-ghost)').count()
    assert(n > 0, 'V2 に重ねた動画を置けなかった')
  }

  await check('プレビューで、画像も重ねた動画も無い所を掴むと本編の映像が動く', async () => {
    await seekTo(12) // 画像は 1〜5秒。そこを外す
    const vid = page.locator('.screen-video').first()
    const before = await vid.evaluate((el) => el.style.transform)
    const box = await vid.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    const after = await vid.evaluate((el) => el.style.transform)
    assert(after !== before, `本編の映像が動いていない（${before}）`)
  })

  await check('掴めるものにマウスを乗せると、名前が吹き出しで出る', async () => {
    await seekTo(3) // 画像が映っている時刻
    const img = page.locator('.screen-img').first()
    assert(await img.count(), 'プレビューに画像が出ていない')
    const title = await img.getAttribute('title')
    assert(title && title.includes('test_image'), `名前が出ていない: ${title}`)
  })

  await check('文字を分割すると、左右それぞれが残る', async () => {
    await resetProject()
    const n0 = await page.locator('.telop-clip').count()
    await page.locator('.telop-clip').first().click()
    await page.keyboard.press('c') // カッター
    await page.locator('.telop-clip').first().click({ position: { x: 20, y: 8 } })
    await page.waitForTimeout(500)
    await page.keyboard.press('v')
    assert((await page.locator('.telop-clip').count()) === n0 + 1, '文字が分割されていない')
    const widths = await page.locator('.telop-clip').evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect().width)
    )
    assert(widths.every((w) => w > 2), `幅0の文字ができた（${widths.map(Math.round).join(',')}）`)
  })

  await check('続けて何度でも、再生ヘッドで動画を切れる', async () => {
    // 1回目は切れるのに2回目から切れない、という不具合があった。
    // 分割してできたテロップが選択状態になり、次の Ctrl+K が
    // 「選択中のテロップだけ分割」に切り替わっていたため。
    await resetProject()
    const n0 = await v1Clips().count()
    for (const sec of [1.5, 2.5, 3.5]) {
      await seekTo(sec)
      await page.keyboard.press('Control+k')
      await page.waitForTimeout(350)
    }
    const n1 = await v1Clips().count()
    assert(
      n1 === n0 + 3,
      `3回切ったのにクリップが ${n0} → ${n1} 個（${n0 + 3} 個のはず。2回目以降が効いていない）`
    )
  })

  await check('プレビューの文字をダブルクリックすると、その場で打ち直せる', async () => {
    await resetProject()
    await seekTo(2)
    const tel = page.locator('.telop-overlay > *').first()
    assert(await tel.count(), 'プレビューに文字が出ていない')
    await tel.dblclick()
    await page.waitForTimeout(500)
    const editor = page.locator('.telop-editor textarea, .telop-editor input')
    assert(await editor.count(), 'その場で打ち直す欄が出ない')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  })

  await check('重ねた動画に、拡大・不透明度・回転・色調整・切り抜きが全部ある', async () => {
    await resetProject()
    await placePiP()
    await page.locator('[data-tid="V2"] .clip:not(.se-ghost)').first().click()
    await page.waitForTimeout(500)
    const panel = await page.locator('.panel').first().textContent()
    for (const label of ['拡大', '不透明度', '回転', '色調整', 'クロップ']) {
      assert(panel.includes(label), `右パネルに「${label}」が無い: ${panel.slice(0, 120)}`)
    }
  })

  await check('拡大のつまみを右端まで動かすと 800% まで行く', async () => {
    const sliders = page.locator('.sp-row input[type="range"]')
    const n = await sliders.count()
    assert(n > 0, 'つまみが出ていない')
    let max = null
    for (let i = 0; i < n; i++) {
      const m = await sliders.nth(i).getAttribute('max')
      if (m && Number(m) >= 8) {
        max = Number(m)
        break
      }
    }
    assert(max !== null, `拡大のつまみが見つからない（上限が8以上のものが無い）`)
    assert(max >= 8, `上限が 800% になっていない（${max * 100}%）`)
  })

  await check('「変形・調整をリセット」で設定が元に戻る', async () => {
    const clip = page.locator('[data-tid="V2"] .clip:not(.se-ghost)').first()
    await clip.click()
    await page.waitForTimeout(400)
    // プレビューで動かして変形を付ける
    await seekTo(1)
    const pip = page.locator('.screen-vclip').first()
    if (await pip.count()) {
      const b = await pip.boundingBox()
      if (b) {
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
        await page.mouse.down()
        await page.mouse.move(b.x + b.width / 2 + 70, b.y + b.height / 2, { steps: 5 })
        await page.mouse.up()
        await page.waitForTimeout(400)
      }
    }
    const moved = await page.locator('.screen-vclip').first().evaluate((el) => el.style.transform)
    const reset = page.locator('button', { hasText: 'リセット' }).first()
    assert(await reset.count(), '「リセット」のボタンが無い')
    await reset.click()
    await page.waitForTimeout(500)
    const after = await page.locator('.screen-vclip').first().evaluate((el) => el.style.transform)
    assert(after !== moved, `リセットしても変形が残っている（${after}）`)
  })

  await check('重ねた動画の音が、対の音声段に波形として並ぶ', async () => {
    const wave = await page.locator('[data-tid="A2"] canvas').count()
    assert(wave > 0, '対の音声段に波形が出ていない')
  })

  // =========================================================================
  section('設定のコピーと貼り付け（プレミアの属性ペースト相当）')
  await resetProject()

  await check('テロップの位置をコピーして、他のテロップにも貼れる', async () => {
    // プレビュー上で1つ目のテロップを動かし、その位置を他へ写す
    await seekTo(2)
    const tel = page.locator('.telop-overlay > *').first()
    assert(await tel.count(), 'プレビューにテロップが出ていない')
    const b0 = await tel.boundingBox()
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2)
    await page.mouse.down()
    await page.mouse.move(b0.x + b0.width / 2 - 120, b0.y + b0.height / 2 - 90, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    const moved = await page.locator('.telop-overlay > *').first().boundingBox()

    await page.locator('.telop-clip').first().click()
    await page.keyboard.press('Control+Alt+c')
    await page.waitForTimeout(300)
    await page.locator('.telop-clip').nth(1).click()
    await page.keyboard.press('Control+Alt+v')
    await page.waitForTimeout(500)

    await seekTo(7) // 2つ目のテロップが映る時刻
    const b1 = await page.locator('.telop-overlay > *').first().boundingBox()
    assert(b1, '2つ目のテロップがプレビューに出ていない')
    near(b1.x, moved.x, 8, '貼り付けたのに位置が揃っていない')
    near(b1.y, moved.y, 8, '貼り付けたのに位置が揃っていない')
  })

  await check('テロップの設定を全部選んで貼っても、動画クリップは壊れない', async () => {
    const n0 = await v1Clips().count()
    await page.locator('.telop-clip').first().click()
    await page.keyboard.press('Control+Alt+c')
    await page.waitForTimeout(300)
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+Alt+v')
    await page.waitForTimeout(600)
    assert((await v1Clips().count()) === n0, '動画クリップの数が変わった')
  })

  await check('動画クリップの設定をコピーして、別の動画クリップに貼れる', async () => {
    await resetProject()
    await v1Clips().nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const sw = page.locator('.ctx-swatch:not(.ctx-swatch-none)').first()
    const want = await sw.evaluate((e) => getComputedStyle(e).backgroundColor)
    await sw.click()
    await page.waitForTimeout(400)
    await v1Clips().nth(0).click()
    await page.keyboard.press('Control+Alt+c')
    await page.waitForTimeout(300)
    await v1Clips().nth(2).click()
    await page.keyboard.press('Control+Alt+v')
    await page.waitForTimeout(500)
    const got = await v1Clips().nth(2).evaluate((el) => getComputedStyle(el).backgroundColor)
    assert(got === want, `貼り付いていない（${got} / 期待 ${want}）`)
  })

  await check('右クリックからも、コピーと「何が貼れるか」が分かる形で貼れる', async () => {
    await v1Clips().nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const copy = page.locator('.ctx-item', { hasText: '設定をコピー' })
    assert(await copy.count(), 'メニューに「設定をコピー」が無い')
    await copy.first().click()
    await page.waitForTimeout(300)
    await v1Clips().nth(1).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const paste = page.locator('.ctx-item', { hasText: '設定を貼り付け' })
    assert(await paste.count(), 'メニューに「設定を貼り付け」が無い')
    const label = await paste.first().textContent()
    assert(/色|変形|音量|切り抜き|不透明度/.test(label), `何が貼れるか出ていない: ${label}`)
    await page.keyboard.press('Escape')
  })

  // =========================================================================
  section('15. クリップの色分け（種類ごと）')
  await resetProject()

  await check('本編に色を付けると、映像と音声の両方に付く', async () => {
    await v1Clips().nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    await page.locator('.ctx-swatch:not(.ctx-swatch-none)').first().click()
    await page.waitForTimeout(400)
    const vBg = await v1Clips().nth(0).evaluate((el) => getComputedStyle(el).backgroundColor)
    const aBg = await page
      .locator('[data-tid="A1"] .audio-clip:not(.se-ghost)')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor)
    assert(vBg === aBg, `映像と音声で色が違う（${vBg} / ${aBg}）`)
  })

  await check('「色なし」を選ぶと元の色に戻る', async () => {
    const colored = await v1Clips().nth(0).evaluate((el) => getComputedStyle(el).backgroundColor)
    await v1Clips().nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    await page.locator('.ctx-swatch-none').first().click()
    await page.waitForTimeout(400)
    const plain = await v1Clips().nth(0).evaluate((el) => getComputedStyle(el).backgroundColor)
    assert(plain !== colored, '色なしにしても色が残っている')
  })

  await check('文字・効果音・画像にも色を付けられる', async () => {
    let i = 0
    for (const [name, sel] of [
      ['文字', '.telop-clip'],
      ['効果音', '.se-clip'],
      ['画像', '.img-clip:not(.se-ghost)']
    ]) {
      const el = page.locator(sel).first()
      await el.click({ button: 'right' })
      await page.waitForSelector('.ctx-menu')
      const sw = page.locator('.ctx-swatch:not(.ctx-swatch-none)').nth(i++ % 3)
      assert(await sw.count(), `${name} のメニューに色の選択肢が無い`)
      const want = await sw.evaluate((e) => getComputedStyle(e).backgroundColor)
      await sw.click()
      await page.waitForTimeout(400)
      const after = await el.evaluate((e) => getComputedStyle(e).backgroundColor)
      assert(after === want, `${name} に選んだ色が付いていない（${after} / 選んだ色 ${want}）`)
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
  section('9-10-13. 音・リップル削除・書き出し')
  await resetProject()

  await check('ミキサーの数字に「dB」が付いている', async () => {
    // `.panel-tabs *` だと、タブを囲っている帯そのものが先に当たる。
    // 帯の真ん中はタブとタブの隙間なので、押しても何も起きず、
    // 「ミキサーに dB が出ていない」＝アプリの不具合のように見えていた。
    // タブそのもの（.tab）を押す。
    const tab = page.locator('.panel.monitor .tab', { hasText: 'オーディオミキサー' }).first()
    assert(await tab.count(), 'ミキサーのタブが見当たらない')
    await tab.click()
    await page.waitForTimeout(500)
    const on = await page.locator('.panel.monitor .tab-on').first().textContent()
    assert(on.includes('ミキサー'), `ミキサーのタブに切り替わっていない（${on}）`)
    const txt = await page.locator('.panel.monitor').first().textContent()
    assert(txt.includes('dB'), `ミキサーに dB が出ていない: ${txt.slice(0, 120)}`)
    const back = page.locator('.panel.monitor .tab', { hasText: 'プログラム' }).first()
    if (await back.count()) await back.click()
    await page.waitForTimeout(400)
  })

  await check('画像をリップル削除すると、同じ段の後ろだけが詰まる', async () => {
    await resetProject()
    // V3 に2つ目の画像を置いて、後ろが詰まるか見る
    // 1つ目の画像は 1〜5秒。詰まるのを見るには、その**外**に置く必要がある
    const pps = (await clipW()) / 5
    const r = await dndFromBin('spare_image', '[data-tid="V3"]', { x: Math.round(pps * 9), y: 10 })
    assert(r.ghost, '掴んだ画像の影が出なかった')
    await page.waitForTimeout(600)
    const imgs = page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)')
    assert((await imgs.count()) >= 2, '画像が2つになっていない')
    const xs = await imgs.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)))
    const cueX0 = await page.locator('.telop-clip').first().boundingBox()
    await imgs.nth(0).click()
    await imgs.nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    await page.locator('.ctx-item', { hasText: 'リップル削除' }).first().click()
    await page.waitForTimeout(600)
    const xs2 = await imgs.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)))
    assert(xs2.length === xs.length - 1, '画像が1つ減っていない')
    assert(xs2[0] < xs[1] - 5, `同じ段の後ろが詰まっていない（${xs[1]} → ${xs2[0]}）`)
    const cueX1 = await page.locator('.telop-clip').first().boundingBox()
    near(cueX1.x, cueX0.x, 3, '別の段の文字まで動いてしまった')
  })

  await check('鍵をかけた段のクリップが混ざっていると、リップル削除は実行されない', async () => {
    await resetProject()
    const lock = trackHead('V2').locator('button[title="ロック"]').first()
    await lock.click()
    await page.waitForTimeout(300)
    const n0 = await page.locator('.telop-clip').count()
    await page.locator('.telop-clip').first().click()
    await page.locator('.telop-clip').first().click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const item = page.locator('.ctx-item', { hasText: 'リップル削除' })
    if (await item.count()) {
      await item.first().click()
      await page.waitForTimeout(500)
    } else {
      await page.keyboard.press('Escape')
    }
    assert((await page.locator('.telop-clip').count()) === n0, '鍵をかけたのに消えた')
    await lock.click()
    await page.waitForTimeout(300)
  })

  await check('書き出しの設定画面が出て、いきなり始まらない', async () => {
    await resetProject()
    await page.locator('.mode-tab', { hasText: '書き出し' }).first().click()
    await page.waitForSelector('.export-overlay', { timeout: 8000 })
    const txt = await page.locator('.export-overlay').textContent()
    assert(txt.includes('書き出し設定'), `設定画面が出ていない: ${txt.slice(0, 80)}`)
    await page.locator('.export-overlay').click({ position: { x: 5, y: 5 } })
    await page.waitForTimeout(400)
  })

  await check('フレームレート「素材と同じ」で、素材と同じなめらかさになる', async () => {
    const out = join(outDir, 'fps-same.mp4')
    await setDialogFiles(null, out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
    // 「素材と同じ」の選択肢を持つプルダウンを、文言から探して選ぶ
    const sels = page.locator('.export-overlay .pq-select')
    const n = await sels.count()
    let picked = false
    for (let i = 0; i < n; i++) {
      const opts = await sels.nth(i).locator('option').allTextContents()
      const hit = opts.find((t) => t.includes('素材'))
      if (!hit) continue
      await sels.nth(i).selectOption({ label: hit })
      picked = true
      break
    }
    assert(picked, '「素材と同じ」の選択肢が見つからない')
    await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
    await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 240000 })
    assert(existsSync(out), '書き出しファイルができていない')
    const fpsOf = async (f) => {
      const p = spawn('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', f
      ])
      let o = ''
      p.stdout.on('data', (d) => (o += d))
      await new Promise((res) => p.on('close', res))
      const [a, b] = o.trim().split('/')
      return Number(a) / Number(b || 1)
    }
    const src = await fpsOf(fx.video)
    const got = await fpsOf(out)
    assert(Math.abs(src - got) < 0.5, `素材 ${src.toFixed(2)}fps に対し ${got.toFixed(2)}fps`)
  })

  await check('書き出した動画に、文字と画像が焼き込まれている', async () => {
    // 文字も画像も無い時刻と、両方ある時刻のコマを抜き出して見比べる
    const out = join(outDir, 'fps-same.mp4')
    const frame = async (t, name) => {
      const f = join(shotDir, name)
      const p = spawn('ffmpeg', ['-y', '-ss', String(t), '-i', out, '-frames:v', '1', f])
      await new Promise((res) => p.on('close', res))
      return f
    }
    const withStuff = await frame(2, 'exp-with.png') // 文字1〜3秒・画像1〜5秒
    const without = await frame(12, 'exp-without.png') // 何も乗っていない
    assert(existsSync(withStuff) && existsSync(without), 'コマを抜き出せなかった')
    const sim = await similarity(withStuff, without)
    assert(sim < 0.9, `文字や画像が焼き込まれていない疑い（一致度 ${sim.toFixed(3)}）`)
  })

  await check('書き出しの途中でやめられて、中途半端なファイルが残らない', async () => {
    const out = join(outDir, 'cancelled.mp4')
    await setDialogFiles(null, out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
    await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
    await page.waitForTimeout(1200)
    const cancel = page.locator('.export-overlay button', { hasText: /中止|キャンセル|やめる/ })
    assert(await cancel.count(), '書き出し中に中止できるボタンが無い')
    await cancel.first().click()
    await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 60000 })
    await page.waitForTimeout(800)
    assert(!existsSync(out), '中止したのにファイルが残っている')
  })

  // =========================================================================
  section('パネルの切り離し（ドッキング解除）')
  await resetProject()

  await check('タブを右クリックして、パネルを切り離せる', async () => {
    const monitorW = async () =>
      page.locator('.panel.monitor').boundingBox().then((b) => b.width)
    const w0 = await monitorW()
    await page.locator('.panel-tabs-strip').last().locator('.tab').first().click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const item = page.locator('.ctx-item', { hasText: 'を切り離す' }).first()
    assert(await item.count(), 'メニューに切り離しが無い')
    await item.click()
    await page.waitForTimeout(600)
    assert((await page.locator('.pane-float').count()) > 0, '切り離されていない')
    const w1 = await monitorW()
    assert(w1 > w0 + 20, `切り離してもプレビューが広がらない（${Math.round(w0)} → ${Math.round(w1)}）`)
  })

  await check('切り離したパネルは掴んで動かせて、大きさも変えられる', async () => {
    const pane = page.locator('.pane-float').first()
    const b0 = await pane.boundingBox()
    const head = pane.locator('.float-head')
    const hb = await head.boundingBox()
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
    await page.mouse.down()
    await page.mouse.move(hb.x + hb.width / 2 - 120, hb.y + hb.height / 2 + 60, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    const b1 = await pane.boundingBox()
    assert(Math.abs(b1.x - b0.x) > 40, `動かせていない（${Math.round(b0.x)} → ${Math.round(b1.x)}）`)
    const grip = pane.locator('.float-resize')
    const gb = await grip.boundingBox()
    await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2)
    await page.mouse.down()
    await page.mouse.move(gb.x + 90, gb.y + 60, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    const b2 = await pane.boundingBox()
    assert(b2.width > b1.width + 30, `大きさを変えられない（${Math.round(b1.width)} → ${Math.round(b2.width)}）`)
  })

  await check('「戻す」で元の場所に戻り、切り離した状態は覚えている', async () => {
    await page.locator('.float-dock').first().click()
    await page.waitForTimeout(600)
    assert((await page.locator('.pane-float').count()) === 0, '元に戻っていない')
    const saved = await page.evaluate(() => localStorage.getItem('giftcut.floatPanes'))
    assert(saved !== null, '切り離しの状態が保存されていない')
  })

  // =========================================================================
  section('プレビューの再生バー')
  await resetProject()

  await check('全体のどこを見ているかが、プレビューの下のバーで分かる', async () => {
    const head = page.locator('.preview-scrub-head')
    assert(await head.count(), '再生バーが無い')
    const pos = async () =>
      head.evaluate((el) => parseFloat(getComputedStyle(el).left))
    const p0 = await pos()
    await seekTo(10)
    await page.waitForTimeout(400)
    const p1 = await pos()
    assert(p1 > p0 + 5, `再生位置に付いてこない（${p0} → ${p1}）`)
  })

  await check('バーを押すと、その位置へ飛べる', async () => {
    const bar = page.locator('.preview-scrub')
    const b = await bar.boundingBox()
    const tcOf = async () => page.locator('.tc-cur').first().textContent()
    await page.mouse.click(b.x + b.width * 0.2, b.y + b.height / 2)
    await page.waitForTimeout(500)
    const a = await tcOf()
    await page.mouse.click(b.x + b.width * 0.75, b.y + b.height / 2)
    await page.waitForTimeout(500)
    const c = await tcOf()
    assert(a !== c, `押した所へ飛んでいない（${a} / ${c}）`)
  })

  await check('押した所と、つまみの位置がぴったり合う', async () => {
    // 外枠で位置を測ると、左右の余白ぶんつまみが右へずれる（実際にずれていた）
    const track = page.locator('.preview-scrub-track')
    const head = page.locator('.preview-scrub-head')
    const tb = await track.boundingBox()
    for (const ratio of [0.15, 0.5, 0.85]) {
      const cx = tb.x + tb.width * ratio
      await page.mouse.click(cx, tb.y + tb.height / 2)
      await page.waitForTimeout(400)
      const hb = await head.boundingBox()
      const center = hb.x + hb.width / 2
      near(center, cx, 3, `押した所とつまみがずれている（${Math.round(ratio * 100)}%の位置）`)
    }
  })

  await check('掴んだまま動かすと、早送り・巻き戻しできる', async () => {
    const bar = page.locator('.preview-scrub')
    const b = await bar.boundingBox()
    await page.mouse.move(b.x + b.width * 0.2, b.y + b.height / 2)
    await page.mouse.down()
    const t0 = await page.locator('.tc-cur').first().textContent()
    for (let i = 1; i <= 5; i++)
      await page.mouse.move(b.x + b.width * (0.2 + 0.1 * i), b.y + b.height / 2)
    await page.waitForTimeout(300)
    const t1 = await page.locator('.tc-cur').first().textContent()
    await page.mouse.up()
    assert(t0 !== t1, `掴んで動かしても進まない（${t0} / ${t1}）`)
  })

  // =========================================================================
  section('パネルのタブ（見切れ対策と並び順）')
  await resetProject()

  /** 右パネルを狭めて、タブがはみ出す状態を作る */
  async function narrowRightPanel() {
    const handle = page.locator('.resizer-v').last()
    const b = await handle.boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + 260, b.y + b.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(500)
  }

  await check('送りと一覧のボタンは、狭めていなくても常に出ている', async () => {
    // 出たり消えたりすると押す場所がずれて、どこにあるか覚えられない。
    // 「狭めたときだけ出る」だと、この確認は広いままでも通ってしまう（空振り）ので、
    // **狭める前**に見る。
    for (const panel of [page.locator('.panel-tabs').last(), page.locator('.panel.monitor .panel-tabs')]) {
      assert((await panel.locator('.tab-more').count()) > 0, '一覧（≫）が出ていない')
      assert((await panel.locator('.tab-nav').count()) >= 3, '送りのボタンが出ていない')
    }
    // 送るものが無いときは薄くなる。右パネルは既定の幅でもタブが入りきらないので、
    // 余裕のあるモニタ側（プログラム／ミキサーの2つ）で見る。
    const off = await page.locator('.panel.monitor .tab-nav.tab-nav-off').count()
    assert(off >= 2, `送るものが無いのに薄くなっていない（${off}個）`)
  })

  await check('パネルを狭めると、送りのボタンが押せる状態に変わる', async () => {
    await narrowRightPanel()
    const strip = page.locator('.panel-tabs-strip').last()
    const over = await strip.evaluate((el) => el.scrollWidth > el.clientWidth + 2)
    assert(over, 'タブがはみ出す状態を作れなかった')
    const off = await page.locator('.panel-tabs').last().locator('.tab-nav.tab-nav-off').count()
    assert(off === 0, `はみ出しているのに送りが薄いまま（${off}個）`)
  })

  await check('送りボタンを押しっぱなしにすると、タブが横に流れる', async () => {
    const strip = page.locator('.panel-tabs-strip').last()
    const x0 = await strip.evaluate((el) => el.scrollLeft)
    const next = page.locator('.tab-nav', { hasText: '›' }).last()
    const b = await next.boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(600) // 押しっぱなし
    await page.mouse.up()
    await page.waitForTimeout(200)
    const x1 = await strip.evaluate((el) => el.scrollLeft)
    assert(x1 > x0 + 5, `押しっぱなしで流れていない（${x0} → ${x1}）`)
  })

  await check('一覧（≫）から、見えていないタブへ移動できる', async () => {
    // 送りボタンで流れたままだと「隠れているタブ」が変わるので、先頭に戻す
    await page.locator('.panel-tabs-strip').last().evaluate((el) => (el.scrollLeft = 0))
    await page.waitForTimeout(300)
    await page.locator('.tab-more').last().click()
    await page.waitForSelector('.ctx-menu')
    const item = page.locator('.ctx-item', { hasText: 'トランジション' })
    assert(await item.count(), '一覧に「トランジション」が無い')
    await item.first().click()
    await page.waitForTimeout(600)
    const on = await page.locator('.panel-tabs-strip .tab.tab-on').last().textContent()
    assert(on.includes('トランジション'), `切り替わっていない: ${on}`)
    await page.mouse.click(5, 5) // メニューを閉じる
    await page.waitForTimeout(200)
  })

  await check('一覧（≫）には、いま見えていないタブだけが出る', async () => {
    const strip = page.locator('.panel-tabs-strip').last()
    await strip.evaluate((el) => (el.scrollLeft = 0))
    await page.waitForTimeout(300)
    const visible = await strip.evaluate((el) => {
      const box = el.getBoundingClientRect()
      return [...el.querySelectorAll('.tab')]
        .filter((t) => {
          const r = t.getBoundingClientRect()
          return r.left >= box.left - 1 && r.right <= box.right + 1
        })
        .map((t) => t.textContent.trim())
    })
    await page.locator('.tab-more').last().click()
    await page.waitForSelector('.ctx-menu')
    const listed = await page.locator('.ctx-menu .ctx-item').allTextContents()
    assert(listed.length > 0, '一覧が空')
    assert(
      listed.every((t) => !visible.includes(t.trim())),
      `見えているタブまで出ている（見えている: ${visible.join(',')} / 一覧: ${listed.join(',')}）`
    )
    await page.mouse.click(5, 5)
    await page.waitForTimeout(200)
  })

  await check('一覧（≫）の並び替えコーナーで、長押しして並び順を変えられる', async () => {
    const strip = page.locator('.panel-tabs-strip').last()
    const before = await strip.locator('.tab').allTextContents()
    await page.locator('.tab-more').last().click()
    await page.waitForSelector('.ctx-menu')
    const rows = page.locator('.ctx-menu .tab-sort-row')
    assert((await rows.count()) >= 2, '並び替えコーナーが出ていない')
    const a = await rows.nth(0).boundingBox()
    const b = await rows.nth(1).boundingBox()
    // 長押し → 掴めたことを見てから動かす（掴めていないのに動かして
    // 「並びが変わらない＝正しい」に化けるのを防ぐ）
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(450)
    assert((await page.locator('.tab-sort-grab').count()) === 1, '長押ししても掴めていない')
    for (let i = 1; i <= 6; i++)
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + ((b.y + b.height - a.y) * i) / 6)
    await page.mouse.up()
    await page.waitForTimeout(400)
    const after = await strip.locator('.tab').allTextContents()
    assert(after[0] === before[1], `並び替わっていない（${before.join(',')} → ${after.join(',')}）`)
    await page.mouse.click(5, 5)
    await page.waitForTimeout(200)
  })

  await check('並び替えコーナーは、長押ししていなければ並びが変わらない', async () => {
    // 押しただけ・触れただけで並びが崩れると、選ぼうとしただけで壊れる。
    const strip = page.locator('.panel-tabs-strip').last()
    const before = await strip.locator('.tab').allTextContents()
    await page.locator('.tab-more').last().click()
    await page.waitForSelector('.ctx-menu')
    const rows = page.locator('.ctx-menu .tab-sort-row')
    const a = await rows.nth(0).boundingBox()
    const b = await rows.nth(1).boundingBox()
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    // 長押しの手前（280ms）より短い間に動かす
    for (let i = 1; i <= 6; i++)
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + ((b.y + b.height - a.y) * i) / 6)
    await page.mouse.up()
    await page.waitForTimeout(400)
    const after = await strip.locator('.tab').allTextContents()
    assert(
      after.join(',') === before.join(','),
      `長押ししていないのに並びが変わった（${before.join(',')} → ${after.join(',')}）`
    )
    await page.mouse.click(5, 5)
    await page.waitForTimeout(200)
  })

  await check('タブを掴んで動かすと、並び順を変えられる', async () => {
    const strip = page.locator('.panel-tabs-strip').last()
    await strip.evaluate((el) => (el.scrollLeft = 0))
    await page.waitForTimeout(300)
    const before = await strip.locator('.tab').allTextContents()
    const a = await strip.locator('.tab').nth(0).boundingBox()
    const b = await strip.locator('.tab').nth(1).boundingBox()
    // 1つ目を2つ目より右へ運ぶ
    const goal = b.x + b.width + 6 // 2つ目の右端を越える所まで運ぶ
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++)
      await page.mouse.move(
        a.x + a.width / 2 + ((goal - (a.x + a.width / 2)) * i) / 8,
        a.y + a.height / 2
      )
    await page.mouse.up()
    await page.waitForTimeout(400)
    const after = await strip.locator('.tab').allTextContents()
    assert(after[0] === before[1], `入れ替わっていない（${before.join(',')} → ${after.join(',')}）`)
  })

  await check('掴んで動かしただけでは、タブが切り替わらない', async () => {
    const strip = page.locator('.panel-tabs-strip').last()
    const on = await strip.locator('.tab.tab-on').textContent()
    const t = strip.locator('.tab').nth(1)
    const b = await t.boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(b.x + b.width / 2 - i * 8, b.y + b.height / 2)
    await page.mouse.up()
    await page.waitForTimeout(400)
    const on2 = await strip.locator('.tab.tab-on').textContent()
    assert(on === on2, `並べ替えただけでタブが切り替わった（${on} → ${on2}）`)
  })

  await check('タブの右クリックは、切り離しのメニューだけを出す', async () => {
    // 並び順を変えるのは「掴んで動かす」だけ、右クリックはドッキング関連だけ、
    // と決めた（右クリックに両方入れると、押し間違いで並びが変わってしまう）。
    // 以前はここで「並び順を元に戻す」を探していたが、その項目はアプリに無い。
    const strip = page.locator('.panel-tabs-strip').last()
    // 前の項目で流れたままだと、1つ目のタブが帯からはみ出していて、
    // 右クリックが帯の外（パネル本体）へ落ち、別のメニューが出る。
    await strip.evaluate((el) => (el.scrollLeft = 0))
    await page.waitForTimeout(300)
    await strip.locator('.tab').nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const items = await page.locator('.ctx-menu .ctx-item').allTextContents()
    assert(items.length > 0, 'メニューが空')
    assert(
      items.some((t) => t.includes('切り離す') || t.includes('戻す')),
      `切り離しの項目が無い（${items.join(' / ')}）`
    )
    assert(
      !items.some((t) => t.includes('並び順')),
      `右クリックに並び替えが混ざっている（${items.join(' / ')}）`
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    assert((await page.locator('.ctx-menu').count()) === 0, 'Escape でメニューが閉じない')
  })

  // =========================================================================
  section('仕上げ（残っていた確認）')
  await resetProject()

  await check('「破棄して新規」を押すと、前回の内容が残らない', async () => {
    // 自動保存からの復元プロンプトを出し直すため、アプリを開き直す代わりに
    // 「新規」相当としてプロジェクトを開かずに中身を消す経路を確かめる
    await page.keyboard.press('Control+a')
    await page.keyboard.press('f')
    await page.waitForTimeout(700)
    assert((await v1Clips().count()) === 0, '中身が消えていない')
    assert((await page.locator('.telop-clip').count()) === 0, '文字が残っている')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)
  })

  await check('落ちたときに「1つ前の状態」でも復元できる', async () => {
    // 落ちる原因になった操作ごと戻ってきてしまうと逃げ場が無いので、
    // 下書きは1世代前も残している。実際に読み込み直して確かめる。
    await resetProject()
    // 見分けのつく内容を「最後の自動保存」として置く（クリップ7個）
    const older = JSON.parse(readFileSync(fx.gcprojOrig, 'utf-8'))
    older.segments = Array.from({ length: 7 }, (_, i) => ({
      id: i + 1,
      srcId: 1,
      srcStart: i * 2,
      srcEnd: (i + 1) * 2
    }))
    writeFileSync(join(fx.userData, 'giftcut-autosave.json'), JSON.stringify(older), 'utf-8')
    // 開き直すと、閉じる直前の内容が新しい下書きになり、いま置いた方が1つ前へ回る
    await page.reload()
    await page.waitForSelector('.restore-btns', { timeout: 30000 })
    const prevBtn = page.locator('.restore-btns button', { hasText: '1つ前' })
    assert(await prevBtn.count(), '「1つ前の状態で復元」が出ていない')
    await prevBtn.first().click()
    await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 30000 })
    await page.waitForTimeout(1000)
    const n = await v1Clips().count()
    assert(n === 7, `1つ前の内容が戻っていない（クリップ ${n} 個。7個のはず）`)
  })

  await check('未保存で「プロジェクトを開く」→「中止して保存する」で何も変わらない', async () => {
    await resetProject()
    await dragBy(v1Clips().nth(0), (await clipW()) * 0.4)
    const before = await clipLayout()
    await page.waitForTimeout(1100)
    await setDialogFiles([fx.gcprojOrig], null)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(500)
    const cancel = page.locator('.modal-btn', { hasText: '中止して保存する' })
    assert(await cancel.count(), '「中止して保存する」が出ていない')
    await cancel.click()
    await page.waitForTimeout(600)
    const after = await clipLayout()
    near(after[0].x, before[0].x, 2, '中止したのに内容が変わった')
  })

  await check('動画を差し替えると、確認のうえで差し替わる', async () => {
    await resetProject()
    await setDialogFiles([fx.video], null)
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    const item = page.locator('.menu-drop-item', { hasText: '差し替え' })
    assert(await item.count(), 'メニューに「動画を差し替え」が無い')
    await item.first().click()
    await page.waitForTimeout(700)
    const box = page.locator('.modal-box')
    assert(await box.count(), '差し替えの確認が出ていない')
    const t = await page.locator('.modal-title').textContent()
    assert(t.includes('差し替え'), `確認の見出しが違う: ${t}`)
    await page.locator('.modal-btn.danger', { hasText: '差し替える' }).first().click()
    await page.waitForTimeout(2000)
    assert((await v1Clips().count()) > 0, '差し替え後にクリップが無い')
  })

  await check('一覧のファイルを移動してから選ぶと、エラーが出て一覧から消える', async () => {
    await resetProject()
    const gone = join(outDir, 'gone.gcproj')
    copyFileSync(fx.gcprojOrig, gone)
    await setDialogFiles([gone], null)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(500)
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) await cont.click()
    await page.waitForTimeout(1200)
    rmSync(gone, { force: true }) // ファイルを消してから、一覧経由で開き直す
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.waitForTimeout(300)
    const entry = page.locator('.menu-drop-recent', { hasText: 'gone.gcproj' })
    assert(await entry.count(), '一覧に出ていない')
    await entry.first().click()
    await page.waitForTimeout(1000)
    const toast = await page.locator('.toast').allTextContents()
    assert(toast.some((t) => t.includes('開けません')), `エラーが出ていない: ${toast.join(' / ')}`)
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.waitForTimeout(300)
    assert(
      (await page.locator('.menu-drop-recent', { hasText: 'gone.gcproj' }).count()) === 0,
      '見つからなかった項目が一覧に残っている'
    )
    await page.keyboard.press('Escape')
  })

  await check('Ctrl を押しながら落とすと、割り込みで入って後ろがずれる', async () => {
    await resetProject()
    const before = await clipLayout()
    const total0 = before.reduce((a, c) => a + c.w, 0)
    const r = await dndFromBin('test_video', '[data-tid="V1"]', { x: 60, y: 10 }, { ctrlKey: true })
    assert(r.ghost, '掴んだ動画の影が出なかった')
    await page.waitForTimeout(1500)
    const after = await clipLayout()
    const total1 = after.reduce((a, c) => a + c.w, 0)
    assert(total1 > total0 + 10, `割り込みで全体が伸びていない（${total0} → ${total1}）`)
  })

  await check('ドラッグ中、置く予定の場所に影が出て、音の波形も見える', async () => {
    await resetProject()
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
    await page.evaluate(() => {
      const el = document.querySelector('[data-tid="V1"]')
      const b = el.getBoundingClientRect()
      el.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: b.x + 200,
          clientY: b.y + 10,
          dataTransfer: window.__dt
        })
      )
    })
    await page.waitForTimeout(500)
    assert((await page.locator('.se-ghost').count()) > 0, '置く予定の影が出ていない')
    const audioGhost = await page.locator('[data-tid="A1"] .se-ghost').count()
    assert(audioGhost > 0, '音声側の影が出ていない')
    await page.evaluate(() => {
      document.querySelector('.app').dispatchEvent(new DragEvent('dragend', { bubbles: true }))
    })
    await page.waitForTimeout(300)
  })

  await check('文字がある段に動画を置くと、文字が1段上へ避難する', async () => {
    await resetProject()
    const onV2 = await page.locator('[data-tid="V2"] .telop-clip').count()
    assert(onV2 > 0, 'V2 に文字が無い状態から始まっている')
    const r = await dndFromBin('test_video', '[data-tid="V2"]', { x: 150, y: 10 })
    assert(r.ghost, '掴んだ動画の影が出なかった')
    await page.waitForTimeout(2000)
    const moved = await page.locator('[data-tid="V3"] .telop-clip, [data-tid="V4"] .telop-clip').count()
    assert(moved > 0, '文字が1段上へ避難していない')
  })

  await check('画像は、端をつまんで長さを変えられてカッターで切れる', async () => {
    await resetProject()
    const img = page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)').first()
    const b0 = await img.boundingBox()
    await page.mouse.move(b0.x + b0.width - 3, b0.y + b0.height / 2)
    await page.mouse.down()
    await page.mouse.move(b0.x + b0.width + 60, b0.y + b0.height / 2, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    const b1 = await page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)').first().boundingBox()
    assert(b1.width > b0.width + 20, `長さが変わっていない（${Math.round(b0.width)} → ${Math.round(b1.width)}）`)
    const n0 = await page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)').count()
    await page.keyboard.press('c')
    await page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)').first().click({ position: { x: 40, y: 8 } })
    await page.waitForTimeout(500)
    await page.keyboard.press('v')
    assert(
      (await page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)').count()) === n0 + 1,
      'カッターで切れていない'
    )
  })

  await check('画像や音声をプレビューへ落とすと、一番近い場所に置かれる', async () => {
    await resetProject()
    const n0 = await page.locator('.img-clip:not(.se-ghost)').count()
    const r = await dndFromBin('spare_image', '.panel.monitor', { x: 200, y: 150 })
    assert(r.ghost, '掴んだ画像の影が出なかった')
    await page.waitForTimeout(700)
    assert(
      (await page.locator('.img-clip:not(.se-ghost)').count()) > n0,
      'プレビューに落としても置かれない'
    )
  })

  await check('文字が無い場所で Q を押すと、カットまで詰まる', async () => {
    await resetProject()
    await seekTo(13) // 3つ目のクリップの後半（文字も効果音も無い）
    const before = (await clipLayout()).reduce((a, c) => a + c.w, 0)
    await page.keyboard.press('q')
    await page.waitForTimeout(600)
    const after = (await clipLayout()).reduce((a, c) => a + c.w, 0)
    assert(after < before - 5, `詰まっていない（${before} → ${after}）`)
  })

  await check('空きが入ったまま書き出すと、黒と無音になって尺が合う', async () => {
    await resetProject()
    const W2 = await clipW()
    await dragBy(v1Clips().nth(0), W2 * 0.8)
    await page.waitForTimeout(500)
    const out = join(outDir, 'with-gap.mp4')
    await setDialogFiles(null, out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
    await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
    await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 240000 })
    assert(existsSync(out), '書き出しファイルができていない')
    // 空きの真ん中のコマは真っ黒（明暗の幅がほぼ無い）
    const f = join(shotDir, 'gap-frame.png')
    // 画像は1秒から乗っているので、その手前のコマを見る
    const p = spawn('ffmpeg', ['-y', '-ss', '0.4', '-i', out, '-frames:v', '1', f])
    await new Promise((res) => p.on('close', res))
    const c = await avgColor(f)
    assert(c.y != null && c.y < 30, `空きの所が黒くない（明るさ ${c.y}）`)
  })

  await check('重ねた動画を選んだあと本編を消しても、重ねた動画は残る', async () => {
    await resetProject()
    await placePiP()
    const pip0 = await page.locator('[data-tid="V2"] .clip:not(.se-ghost)').count()
    await page.locator('[data-tid="V2"] .clip:not(.se-ghost)').first().click()
    await page.waitForTimeout(300)
    const n0 = await v1Clips().count()
    await v1Clips().nth(0).click()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(600)
    assert((await v1Clips().count()) === n0 - 1, '本編が消えていない')
    assert(
      (await page.locator('[data-tid="V2"] .clip:not(.se-ghost)').count()) === pip0,
      '重ねた動画まで消えた'
    )
  })

  await check('画像を複数選んで、まとめて動かせる', async () => {
    await resetProject()
    const pps = (await clipW()) / 5
    await dndFromBin('spare_image', '[data-tid="V3"]', { x: Math.round(pps * 9), y: 10 })
    await page.waitForTimeout(600)
    const imgs = page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)')
    assert((await imgs.count()) >= 2, '画像が2つになっていない')
    const xs0 = await imgs.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)))
    await imgs.nth(0).click()
    await imgs.nth(1).click({ modifiers: ['Control'] })
    await dragBy(imgs.nth(0), 60)
    await page.waitForTimeout(500)
    const xs1 = await imgs.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)))
    assert(xs1.every((x, i) => x > xs0[i] + 5), `まとめて動いていない（${xs0} → ${xs1}）`)
  })

  await check('文字をリップル削除しても、別の段の効果音や画像は動かない', async () => {
    await resetProject()
    const se0 = await page.locator('.se-clip').first().boundingBox()
    const img0 = await page.locator('.img-clip:not(.se-ghost)').first().boundingBox()
    const lower = page.locator('[data-tid="V2"] .telop-clip').first()
    await lower.click()
    await lower.click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    await page.locator('.ctx-item', { hasText: 'リップル削除' }).first().click()
    await page.waitForTimeout(600)
    const se1 = await page.locator('.se-clip').first().boundingBox()
    const img1 = await page.locator('.img-clip:not(.se-ghost)').first().boundingBox()
    near(se1.x, se0.x, 3, '別の段の効果音まで動いてしまった')
    near(img1.x, img0.x, 3, '別の段の画像まで動いてしまった')
  })

  await check('一番下の映像の段に鍵をかけると、動画を落としても本編が上書きされない', async () => {
    await resetProject()
    const before = await clipLayout()
    const lock = trackHead('V1').locator('button[title="ロック"]').first()
    await lock.click()
    await page.waitForTimeout(300)
    const r = await dndFromBin('test_video', '[data-tid="V1"]', { x: 60, y: 10 })
    assert(r.ghost, '掴んだ動画の影が出なかった')
    await page.waitForTimeout(1200)
    const after = await clipLayout()
    assert(after.length === before.length, '鍵をかけたのに本編が書き換えられた')
    near(after[0].w, before[0].w, 3, '鍵をかけたのに本編の長さが変わった')
    await lock.click()
    await page.waitForTimeout(300)
  })

  await check('分割と複製も Ctrl+Z で戻る', async () => {
    await resetProject()
    const n0 = await v1Clips().count()
    await seekTo(7)
    await page.keyboard.press('Control+k') // 分割
    await page.waitForTimeout(500)
    assert((await v1Clips().count()) === n0 + 1, '分割できていない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)
    assert((await v1Clips().count()) === n0, '分割が戻っていない')
    await v1Clips().nth(0).click()
    await page.keyboard.press('Control+d') // 複製
    await page.waitForTimeout(500)
    const dup = await v1Clips().count()
    assert(dup > n0, '複製できていない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)
    assert((await v1Clips().count()) === n0, '複製が戻っていない')
  })

  await check('元に戻す→やり直す をしても、素材が入れ替わらない', async () => {
    await resetProject()
    const names0 = await v1Clips().evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''))
    await dragBy(v1Clips().nth(0), (await clipW()) * 0.4)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
    await page.keyboard.press('Control+y')
    await page.waitForTimeout(500)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)
    const names1 = await v1Clips().evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''))
    assert(
      JSON.stringify(names0) === JSON.stringify(names1),
      `素材が入れ替わった\n前: ${names0.join(' | ')}\n後: ${names1.join(' | ')}`
    )
  })

  await check('色を付けたまま保存して開き直すと、色が残っている', async () => {
    await resetProject()
    await v1Clips().nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const sw = page.locator('.ctx-swatch:not(.ctx-swatch-none)').first()
    const want = await sw.evaluate((e) => getComputedStyle(e).backgroundColor)
    await sw.click()
    await page.waitForTimeout(500)
    const saved = join(outDir, 'colored.gcproj')
    await setDialogFiles([saved], saved)
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.locator('.menu-drop-item', { hasText: '別名で保存' }).first().click()
    await page.waitForTimeout(1500)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(500)
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) await cont.click()
    await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 15000 })
    await page.waitForTimeout(800)
    const got = await v1Clips().nth(0).evaluate((el) => getComputedStyle(el).backgroundColor)
    assert(got === want, `色が残っていない（${got} / 期待 ${want}）`)
  })

  await check('タイムラインを拡大縮小しても、クリップの位置がずれない', async () => {
    await resetProject()
    const inner = await page.locator('.track-inner').boundingBox()
    const before = (await clipLayout()).map((c) => c.x - inner.x)
    const zoom = page.locator('.tl-zoom input[type="range"]').first()
    assert(await zoom.count(), '拡大のつまみが無い')
    // range のつまみは fill が効かないので、値を直接入れて React に伝える
    const setRange = (loc, v) =>
      loc.evaluate((el, val) => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        ).set
        setter.call(el, String(val))
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }, v)
    const v0 = await zoom.inputValue()
    await setRange(zoom, Math.round(Number(v0) * 1.6))
    await page.waitForTimeout(500)
    const mid = await page.locator('.track-inner').boundingBox()
    const zoomed = (await clipLayout()).map((c) => c.x - mid.x)
    // 拡大したぶん、位置も比例して広がっているはず（順序と相対比が保たれる）
    assert(
      zoomed.every((x, i) => i === 0 || x > zoomed[i - 1]),
      '拡大したら順序が崩れた'
    )
    await setRange(zoom, Number(v0))
    await page.waitForTimeout(500)
    const back = await page.locator('.track-inner').boundingBox()
    const after = (await clipLayout()).map((c) => c.x - back.x)
    assert(
      after.every((x, i) => Math.abs(x - before[i]) < 3),
      `戻したら位置がずれた（${before.map(Math.round)} → ${after.map(Math.round)}）`
    )
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
    const beforeLayout = await clipLayout()
    const W2 = await clipW()
    await dragBy(v1Clips().nth(0), W2 * 0.6)
    await page.waitForTimeout(300)
    await page.screenshot({ path: b, clip: rect })
    // 画像を比べる前に、そもそも動いたかを数値で確かめる
    // （動いていないのに「見た目が変わらない」と言われても原因が分からない）
    const moved = await clipLayout()
    assert(
      moved[0].x > beforeLayout[0].x + 5,
      `クリップが動いていない（${beforeLayout[0].x} → ${moved[0].x}）`
    )
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

  await check('再生中、カットのつなぎ目で画面が一瞬抜けない（ちらつき）', async () => {
    // 以前「別動画の境界で一度背景が見えてから次が始まる」という症状があった。
    // 抜けた瞬間は絵が消えて平坦になるので、カット付近を連写して
    // 「模様が消えたコマ」が無いかで判定する。
    await resetProject()
    const screen = page.locator('.screen, .monitor .screen, .panel.monitor').first()
    const box = await screen.boundingBox()
    const clip = {
      x: Math.round(box.x + box.width * 0.3),
      y: Math.round(box.y + box.height * 0.3),
      width: Math.round(box.width * 0.4),
      height: Math.round(box.height * 0.4)
    }
    await seekTo(4.2) // 1つ目と2つ目のカット（5秒）の少し手前
    await page.keyboard.press('Space')
    const frames = []
    for (let i = 0; i < 14; i++) {
      const f = join(shotDir, `flick-${String(i).padStart(2, '0')}.png`)
      await page.screenshot({ path: f, clip })
      frames.push(f)
      await page.waitForTimeout(90)
    }
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    const stats = []
    for (const f of frames) stats.push(await avgColor(f))
    const ranges = stats.map((s) => s.range ?? 0)
    const median = [...ranges].sort((a, b) => a - b)[Math.floor(ranges.length / 2)]
    assert(median > 15, `再生中の絵がそもそも出ていない（模様の幅の中央値 ${median}）`)
    // 抜けたコマは模様がほぼ消える。中央値の3割を下回るコマがあれば怪しい。
    const dropped = ranges.filter((r) => r < median * 0.3).length
    assert(
      dropped === 0,
      `つなぎ目で画面が抜けたコマがある（${dropped}/${ranges.length}コマ・模様の幅 ${ranges.map((r) => Math.round(r)).join(',')}）`
    )
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
    // 0.6秒以上の無音が続いていたら音が抜けている疑い。ただし**素材そのものが
    // 無音の所**（実素材の頭など）は問題ではないので、素材側の無音は差し引く。
    const gaps = await silences(out, -50, 0.6)
    const srcGaps = await silences(fx.video, -50, 0.6)
    const explained = (g) =>
      srcGaps.some((s) => g.start >= s.start - 1.2 && g.start <= s.start + s.dur + 1.2)
    const bad = gaps.filter((g) => !explained(g))
    assert(
      bad.length === 0,
      `素材には無い無音ができている: ${bad.map((g) => `${g.start.toFixed(1)}秒から${g.dur.toFixed(1)}秒`).join(' / ')}`
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

  // 画面の記録は「通しで回したとき」と「撮るだけのとき」だけ。
  // 絞って回すたびに同じ画面を撮っても、前のものと変わらず意味が無い。
  if (!ONLY || SHOT_ONLY) {
    await check(
      '最後の画面をスクリーンショットに残す',
      async () => {
        await page.screenshot({ path: join(ROOT, 'e2e', 'last-run.png') })
        if (SHOT_ONLY) console.log('  → e2e/last-run.png に撮りました')
      },
      { setup: true }
    )
  }
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
    for (const r of ng) {
      console.log(`  ・${r.name}\n      ${r.err}`)
      // 通しでだけ落ちるものは、あとから単体で回しても再現しない。
      // そのときの画面を書き出しておく（読むのはこの一覧だけで済む）。
      if (r.state) console.log(`      落ちた時: ${JSON.stringify(r.state)}`)
      if (r.png) console.log(`      画面: ${r.png}`)
    }
    try {
      writeFileSync(
        join(ROOT, 'e2e', 'ng-report.json'),
        JSON.stringify(ng.map(({ name, err, state, png }) => ({ name, err, state, png })), null, 2),
        'utf-8'
      )
      console.log('\n落ちた項目の詳細を e2e/ng-report.json に書き出しました。')
    } catch {
      /* 書けなくても実行結果には影響しない */
    }
  } else {
    // 落ちなかったのに前回の記録が残っていると、それを今回の結果だと読んでしまう
    try {
      rmSync(join(ROOT, 'e2e', 'ng-report.json'), { force: true })
    } catch {
      /* 無ければ何もしない */
    }
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
