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
// 画面を触る道具（寄せる・送る・時刻で指す）。**本体は「何を測るか」だけ持つ**
import { makeViewTools } from './lib/benchView.mjs'
// 記録と札（測る側は say / done しか使わない）
import { makeReporter } from './lib/benchReport.mjs'
// 何を測る相手にするか（引数の解釈と素材づくり）
import { readArgs, prepareFixture } from './lib/benchSetup.mjs'
// **止まっている間に何をしているか**まで見る（--cpu のときだけ）
import { makeCpuProfiler } from './lib/cpuProfile.mjs'
// 触ったときのもたつきを測る7項目（本体は素材づくり・記録・まとめだけ持つ）
import { runOpsChecks } from './bench-ops.mjs'
// 50回編集して50回戻す（履歴・メモリ・元どおりか）
import { runHistoryChecks } from './bench-history.mjs'
// 実際に焼いて、完走するか・音が抜けないか・絵が出ているかを見る
import { runExportChecks } from './bench-export.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const SHOTS = join(ROOT, 'e2e', 'bench-shots')
// **何を測る相手にするか**（引数の解釈と素材づくり）は ./lib/benchSetup。
// 引数は「どの素材を作るか」を決めるためだけにあるので、1つの話題にしてある
const { KEEP, DO_EXPORT, DO_LIMITS, MINUTES, REAL, SELFCHECK, EDITS, PROFILE, WANT_TELOPS, MINUS, CPU, CPU_DEEP } =
  readArgs()

const nowSec = () => Date.now() / 1000

