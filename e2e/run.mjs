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
// ============================================================================
import { _electron as electron } from 'playwright'
import { spawn, execSync } from 'node:child_process'
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
import { clearModals, watchdog } from './dismiss.mjs'
// 素材作りと後片付けは ./lib/e2eFixture（前回の残りを消すのもここ）
import { cleanLeftovers, makeFixture } from './lib/e2eFixture.mjs'
// --changed（変更から確認を引く対応表）は ./lib/changedArea
import { changedKeywords } from './lib/changedArea.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const SLOW = process.argv.includes('--slow')
// --fast: 人が眺めるための「間」を置かない（機械が回すとき用）
const FAST = process.argv.includes('--fast')
const KEEP = process.argv.includes('--keep')
// 開発中は追加した項目だけ回したい。--only=キーワード で名前か章を絞る。
// ただし前の項目の状態を引き継ぐ確認もあるので、**最終確認は必ず絞らずに通す**。
const argAfter = (flag) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : null
}
// カンマで複数指定できる（--only=タブ,別ウィンドウ）。
// 1つしか指定できないと、章をまたいで起きることを再現できない。
// 実際「通しでだけ落ちる14件」の調査で、章をまたいで回せずに困った。
const ONLY = ((process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7) ||
  argAfter('--only') ||
  '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const CHANGED = process.argv.includes('--changed')
// 見た目を見たいだけのとき用。確認は一切せず、起動して復元して1枚撮って終わる。
// これが無いと、画面を見るためだけにテストを回すことになる。
const SHOT_ONLY = process.argv.includes('--shot')
/**
 * 画面の縦横比。既定は 16:9。
 *
 *   npm run e2e -- --ratio=9:16   ショート（縦長）で通す
 *
 * **縦長は横長の使い回しでは通らない。** 幅と高さが入れ替わるので、
 * テロップの箱・プレビューの当たり判定・書き出しの寸法が別々の壊れ方をしうる。
 * ショートを作る人には毎回効く所なので、同じ確認を縦長でも回せるようにする。
 * 比率は「プロジェクトを戻すたび」に当て直す（読み込みで 16:9 に戻るため）。
 */
const RATIO = (process.argv.find((a) => a.startsWith('--ratio=')) ?? '').slice(8) || '16:9'
if (!['16:9', '9:16', '1:1'].includes(RATIO)) {
  console.error(`知らない比率です: ${RATIO}（16:9 / 9:16 / 1:1）`)
  process.exit(2)
}
// --changed で選ばれた言葉。ONLY と同じ扱いで絞る
const CHANGED_INFO = CHANGED ? changedKeywords() : null
if (CHANGED_INFO) {
  ONLY.push(...CHANGED_INFO.words)
  console.log(
    `変更に関わる確認だけ回します: ${[...CHANGED_INFO.words].join(' / ') || '（該当なし）'}`
  )
  if (CHANGED_INFO.unknown.length) {
    console.log(
      `\x1b[33m対応表に無いファイルの変更（この実行では見ていない）:\x1b[0m\n  ${CHANGED_INFO.unknown.join('\n  ')}`
    )
  }
  if (!ONLY.length) {
    console.log('\x1b[33m選べる確認がありません。通しで回すか --only を指定してください。\x1b[0m')
    process.exit(2)
  }
}
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
// ---------------------------------------------------------------------------
const results = []
// 前のリセット以降に確認を実行したか（実行していれば状態が変わっている可能性がある）
const touchedRef = { dirty: true }
/** 後始末で戻し切れなかった回数。最後にまとめて出す（黙って流さない） */
const viewWarnRef = { n: 0 }
/** 縦横比を当て直す関数の置き場（check から呼ぶ。定義は下の run の中） */
const applyRatioRef = { fn: null }
/**
 * この比率では成り立たない確認を、理由付きで飛ばす。
 *
 * **黙って通さないこと。** 元動画（横長）と直接比べる作りの確認は、
 * 縦長にすると必ず食い違う（レターボックスの黒帯が入るため）。
 * 赤にしても直しようが無く、緑にすると見ていないのに見たことになる。
 */
function skipHere(reason) {
  const e = new Error(reason)
  e.__skip = reason
  throw e
}
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
  if (ONLY.length && !opts.setup && !ONLY.some((w) => name.includes(w) || curSection.includes(w))) {
    results.push({ name, skipped: true })
    return
  }
  const total = Math.max(TOTAL_HINT, results.length + 1)
  await banner({ status: 'run', name: esc(name), section: esc(curSection), done: results.length, total })
  // 何を確認しているか読めるだけの間を置く（--slow ならもっと長く）
  // **--fast なら間を置かない。** 人が眺めないなら要らない間で、221件で約70秒になる
  if (pageRef && !FAST) await pageRef.waitForTimeout(SLOW ? 900 : 320)
  // **前の項目が窓を開けっぱなしにしていたら、ここで閉じる。**
  //
  // 開いたままの窓は画面全体を覆うので、以降の項目が「押せない」で落ち続ける。
  // 実際、通しで**1件の閉じ忘れが20件以上を巻き添え**にした。
  // ただし黙って直すと閉じ忘れ自体が見えなくなるので、**誰の後始末かを出す**。
  if (pageRef && !opts.setup) {
    try {
      if (await pageRef.locator('.export-overlay').count()) {
        const prev = results.filter((r) => !r.skipped).slice(-1)[0]?.name ?? '（不明）'
        console.log(
          `  \x1b[33m※ 窓が開いたままでした。閉じて続けます（直前: ${prev}）\x1b[0m`
        )
        // どける手順は e2e/dismiss.mjs に1つだけ置いてある
        // （道具ごとに書くと必ずどれかが抜ける。実際1日で4回踏んだ）
        await clearModals(pageRef)
      }
    } catch {
      /* 閉じられなくても本題は続ける */
    }
  }
  // 縦横比を指定して回すときは、**各項目の頭で当て直す**。
  // 比率はプロジェクトに入っているので、開き直すたびに 16:9 へ帰る。
  // ここで当て直さないと、縦長で通したつもりが途中から横長になっていて、
  // 通ったことにならない（起動直後は窓が出ていて押せないので、そこも拾い直す）
  if (pageRef && RATIO !== '16:9' && typeof applyRatioRef.fn === 'function') {
    await applyRatioRef.fn().catch(() => {})
  }
  // **1件ずつ時間を測る。**
  // どれが重いのかを誰も知らないまま「多すぎる気がする」と削ると、
  // 軽くて価値のある物を消して、重くて価値の低い物が残る。
  const t0 = Date.now()
  try {
    touchedRef.dirty = true
    await fn()
    results.push({ name, ok: true, ms: Date.now() - t0, section: curSection })
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
    await banner({ status: 'ok', name: esc(name), section: esc(curSection), done: results.length, total })
  } catch (e) {
    // **「この比率では見られない」は赤にしない。**
    // ただし黙って通すと、見ていないのに緑を見て「大丈夫」と読んでしまう。
    // 飛ばした理由をその場に出し、最後の集計でも「見ていない」に数える。
    if (e && e.__skip) {
      results.push({ name, skipped: true })
      console.log(`  \x1b[33m－\x1b[0m ${name}\n      見ていません: ${e.__skip}`)
      return
    }
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
    results.push({ name, ok: false, err: String(e?.message ?? e), state, png, ms: Date.now() - t0, section: curSection })
    // **落ちた理由はその場で1行出す。**
    // 「回し終わってから報告書を読む」だと、読むためにもう一度回すことになる。
    // 印を付けておけば、流しっぱなしのまま ✓ ✗ 理由 だけを拾える。
    // 落ちた時の画面は最後の一覧にだけ出す（同じ物を2度出すと理由が埋もれる）。
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      \x1b[31m理由:\x1b[0m ${msg}`)
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
        // 画面に出ているお知らせ（失敗の理由はたいていここに出る）
        お知らせ: all('.toast, .toasts > *').map((e) => txt(e).slice(0, 160)),
        // 開いたままの物（これが残っていると、以降のクリックが全部吸われる）
        メニュー: all('.ctx-menu').length,
        ダイアログ: all('.modal, .restore-box').map((e) => txt(e).slice(0, 40)),
        // パネルの配置
        選ばれているタブ: all('.panel-tabs-strip').map((s) => txt(s.querySelector('.tab-on'))),

        パネル幅: {
          左: localStorage.getItem('gc.leftW'),
          右: localStorage.getItem('gc.rightW'),
          並び: localStorage.getItem('giftcut.tabOrder')
        },
        モニタ: txt(document.querySelector('.panel.monitor .tab-on')),
        // 素材ビン
        見えている素材: all('.media-card')
          .filter((e) => e.getBoundingClientRect().height > 0)
          .map((e) => txt(e).slice(0, 24)),
        折りたたみ: all('.tpl-acc').map((e) => `${txt(e).slice(0, 12)}:${e.className.includes('open') ? '開' : '閉'}`),
        // タイムライン
        クリップ数: all('[data-tid="V1"] .video-clip:not(.se-ghost)').length,
        // 選ばれている印は .clip-selected（.sel という名前は今は使っていない）。
        // 古い名前のままだと、何を選んでいても必ず 0 と出て調べる手掛かりを失う。
        選択中: all('.clip-selected').length,
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
    args: [ROOT, `--user-data-dir=${fx.userData}`, '--gc-auto'],
    cwd: ROOT
  })
  page = await app.firstWindow()
  // 黙って止まり続けないよう、頭打ちを決めておく（e2e/dismiss.mjs）
  watchdog(90, () => app.close())
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
  /** ZIP に入っている名前の一覧（中身は取り出さない） */
  async function zipNames(zipPath) {
    const yauzl = (await import('yauzl')).default
    return new Promise((res, rej) => {
      yauzl.open(zipPath, { lazyEntries: true }, (err, zf) => {
        if (err) return rej(err)
        const names = []
        zf.on('entry', (e) => {
          names.push(e.fileName.replace(/\\/g, '/'))
          zf.readEntry()
        })
        zf.on('end', () => res(names))
        zf.on('error', rej)
        zf.readEntry()
      })
    })
  }
  /** ZIP の中の1件を文字列で取り出す */
  async function zipRead(zipPath, name) {
    const yauzl = (await import('yauzl')).default
    return new Promise((res, rej) => {
      yauzl.open(zipPath, { lazyEntries: true }, (err, zf) => {
        if (err) return rej(err)
        zf.on('entry', (e) => {
          if (e.fileName.replace(/\\/g, '/') !== name) return zf.readEntry()
          zf.openReadStream(e, (e2, rs) => {
            if (e2) return rej(e2)
            const chunks = []
            rs.on('data', (c) => chunks.push(c))
            rs.on('end', () => res(Buffer.concat(chunks).toString('utf-8')))
          })
        })
        zf.on('end', () => rej(new Error(`ZIP に ${name} が無い`)))
        zf.on('error', rej)
        zf.readEntry()
      })
    })
  }

  /**
   * その時刻の1枚を、**フレーム単位で正確に**抜く（＋任意の加工）。
   *
   * grabFrame は -ss を -i の前に置く速い抜き方で、キーフレームまでしか戻らない。
   * 「寄った絵か」を比べるときは1フレームの取り違えが効くので、こちらを使う。
   */
  async function exactFrame(video, sec, out, vf) {
    await new Promise((res) => {
      const args = ['-y', '-i', video, '-ss', String(sec), '-frames:v', '1']
      if (vf) args.push('-vf', vf)
      args.push(out)
      spawn('ffmpeg', args).on('close', res)
    })
    return out
  }
  /** 書き出した動画から、その時刻の1枚を抜く（動いているかを目で比べるため） */
  async function grabFrame(video, sec, out) {
    await new Promise((res) => {
      const p = spawn('ffmpeg', ['-y', '-ss', String(sec), '-i', video, '-frames:v', '1', out])
      p.on('close', res)
    })
    return out
  }

  /** 画像の平均色（0〜255）。赤くなったか、暗くなったかを測る。 */
  /**
   * 画像の一部だけの明るさを測る。
   *
   * **切り取りは撮るときではなく、撮った後にやること。** Playwright の
   * screenshot に clip を渡すと表示範囲がいじられ、その拍子にマウスが枠から
   * 出た扱いになる。マウスを乗せている前提の物（ホバーの印）は、撮る瞬間に
   * 消えてしまい「描かれていない」という誤った結論になる（実際に一度なった）。
   */
  async function avgColorAt(f, x, y, w, h) {
    return avgColor(f, `crop=${w}:${h}:${x}:${y}`)
  }
  async function avgColor(f, pre) {
    const vf = (pre ? pre + ',' : '') + 'signalstats,metadata=print'
    const p = spawn('ffmpeg', ['-i', f, '-vf', vf, '-f', 'null', '-'])
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
    'giftcut.tabOrder', // タブの並び順
    'gc.leftW',
    'gc.rightW',
    'gc.timelineH',
    'gc.videoTrackH',
    'gc.audioTrackH'
  ]

  /**
   * 「画面の状態」の一覧。
   *
   * プロジェクトの中身ではないので、**開き直しても戻らない**もの。
   * ここに載っていないものは誰も戻さないので、前の項目の状態がそのまま
   * 次へ渡り、通しでだけ落ちる。実際、1日で3つ（タブ・見ている場所・拡大率）
   * 取りこぼして14件落とした。**足すならこの表に足すこと。**
   *
   * 各項目:
   *   name    … 落ちたときに出す名前
   *   read    … いまの値。比べられるように文字列で返す
   *   restore … 'reload'（読み込み直しでしか戻らない）か、その場で戻す関数
   */
  const VIEW_STATE = [

    {
      name: '開いたままのメニュー',
      // 右クリックのメニューだけでなく**ファイルメニューも数える**。
      // ここを見ていなかったせいで、開きっぱなしのまま次の項目へ渡り、
      // 「ファイル」をもう一度押す動き（＝閉じる）と噛み合って
      // 「メニューに項目が無い」という別物の失敗になった。
      read: () =>
        page.evaluate(() =>
          String(
            document.querySelectorAll('.ctx-menu').length +
              document.querySelectorAll('.menu-dropdown').length
          )
        ),
      // メニューは押せば閉じる。読み込み直すほどのものではない
      restore: async () => {
        await page.keyboard.press('Escape')
        await page.mouse.click(4, 4)
        await page.waitForTimeout(200)
      }
    },
    {
      // 左パネルは プロパティ / モーション の2枚。モーションを開いたまま次の項目へ
      // 行くと、文字の見た目をいじる欄が出ておらず、後の項目が別の物を見る。
      name: '左パネルのタブ',
      read: () =>
        page.evaluate(() => {
          const s = document.querySelectorAll('.panel-tabs')
          return (s[0]?.querySelector('.tab-on')?.textContent ?? '').trim()
        }),
      restore: async () => {
        const t = page.locator('.panel-tabs .tab', { hasText: 'プロパティ' }).first()
        if (await t.count()) await t.click()
        await page.waitForTimeout(200)
      }
    },
    {
      name: '右パネルのタブ',
      // 素材ビンは右パネルが「プロジェクト」のときだけ描かれる。
      // トランジションの持ち手を触ると勝手に「設定」へ切り替わる
      read: () =>
        page.evaluate(() => {
          const s = [...document.querySelectorAll('.panel-tabs-strip')]
          return (s[s.length - 1]?.querySelector('.tab-on')?.textContent ?? '').trim()
        }),
      restore: 'reload'
    },
    {
      name: 'モニタのタブ',
      read: () =>
        page.evaluate(() =>
          (document.querySelector('.panel.monitor .tab-on')?.textContent ?? '').trim()
        ),
      restore: 'reload'
    },
    ...LAYOUT_KEYS.map((k) => ({
      name: k,
      read: () => page.evaluate((key) => String(localStorage.getItem(key)), k),
      restore: 'reload'
    })),
    {
      name: 'タイムラインの見ている場所',
      // 左へ寄せておかないと、1つ目のクリップが左端に埋もれて一部しか掴めず、
      // 「動かせていない」という**別物の失敗**になる
      read: () =>
        page.evaluate(() =>
          String(Math.round(document.querySelector('.track-scroll')?.scrollLeft ?? 0))
        ),
      restore: async () => {
        await page.evaluate(() => {
          const el = document.querySelector('.track-scroll')
          if (el) el.scrollLeft = 0
        })
        await page.waitForTimeout(250)
      }
    },
    {
      name: 'タイムラインの縦の位置',
      // 縦に送ったまま次の項目へ行くと、狙った段が枠の外にいて掴めない。
      //
      // ※戻す先は**0 ではなく起動時の値**。タイムラインは高さが変わるたびに
      // 映像と音声の境目を枠に残すので、起動直後から送られていることがある
      // （実際に 32px 送られた状態が既定だった）。0 に戻すと「戻したのに違う」
      // となって、後始末そのものが失敗する。
      // ※**中身が枠に収まらない間は、送られているのが正しい。**
      // アプリは高さが変わるたびに映像と音声の境目を枠に残すので、
      // 溢れている状態では 0 に戻しても即座に送り直される。
      // そこを「戻せなかった」と数えると、段を高くしただけで後始末が失敗する
      // （音声の段を既定で高くしたときに、実際にそうなった）。
      read: () =>
        page.evaluate(() => {
          const el = document.querySelector('.track-scroll')
          if (!el) return '0'
          // **ここを甘くしないこと。**
          // 一度「収まらない間は見ない」にしたら、送られたまま次へ進み、
          // 座標で押している項目が3件ずれた（範囲選択・SEのまとめ移動・目盛りの印）。
          // 送られたままなら、それは本当に直すべき状態。
          return String(Math.round(el.scrollTop))
        }),
      restore: async (base) => {
        await page.evaluate((v) => {
          const el = document.querySelector('.track-scroll')
          if (el) el.scrollTop = Number(v) || 0
        }, base)
        await page.waitForTimeout(250)
      }
    },
    {
      name: '再生位置',
      // 前の項目が動かした再生位置が残っていると、次の項目が
      // 「そこに映っているはずの物」を別の時刻で探すことになる
      // 秒までで見る。**フレーム単位の差は無視する。**
      // 目盛りを押して戻すので1フレームずれることがあり、そこで止めても意味が無い
      // （見たいのは「5秒のまま次の項目へ行っていないか」）。
      read: () =>
        page.evaluate(() =>
          (document.querySelector('.tc-cur')?.textContent ?? '').trim().split(':').slice(0, 3).join(':')
        ),
      restore: async () => {
        // Home では戻らない（キーが割り当てられていない）ので目盛りの先頭を押す。
        // **クリップの位置から計算してはいけない。** 読み込み直した直後は
        // タイムラインが空で、クリップを探しに行くと待ち続けて実行ごと落ちる
        // （実際、通しがここで止まった）。
        const rb = await page.locator('.ruler').boundingBox().catch(() => null)
        const inner = await page.locator('.track-inner').boundingBox().catch(() => null)
        if (!rb || !inner) return
        await page.mouse.click(inner.x + 2, rb.y + rb.height / 2)
        await page.waitForTimeout(300)
      }
    },
    {
      name: 'タイムラインの拡大率',
      // 積み上がると「クリップ1つぶんの幅」が変わり、同じ距離を動かしたつもりが
      // 磁石に吸い戻される（負荷チェックでも同じ失敗をした）
      read: () =>
        page.evaluate(
          () => document.querySelector('.tl-zoom input[type="range"]')?.value ?? ''
        ),
      restore: async (base) => {
        await page.evaluate((val) => {
          const el = document.querySelector('.tl-zoom input[type="range"]')
          if (!el) return
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
          ).set
          setter.call(el, String(val))
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }, base)
        await page.waitForTimeout(350)
      }
    }
  ]

  /**
   * 起動直後の画面の状態。既定値を直接書くと、アプリ側で既定を変えた瞬間に
   * 毎回「ずれている」と言い出すので、実際の値を控える。
   *
   * **取るのは起動直後の1回だけ**（遅れて取ると、ずれた状態が基準になる）。
   */
  let viewBase = null
  const readView = async () => {
    const out = []
    for (const s of VIEW_STATE) out.push(await s.read())
    return out
  }
  async function captureViewBase() {
    viewBase = await readView()
  }
  /** 起動時と違っている項目を返す */
  async function viewDrift() {
    if (!viewBase) return []
    const now = await readView()
    return VIEW_STATE.map((s, i) => ({ s, now: now[i], base: viewBase[i] })).filter(
      (x) => x.now !== x.base
    )
  }
  /**
   * 画面の状態を起動直後へ戻す。
   *
   * その場で戻せるものは戻し、読み込み直しでしか戻らないものが1つでもあれば
   * 読み込み直す。**戻したあと、本当に戻ったかを確かめる**（戻せていないのに
   * 先へ進むと、原因が分からないまま次の項目が落ちる）。
   */
  async function restoreView(drift) {
    const why = drift.map((d) => `${d.s.name}: ${d.base} → ${d.now}`).join(' / ')
    console.log(`  \x1b[90m画面の状態を戻します（${why}）\x1b[0m`)
    if (drift.some((d) => d.s.restore === 'reload')) {
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
    for (const d of drift) {
      if (typeof d.s.restore === 'function') await d.s.restore(d.base)
    }
    const left = await viewDrift()
    // **戻し切れなくても、そこで通しを打ち切らない。**
    // 後始末は各項目の合間に走るので、ここで例外にすると
    // **1件の戻し漏れで残り全部が回らなくなる**（実際、通しが4回止まった）。
    // 見落とさないよう必ず出したうえで、確認は続ける。
    if (left.length) {
      console.log(
        `  \x1b[33m※ 戻し切れなかった: ${left
          .map((d) => `${d.s.name}=${d.now}（起動時 ${d.base}）`)
          .join(' / ')}\x1b[0m`
      )
      viewWarnRef.n++
    }
  }
  /**
   * 用意した状態に戻す。各章の頭で呼ぶ。
   * 前の章の操作が残っていると、失敗の原因が「今見ている物」なのか
   * 「前の章の後始末漏れ」なのか分からなくなる。
   */
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
      await restoreView(drift)
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
  // ---- 章をまたいで使う道具 ----
  //
  // **1ファイルだった頃は、前の章で作った物が後ろの章から見えていた。**
  // 分けたら見えなくなり、通しで6件が「定義されていない」で落ちた。
  // 章をまたぐ物はここに置く（どの章からも同じ物が見える）。

  const setSlider = (row, v) =>
    page
      .locator('.sil-row', { hasText: row })
      .locator('input')
      .evaluate((el, val) => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        ).set
        setter.call(el, String(val))
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }, v)
  /** 無音カットを開いて、確認用の素材でも見つかる設定にしてから調べる */

  const trackHead = (id) => page.locator('.th', { has: page.locator('.th-name', { hasText: new RegExp(`^${id}$`) }) })

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

  async function placePiP() {
    const r = await dndFromBin('test_video', '[data-tid="V2"]', { x: 150, y: 10 })
    assert(r.ghost, '掴んだ動画の影が出なかった')
    await page.waitForTimeout(1800)
    const n = await page.locator('[data-tid="V2"] .clip:not(.se-ghost)').count()
    assert(n > 0, 'V2 に重ねた動画を置けなかった')
  }

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
  for (const name of [
    '01-起動と復元',
    '02-タイムライン編集',
    '03-音と書き出し',
    '04-素材の配置',
    '05-カットと色',
    '06-書き出しの設定と表記',
    '07-保存とプロジェクト',
    '08-右パネル',
    '09-モーション',
    '10-更新と素材整理',
    '11-編集の残り',
    '12-プレビュー',
    '13-属性ペーストと色',
    '14-字幕と音',
    '15-パネルと見た目',
    '16-仕上げ',
    '17-目と耳の確認',
  ]) {
    const mod = await import(`./checks/${name}.mjs`)
    await mod.default(C)
  }

} catch (e) {
  console.error('\n\x1b[31m実行そのものに失敗しました:\x1b[0m', e?.message ?? e)
  results.push({ name: '（実行）', ok: false, err: String(e?.message ?? e) })
} finally {
  const ok = results.filter((r) => r.ok).length
  const skipped = results.filter((r) => r.skipped).length
  const ng = results.filter((r) => !r.ok && !r.skipped)
  console.log(`\n\x1b[1m結果: ${ok} / ${results.length} 件が期待どおり\x1b[0m`)
  // **重い項目を名指しで出す。**
  //
  // 「数が多すぎる気がする」で削ると、軽くて価値のある物を消して、
  // 重くて価値の低い物が残る。どこに時間が乗っているかを毎回見せておく。
  const timed = results.filter((r) => r.ms != null).sort((a, b) => b.ms - a.ms)
  if (timed.length) {
    const all = timed.reduce((n, r) => n + r.ms, 0)
    console.log(`\n時間: 合計 ${(all / 60000).toFixed(1)}分。重い順に:`)
    for (const r of timed.slice(0, 10))
      console.log(`  ${(r.ms / 1000).toFixed(1).padStart(6)}秒  ${String(r.name).slice(0, 56)}`)
    const bySec = new Map()
    for (const r of timed) bySec.set(r.section, (bySec.get(r.section) ?? 0) + r.ms)
    console.log('章ごと:')
    for (const [name, ms] of [...bySec].sort((a, b) => b[1] - a[1]).slice(0, 6))
      console.log(`  ${(ms / 1000).toFixed(0).padStart(5)}秒  ${String(name).slice(0, 52)}`)
  }
  // 戻し切れなかった回数は必ず出す。**黙って流すと、次に何かが落ちたときに
  // 「本物か、前の項目の残りか」を毎回調べ直すことになる**
  if (viewWarnRef.n)
    console.log(
      `\x1b[33m※ 画面の状態を戻し切れなかった回数: ${viewWarnRef.n}（上の「戻し切れなかった」を参照）\x1b[0m`
    )
  // 絞って回したときは、必ず「全部は見ていない」と出す。
  // これが無いと、緑を見て「通った＝大丈夫」と読んでしまう。
  if (ONLY.length && skipped) {
    console.log(
      `\x1b[33m※ 絞って回しました（${ONLY.join(' / ')}）。${skipped} 件は見ていません。` +
        `最終確認は絞らずに 1 回。\x1b[0m`
    )
    if (CHANGED_INFO?.unknown.length) {
      console.log(
        `\x1b[33m※ 対応表に無いファイルの変更は見ていません: ${CHANGED_INFO.unknown.join(', ')}\x1b[0m`
      )
    }
  }
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
