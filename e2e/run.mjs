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
//   npm run e2e -- --only=タブ,別ウィンドウ   カンマで複数（章をまたぐ再現用）
//   npm run e2e -- --changed    いま直している所に関わる確認だけ（普段はこれ）
//                               対応表に無いファイルは「見ていない」と出る
//   （項目名の一覧は `grep "await check(" e2e/run.mjs` で見られる）
//
// 手前の項目に寄りかかっている確認は `{ orderDependent: true }` を付けると
// **--only のときだけ飛ばす**（絞ると必ず赤いが通しでは緑、という嘘の赤を消す）。
// **無条件に全部を緑にはしない**——それでは絞った確認が何も見ていないことになる。
// ============================================================================
//
// ## この段取りの中身（**確認そのものは e2e/checks/*.mjs にある**）
//
// 1,024行あった。**500行を超えると AI は通しで読まず grep に切り替わる**ので、
// 話題ごとに4本出した（2026-08-04）。**出した中身は1行も書き換えていない。**
//
//   引数を読む           ./lib/runArgs     --only / --changed / --ratio / --fast
//   記録と札・1件を回す  ./lib/runReport   check / section / banner / 落ちた時の控え
//   画面の状態の見張り   ./lib/runView     VIEW_STATE / 起動時との差 / 戻す
//   最後のまとめ         ./lib/runSummary  件数・重い順・ng-report.json
//
// **ここに残したのは「順番」だけ**——起動して、素材を用意して、道具を束（C）に
// まとめて、checks/*.mjs を章の順に呼ぶ。**章の順に頼っている確認があるので
// 並べ替えないこと**（絞ると赤いが通しでは緑、という嘘の赤が出る）。
//
// 道具を1つずつ渡さず**束のまま渡している**のは、確認を1つ足すたびに
// 引数の並びが伸びるのを止めるため。足す物はこのファイルの `C` に1行足す。
import { _electron as electron } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, existsSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { watchdog } from './dismiss.mjs'
// 素材作りと後片付けは ./lib/e2eFixture（前回の残りを消すのも makeFixture の中）
import { makeFixture } from './lib/e2eFixture.mjs'
// 引数の解釈（--only / --changed / --ratio …）は ./lib/runArgs
import { readRunArgs } from './lib/runArgs.mjs'
// 記録と札、1件を回す段取りは ./lib/runReport
import { makeRunReport } from './lib/runReport.mjs'
// 画面の状態（開き直しても戻らない物）の見張りは ./lib/runView
import { makeViewState } from './lib/runView.mjs'
// 最後のまとめは ./lib/runSummary
import { printSummary } from './lib/runSummary.mjs'
// 書き出し先の指定（置き場・名前・入れ物）は ./lib/exportTarget
import { makeExportTools } from './lib/exportTarget.mjs'
// 確認の窓をもう1枚のディスプレイへ寄せる
import { placeOnOtherDisplay } from './lib/placeWindow.mjs'
// 測る道具（撮る・絵を比べる・音を測る・ZIP を覗く）
import { makeRunMeasure } from './lib/runMeasure.mjs'
// アプリを触る道具（再生位置・クリップの測り方・素材ビンから落とす）
import { makeAppHelpers } from './lib/appHelpers.mjs'
// 章の並び。**唯一の一覧**（solo-audit.mjs と共用）
import { CHAPTERS } from './lib/chapters.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
// 引数は束のまま持っておく（下の makeRunReport へそのまま渡すため。
// 個別に配ると、フラグを1つ足すたびに渡し忘れが起きる）
const ARGS = readRunArgs()
const { KEEP, ONLY, SHOT_ONLY, RATIO, STEP, CHANGED_INFO, CHAPTER } = ARGS

const sh = (cmd, args) =>
  new Promise((res) => {
    const p = spawn(cmd, args)
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('error', () => res({ code: -1, err: 'spawn failed' }))
    p.on('close', (code) => res({ code, err }))
  })