// ---------------------------------------------------------------------------
// 素材づくり（作ったものは .cache に置いて次回から使い回す）
// ---------------------------------------------------------------------------
// 結果の記録と、画面に出す札は ./lib/benchReport（測る側は say / done しか使わない）
// ---------------------------------------------------------------------------
const { rows, setPage, say, done, finish } = makeReporter(
  16 + (DO_LIMITS ? 6 : 0) + (DO_EXPORT ? 4 : 0)
)

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
  // 素材とプロジェクトを用意する（中身は ./lib/benchSetup）。
  // **`video` も受け取ること**——限界さがしが作り物を組み立てるのに要る。
  // 受け取り忘れると `video is not defined` で**最後の最後に**落ちる
  //（最初のコミットからそうなっていて、限界さがしは一度も走っていなかった）。
  const prepared = await prepareFixture({ REAL, MINUTES, PROFILE, MINUS, DO_LIMITS, DO_EXPORT })
  fx = prepared.fx
  const totalSec = prepared.totalSec
  const video = prepared.video

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
  setPage(page)
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

  // 標本器（--cpu のときだけ。既定は null＝素通し）
  const cpu = CPU ? await makeCpuProfiler(app, page, CPU_DEEP) : null

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
    if (cpu) await cpu.start()
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
    // **成立しなかったときも出す。** 何をしていて成立しなかったのかが、
    // そのまま原因になっていることがある
    if (cpu) await cpu.stop(name)
    if (failed) return done('動作', name, `操作が成立しなかった: ${failed}`, 'ng')
    if (!s) return done('動作', name, '（描画が記録できなかった）', 'warn')
    // **窓が裏に回ったら、それは測定不成立。アプリのせいにしない。**
    //
    // 前に出たら Chromium は rAF を**1秒に1回**へ絞る。すると中央値が
    // ぴったり 1000ms 付近になり、所要時間も 26秒 → 98.8秒 に膨らむ。
    // これを黙って通すと「アプリが致命的に重い」という顔の赤が6件並ぶ
    // （2026-08-04、別のセッションが Electron を起動して前面を奪ったとき実際にそうなった。
    //   数字だけ見て「描画が重い」と読み違えるところだった）。
    if (s.median > 500)
      return done(
        '動作',
        name,
        `測れていない: 1コマが ${fmt(s.median)}ms（＝毎秒1コマ）。**窓が裏に回されている**。` +
          '他のアプリや別の e2e が前面を取っていないか確かめて、測り直すこと',
        'ng'
      )
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
    // **いまの拡大率は `.track-inner` の幅から読む**（幅 = 尺 × 拡大率）。
    //
    // 前は `input[type="range"][title*="拡大率"]` へ直に値を入れていたが、
    // **そのUIは 2026-08-03 に消えている**（`components/timeline/ZoomBar` へ移った）。
    // 限界さがしは `video is not defined` で手前で落ちていたので、
    // ここが死んでいることに **1年ぶん誰も気づかなかった**。
    // CLAUDE.md の7番「消えた物を守らない。成立しなければ落ちる」そのもの。
    const nowZoom = async () => {
      const w = await page.evaluate(
        () => parseFloat(document.querySelector('.track-inner')?.style.width || '0') || 0
      )
      return w / Math.max(1, totalSec)
    }
    const sc = await page.locator('.track-scroll').boundingBox()
    if (!sc) throw new Error('タイムラインが見つからない（.track-scroll）')
    const cx = sc.x + sc.width / 2
    const cy = sc.y + sc.height / 2
    await page.mouse.move(cx, cy)
    // Ctrl+ホイール1ノッチで ×1.15 / ×0.87。近づくまで回す
    for (let i = 0; i < 80; i++) {
      const z = await nowZoom()
      if (!(z > 0)) throw new Error('拡大率が読めない（.track-inner の幅が0）')
      if (Math.abs(z - v) / v < 0.06) return
      await page.keyboard.down('Control')
      await page.mouse.wheel(0, z < v ? -120 : 120)
      await page.keyboard.up('Control')
      await page.waitForTimeout(30)
    }
    const z = await nowZoom()
    // **届かなかったら落とす。** 黙って進むと、拡大していないまま
    // 「掴む物が画面に無い」と出て、原因が拡大側だと分からなくなる。
    throw new Error(`拡大率を ${v}px/秒 にできなかった（いま ${z.toFixed(1)}）`)
  }
  /**
   * **その種類の1個目が見える所まで、横に送る。**
   *
   * 素材はタイムライン全体（1時間）に散らばるので、**寄せるほど画面に入らなくなる**。
   * 基準 light（3600秒に200枚＝18秒に1枚）では1枚も入らず、
   * 「掴める幅の◯◯が画面に無い」で落ちていた——**負荷ではなく測定側の穴**。
   * `bench-limits` の probe と同じ物（2026-08-04 に両方直した）。
   */
  // 画面を触る道具（寄せる・送る・時刻で指す）は ./lib/benchView。
  // **本体は「何を測るか」だけ持つ**（2026-08-04 に上限へ当たって分けた）。
  const { pxPerSec, headX, headSec, scrollToFirst, zoomUntilGrabbable, seekAt } = makeViewTools({
    page,
    totalSec: MINUTES * 60,
    zoomIn,
    visMid: () => visMid,
    visY,
    ruler: () => page.locator('.ruler').boundingBox(),
    fmt
  })
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

  // 触ったときのもたつきを測る7項目は ./bench-ops。
  // **道具は束で1つだけ渡す**——個別に渡すと17個になり、項目を1つ足すたびに
  // ここを書き換えることになる（`useAppWiring` を剥がしたときと同じ形）。
  await runOpsChecks({
    measure, page, fmt, MINUTES, totalSec,
    visL, visR, visMid, visY, inner, clip,
    zoomIn, seekTo0, scrollToFirst, zoomUntilGrabbable, headX, timelineWidth
  })

  // 自己点検はここまで（この先は「測る」ではなく「壊れていないか見る」なので、
  // わざと間違える対象ではない）
  if (SELFCHECK) {
    const bad = rows.filter((r) => r.verdict !== 'ok').length
    console.log(`\n自己点検: ${rows.length - bad} / ${rows.length} 項目が、わざと間違えると落ちる`)
    if (!KEEP) await app.close()
    process.exit(bad ? 1 : 0)
  }

  // ---- 4. 50回編集して元に戻す（履歴・メモリ・元どおりか） --------------
  // 中身は ./bench-history。**道具は束で1つだけ渡す**（./bench-ops と同じ形）
  const rb = await page.locator('.ruler').boundingBox()
  /** 見くらべに使う時刻。**画面上の位置ではなく秒で指す**（理由は ./lib/benchView） */
  const SEEK_SEC = 20
  await runHistoryChecks({
    page, say, done, shot, heap, heap0, mb, fmt, EDITS, nowSec,
    similarity, prev, visL, visR, rb, seekAt, headSec, SEEK_SEC
  })

  // ---- 6. どこまで耐えるか（限界さがし） --------------------------------
  // 「重いかどうか」だけだと、どこまで足していいのか分からない。
  // 現実にありうる範囲から少しずつ上げて、崩れる手前を見つける。
  // 中身は ./bench-limits.mjs（約380行あるので別ファイル）
  if (DO_LIMITS) await findLimits({ ROOT, nowSec, say, done, app, fx, page, setZoom, heap, video, totalSec })

  // ---- 7. 書き出し（目と耳） -------------------------------------------
  // 中身は ./bench-export。**「完走した」で終わらせない**（無音・真っ黒でも
  // ファイルはできる）ので、尺・大きさ・音量・明るさまで見る
  if (DO_EXPORT) {
    await runExportChecks({
      say, done, fmt, mb, MINUTES, totalSec, nowSec,
      page, sh, join, existsSync, statSync, meanVolume, silentSec, brightness,
      // **この2つを渡し忘れると、焼き終わった直後に ReferenceError で落ちる。**
      // 2026-08-04 の分割で実際に落ちていた（何分も焼いた後なので損害が大きい）
      exportPath, SHOTS
    })
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

  await finish(ng, warn, head)
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