// ---------------------------------------------------------------------------
// 記録と札、1件ずつ回す段取り（./lib/runReport）
//
// 一緒に返る `*Ref` は、**check と後始末が共有する控え**。値ではなく箱で
// 受け渡すのは、どちらも後から中身が入れ替わるため（写しを配ると古い物を見る）。
// ---------------------------------------------------------------------------
const {
  results,
  touchedRef,
  viewWarnRef,
  applyRatioRef,
  viewDirtyRef,
  TOTAL_HINT,
  skipHere,
  banner,
  esc,
  section,
  check,
  setPage,
  sectionName
} = makeRunReport({ ROOT, ...ARGS })

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
    args: [ROOT, `--user-data-dir=${fx.userData}`, '--gc-auto'],
    cwd: ROOT
  })
  page = await app.firstWindow()
  // 窓の置き場所は ./lib/placeWindow（作業中の画面を占領しないため）
  await placeOnOtherDisplay(app)
  // 黙って止まり続けないよう、頭打ちを決めておく（e2e/dismiss.mjs）
  watchdog(90, () => app.close())
  // 札・落ちた時の控えには画面が要る。**起動より後にしか無い**ので、ここで渡す
  setPage(page)
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
  // 縦横比を指定されていれば、最初から当てておく（以降は resetProject が当て直す）
  if (RATIO !== '16:9') {
    console.log(`\x1b[36m画面の縦横比: ${RATIO} で通します\x1b[0m`)
    await applyRatio()
  }
  /** 次に「開く／保存」で選ばれるファイルを差し替える */
  const setDialogFiles = (open, save) =>
    app.evaluate(
      (_e, { open, save }) => {
        if (open) globalThis.__e2e.open = open
        if (save) globalThis.__e2e.save = save
      },
      { open, save }
    )

  // 書き出し先の指定は ./lib/exportTarget（置き場・名前・入れ物をまとめて合わせる）
  const { setExportTarget, fillExportName } = makeExportTools(page, setDialogFiles)

  // -------------------------------------------------------------------------
  // 目で見る確認（スクリーンショットを撮って ffmpeg で中身を測る）
  // -------------------------------------------------------------------------
  const shotDir = join(ROOT, 'e2e', 'shots')
  mkdirSync(shotDir, { recursive: true })
  let shotNo = 0
  // 測る道具（撮る・比べる・音を測る・ZIP を覗く）は ./lib/runMeasure へ出した。
  // **中身は動かしていない。** 出したのは行数の都合（run.mjs が上限に貼り付いて、
  // 確認を1つ足すたびに関係ない所の説明を削る羽目になっていた）。
  // 借りているのは page と assert の2つだけ＝切り出せる形だった
  const {
    shot, similarity, zipNames, zipRead, exactFrame, grabFrame,
    avgColorAt, avgColor, meanVolume, silences, loudness
  } = makeRunMeasure(page, assert, shotDir)


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
  // 画面の状態（開き直しても戻らない物）の見張りは ./lib/runView。
  // **足す物はあちらの VIEW_STATE の表へ。** ここに書き足すと誰も戻さない
  const { captureViewBase, viewDrift, restoreView } = makeViewState({
    page,
    viewDirtyRef,
    viewWarnRef
  })

  /**
   * トランジションタブで開けた節を畳み直す。
   *
   * **節の開閉は保存されるので、開けっぱなしにすると次の項目へ持ち越す。**
   * 実際に「既定は全部畳んでおく」を見ている項目が、これで赤くなった。
   */
  const closeTransAccs = async () => {
    for (const el of await page.locator('.tpl-acc.open').all()) {
      await el.click().catch(() => {})
      await page.waitForTimeout(150)
    }
  }

  /**
   * 用意した状態に戻す。各章の頭で呼ぶ。
   * 前の章の操作が残っていると、失敗の原因が「今見ている物」なのか
   * 「前の章の後始末漏れ」なのか分からなくなる。
   *
   * ※この説明は `closeTransAccs` の上に取り残されていた（本体はこちら）。
   *   割った日に気づいたので戻した——**指す先の違う取説は、無いより悪い。**
   */
  async function resetProject() {
    if (SHOT_ONLY) return
    // 別ウィンドウへ出したパネルが残っていると、本体からはそのパネルが
    // 丸ごと消えたままになる。以降の項目は探している物を見つけられない。
    for (const w of app.windows()) {
      if (w === page) continue
      console.log('  \x1b[90m別ウィンドウが残っていたので閉じます\x1b[0m')
      await w.close().catch(() => {})
      await page.waitForTimeout(800)
    }
    // 画面の状態は、何も編集していなくてもずれる（タブが切り替わるだけでずれる）。
    // なので dirty の判定より先に見る。
    const drift = await viewDrift()
    if (drift.length) {
      // このあとプロジェクトを開き直すなら、ここはまだ「最後の一手」ではない。
      // 中身の長さが変わったままだと拡大率が一致しないので、ここで数えると
      // 実害の無い「戻し切れなかった」が出る（restoreView の @param final 参照）。
      const willReopen = touchedRef.dirty || drift.some((d) => d.s.restore === 'reload')
      await restoreView(drift, !willReopen)
      // 読み込み直したなら中身も戻す。その場で戻しただけなら中身は無傷
      if (drift.some((d) => d.s.restore === 'reload')) touchedRef.dirty = true
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
      // 章の名前は写しを持たず、そのつど読む（章は check 側で変わる）
      section: esc(sectionName()),
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
    // プロジェクトを開き直すと、見ている場所や拡大率がまたずれることがある。
    // 表に従ってもう一度そろえる（ここを飛ばすと、開いた直後の状態で次へ進む）。
    const after = await viewDrift()
    if (after.length) await restoreView(after)
    assert((await v1Clips().count()) === 3, '状態を戻せなかった（クリップが3つにならない）')
    await applyRatio()
  }
  /**
   * 指定された縦横比に合わせる（--ratio）。
   *
   * **プロジェクトを開くたびに当て直す。** 比率はプロジェクトに入っているので、
   * 戻すたびに 16:9 へ帰る。ここで当て直さないと、縦長で通したつもりが
   * 途中から横長に戻っていて、**通ったことにならない**。
   */
  applyRatioRef.fn = applyRatio
  // check から「画面が寄ったまま終わっていないか」を見られるようにする
  viewDirtyRef.fn = viewDrift
  async function applyRatio() {
    if (RATIO === '16:9') return
    // 窓（復元の確認・テンプレート選び）が出ている間は押せない。
    // ここで粘らずに見送る——次の項目の頭でまた当てるので取りこぼさない
    if (await page.locator('.export-overlay').count()) return
    const chip = page.locator('.ratio-group .chip', { hasText: RATIO }).first()
    if (!(await chip.count())) return
    const on = await page.locator('.ratio-group .chip.chip-on').innerText().catch(() => '')
    if (on.includes(RATIO)) return
    await chip.click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(400)
  }
  // アプリを触る道具（再生位置・クリップの測り方・素材ビンから落とす）は
  // ./lib/appHelpers へ出した。借りているのは page / assert / v1Clips の3つだけ
  const {
    seekTo, clipW, clipLayout, setSlider, trackHead, binCardReady, dndFromBin, placePiP
  } = makeAppHelpers(page, assert, v1Clips)

  // ここから先の確認は e2e/checks/ に分けてある。
  //
  // **1ファイル7,400行だと、直したい章を探すのに全部を読むことになる。**
  // 足す場所も決まらないので、新しい確認が「仕上げ」に溜まっていた。
  // 並び順は分ける前と同じ（章の順序に頼っている確認があるため、
  // 区画ごとに寄せるのは1章ずつ確かめながら別で進める）。
  const C = {
    setSlider,
    trackHead,
    binCardReady,
    dndFromBin,
    placePiP,
    ONLY,
    RATIO,
    ROOT,
    SHOT_ONLY,
    app,
    assert,
    avgColor,
    avgColorAt,
    captureViewBase,
    check,
    clipLayout,
    clipW,
    closeTransAccs,
    dragBy,
    exactFrame,
    fx,
    grabFrame,
    loudness,
    meanVolume,
    near,
    outDir,
    page,
    pause,
    resetProject,
    section,
    seekTo,
    setDialogFiles,
    setExportTarget,
    fillExportName,
    sh,
    shot,
    shotDir,
    silences,
    similarity,
    skipHere,
    touchedRef,
    v1Clips,
    zipNames,
    zipRead,
  }
  // 章の一覧は ./lib/chapters（`solo-audit.mjs` と共用。書き写さないこと）
  const unknown = CHAPTER.filter((c) => !CHAPTERS.includes(c))
  if (unknown.length) {
    console.error(`\n知らない章です: ${unknown.join(' / ')}\n選べるのは:\n  ${CHAPTERS.join('\n  ')}\n`)
    process.exit(2)
  }
  // **1章だけ回すときは、先に下ごしらえをする。**
  //
  // 通しでは 01-起動と復元 がプロジェクトを開き、以降の章はその上で動く。
  // 単独で回すと素材が1つも無い画面から始まるので、**どの章も同じ理由で落ちる**
  // ——それでは「前の章に寄りかかっているか」が測れない（08章で実際にそうなった）。
  //
  // 並列にしたときも、各担当は「起動して既知の状態にしてから自分の章」をやる。
  // その形をここで作る。**これでも落ちるなら、それは本物の順番依存。**
  // ※ `resetProject()` では足りない。あれは**いま開いている物を開き直す**道具で、
  //   一度も開いていない状態からは何も出てこない（08章で実測）。
  //   最初に開くのは 01章の仕事なので、**01章そのものを下ごしらえとして通す。**
  const BOOT = CHAPTER.length && !CHAPTER.includes(CHAPTERS[0]) ? CHAPTERS[0] : null
  if (BOOT) console.log(`\x1b[90m  （絞って回すので、先に ${BOOT} を通します）\x1b[0m`)
  for (const name of CHAPTERS) {
    // **`--chapter=` があれば、その章だけ。** 前の章を1つも通らないので、
    // 「この章は自分で始められるか」がそのまま出る（e2e/solo-audit.mjs が使う）
    if (CHAPTER.length && !CHAPTER.includes(name) && name !== BOOT) continue
    const mod = await import(`./checks/${name}.mjs`)
    await mod.default(C)
  }

} catch (e) {
  console.error('\n\x1b[31m実行そのものに失敗しました:\x1b[0m', e?.message ?? e)
  results.push({ name: '（実行）', ok: false, err: String(e?.message ?? e) })
} finally {
  // まとめは ./lib/runSummary。**アプリを落とす前に出し切る**
  //（窓を閉じてからだと、落ちた時の画面も件数も出せずに終わる）
  const ngCount = printSummary({ results, ONLY, CHANGED_INFO, viewWarnRef, ROOT })
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
  process.exit(ngCount ? 1 : 0)
}
