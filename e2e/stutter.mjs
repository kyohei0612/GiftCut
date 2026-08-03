// カクつきを測る（npm run stutter）
//
// ## なぜ専用の道具か
//
// テスト用に用意した素材（15秒・640x360）は軽すぎて、**実際に詰まる状況が再現しない**。
// 詰まるのはいつも本物のプロジェクト——長い素材・カットが多い・テロップが多い——なので、
// **いま編集している下書きをそのまま使って測る**。
//
// 「なんかカクつく」と言われた所を、機械が同じ手順で何度でも測り直せるようにするのが目的。
// 直したあとに「本当に直ったか」を数で言えないと、いつまでも堂々巡りになる。
//
// ## 何を測るか
//
//   絵の止まり   … 動画の時刻が進まなかった時間（一番長い / 合計）
//   何を再生中か … 焼き直した映像か、まだ原本か（**設定の数字では分からない**）
//   頭出し       … 何回・1回あたり何ms（追いかけが自走していないか）
//   主スレッド   … 50ms 以上塞いだ処理（音がプチプチいう直接の原因）
//
// 頭出しの回数と時間は自前で数える。計測の小窓（Ctrl+Shift+P）は開発版にしか無く、
// この道具は**ビルド済みのものを動かす**ため。
//
// ## 使い方
//
//   npm run stutter                いま編集中の下書きで、1080/720/360 を順に
//   npm run stutter -- --res=1080  画質を指定
//   npm run stutter -- --sec=10    1回あたりの再生秒数（既定6秒）
//   npm run stutter -- --at=30     ここから流す（秒）
//
// **本物の下書きは壊さない。** 一時フォルダへ写し、その写しで起動する。

import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, mkdtempSync, copyFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { clearModals, watchdog } from './dismiss.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const argOf = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.slice(name.length + 3) : def
}
const SEC = Number(argOf('sec', '6'))
const AT = Number(argOf('at', '')) // 未指定なら頭から
const RES_LIST = argOf('res', '') ? [argOf('res', '')] : ['1080', '720', '360']

const REAL = join(process.env.APPDATA ?? join(homedir(), 'AppData/Roaming'), 'GiftCut')
// **プロジェクトファイルを直接渡せる**（--project=<path>）。
// 下書き（自動保存）は「いま開いている物」なので、渡された .gcproj で測るには
// 一度アプリで開き直す手間が要る。それを省く口（2026-08-03）。
const PROJ = argOf('project', '')
const draft = PROJ || join(REAL, 'giftcut-autosave.json')
if (!existsSync(draft)) {
  console.error(
    PROJ
      ? `渡されたプロジェクトが見つかりません: ${draft}`
      : `編集中の下書きが見つかりません: ${draft}\n` +
          'アプリで少し編集してから（下書きは自動で書かれます）もう一度実行してください。'
  )
  process.exit(2)
}
if (!existsSync(join(ROOT, 'out/main/index.js'))) {
  console.error('先に `npm run build` を実行してください（out/main/index.js が必要）。')
  process.exit(2)
}

// **写しで起動する。** 本物を直接使うと、測っただけで下書きが書き換わる
const tmp = mkdtempSync(join(tmpdir(), 'gc-stutter-'))
const userData = join(tmp, 'userData')
mkdirSync(userData, { recursive: true })
copyFileSync(draft, join(userData, 'giftcut-autosave.json'))
// 焼き直した映像は作るのに何分もかかる。本物の置き場へ繋いで使い回す。
// （中身は素材の内容で決まる名前なので、混ざっても壊れない）
const realProxies = join(REAL, 'giftcut-proxies')
let proxyShared = false
// --fresh: 焼き直しを使い回さない＝**変換が走っている最中**を測る。
// 「画質を落とした直後がいちばん酷い」の再現。落とした先はまだ焼けていないので、
// そこで変換が始まり、CPU を取り合う。
if (!process.argv.includes('--fresh') && existsSync(realProxies)) {
  try {
    symlinkSync(realProxies, join(userData, 'giftcut-proxies'), 'junction')
    proxyShared = true
  } catch {
    /* 繋げなければ作り直しになるだけ */
  }
}
console.log(`下書き: ${draft}`)
console.log(`焼き直し: ${proxyShared ? '本物の置き場を使い回します' : '**作り直します**（時間がかかります）'}`)

const app = await electron.launch({
  executablePath: require('electron'),
  args: [ROOT, `--user-data-dir=${userData}`, '--gc-auto'],
  cwd: ROOT
})
const page = await app.firstWindow()
// 黙って止まり続けないよう、頭打ちを決めておく（e2e/dismiss.mjs）
watchdog(30, () => app.close())
page.on('pageerror', (e) => console.log('  [画面の例外]', String(e).slice(0, 200)))
await page.waitForSelector('.app', { timeout: 60000 })
page.setDefaultTimeout(20000)

// 「前回の作業が残っています」→ 復元する。
// **重なって出ることがある**（テンプレート選びなど）ので、
// 余分は e2e/dismiss.mjs でどけてから本命を押す
// **窓が出るまで粘り、押した結果で判断する。**
//
// 前は「1.5秒待つ → clearModals → `.restore-btns` があるか見る」だったが、
// **clearModals は真っ先に『復元する』を押す**（e2e/dismiss.mjs の BUTTONS の
// 先頭）。押したあとに窓を探すので必ず空になり、中身が入っていても
// 「下書きが空の可能性があります」で止まっていた。
// しかも 1.5秒は 1MB クラスの下書きには足りない（2026-08-03。実データで気づいた）。
//
// 見るのは窓ではなく**中身が入ったか**。それが本当に確かめたいこと。
const restore = page.locator('.restore-btns button', { hasText: /^復元する$/ })
const loaded = async () =>
  await page.evaluate(() => ({
    clips: document.querySelectorAll('.clip').length,
    telops: document.querySelectorAll('.telop-clip').length
  }))
let info = await loaded()
for (let i = 0; i < 30 && info.clips + info.telops === 0; i++) {
  if (await restore.count().catch(() => 0)) await restore.first().click().catch(() => {})
  else await clearModals(page)
  await page.waitForTimeout(500)
  info = await loaded()
}
if (info.clips + info.telops === 0) {
  console.error('下書きを読み込めませんでした（切片もテロップも0）。')
  await app.close().catch(() => {})
  rmSync(tmp, { recursive: true, force: true })
  process.exit(2)
}
await page.waitForTimeout(2000)
console.log(`復元しました（切片 ${info.clips} / テロップ ${info.telops}）`)

/** 焼き直しが終わるまで待つ（変換に食われた分をカクつきとして数えないため） */
const waitQuiet = async (ms = 600000) => {
  const t0 = Date.now()
  let said = false
  while (Date.now() - t0 < ms) {
    if ((await page.locator('.proxy-badge').count()) === 0) {
      await page.waitForTimeout(1000)
      if ((await page.locator('.proxy-badge').count()) === 0) return true
    } else if (!said) {
      said = true
      console.log('  焼き直しの完了を待っています…')
    }
    await page.waitForTimeout(1000)
  }
  return false
}

/** 流して、動画の時刻が進んでいるかを刻む。頭出しの回数と時間も自前で数える */
const scan = async (ms) => {
  await page.keyboard.press('Space') // 再生してから測り始める（頭出しの1回目を混ぜない）
  await page.waitForTimeout(600)
  const r = await page.evaluate(async (ms) => {
    const vids = [...document.querySelectorAll('.screen-video')]
    if (!vids.length) return null
    const seeks = []
    const pend = new Map()
    const offs = []
    for (const v of vids) {
      const a = () => pend.set(v, performance.now())
      const b = () => {
        const t = pend.get(v)
        if (t != null) seeks.push(Math.round(performance.now() - t))
        pend.delete(v)
      }
      v.addEventListener('seeking', a)
      v.addEventListener('seeked', b)
      offs.push(() => {
        v.removeEventListener('seeking', a)
        v.removeEventListener('seeked', b)
      })
    }
    const longs = []
    let obs = null
    try {
      obs = new PerformanceObserver((l) => {
        for (const e of l.getEntries()) longs.push(Math.round(e.duration))
      })
      obs.observe({ entryTypes: ['longtask'] })
    } catch {
      /* 使えない環境では絵の止まりだけで見る */
    }

    // ---- 出ている音そのものを見る ----
    //
    // **絵の止まりでは音の途切れを捕まえられない。** 主スレッドの詰まりは
    // ずっと0回のままなのに、耳では「プチプチ」と聞こえる、という状態が続いていた。
    // 見ている物が違うので、いくら測っても写らない。
    //
    // なので**波形を1サンプルも飛ばさずに通す**。ScriptProcessor は音の処理の
    // 途中に挟まって、流れていく音を全部見せてくれる。見るのは2つ:
    //   ・急に無音になった所（＝音が抜けた）
    //   ・隣り合うサンプルが飛んでいる所（＝「プツッ」の正体。波形の段差）
    //
    // ※ これは**測るために音の通り道へ割り込む**やり方なので、測っている間だけ
    //   経路がわずかに変わる。それでも、復号や切り替えで生じる途切れはここを通る。
    // **割り込みは一度だけ作って、そのまま置いておく。**
    // 測るたびに作って閉じると、閉じた時点でその要素の音の通り道ごと死ぬ。
    // 実際、2回目以降は音が出ないどころか**映像まで止まった**（速さ0.00倍）。
    // 作り直さず、数える所だけを毎回ゼロに戻す。
    const tap = (window.__gcTap ??= { ac: null, stats: null, t0: 0 })
    const audio = { clicks: [], gaps: [], loud: 0, ok: false }
    tap.stats = audio
    tap.t0 = performance.now()
    try {
      if (!tap.ac) {
        const ac = new AudioContext()
        const proc = ac.createScriptProcessor(1024, 2, 2)
        let prev = 0
        let quiet = 0
        const bufMs = (1024 / ac.sampleRate) * 1000
        proc.onaudioprocess = (ev) => {
          const inp = ev.inputBuffer.getChannelData(0)
          const inR =
            ev.inputBuffer.numberOfChannels > 1 ? ev.inputBuffer.getChannelData(1) : inp
          const out = ev.outputBuffer.getChannelData(0)
          const outR =
            ev.outputBuffer.numberOfChannels > 1 ? ev.outputBuffer.getChannelData(1) : null
          let peak = 0
          let jump = 0
          for (let i = 0; i < inp.length; i++) {
            const x = inp[i]
            out[i] = x // 素通しにする（測るために音を止めない）
            if (outR) outR[i] = inR[i]
            const a = x < 0 ? -x : x
            if (a > peak) peak = a
            const d = x - prev < 0 ? prev - x : x - prev
            if (d > jump) jump = d
            prev = x
          }
          const st = tap.stats
          if (!st) return // 数えていない間も素通しは続ける
          if (peak > 0.02) st.loud++
          // 鳴っているはずの所が急に無音になった＝音が抜けた
          if (peak < 0.0005) quiet++
          else {
            if (quiet >= 1 && st.loud > 4)
              st.gaps.push({
                at: Math.round(performance.now() - tap.t0),
                ms: Math.round(quiet * bufMs)
              })
            quiet = 0
          }
          // **段差**。滑らかな音では隣どうしは近い。大きく飛ぶのは継ぎ目が切れた音。
          // **いつ起きたかまで残す。** 回数だけだと、カットの継ぎ目なのか
          // 元の音がそういう音（打楽器など）なのか区別が付かない
          if (jump > 0.25)
            st.clicks.push({
              at: Math.round(performance.now() - tap.t0),
              d: Number(jump.toFixed(2))
            })
        }
        for (const v of vids) {
          // 1つの要素に1回しか繋げない。2回目は例外になる
          if (!v.dataset.tapped) {
            ac.createMediaElementSource(v).connect(proc)
            v.dataset.tapped = '1'
          }
        }
        proc.connect(ac.destination)
        tap.ac = ac
      }
      await tap.ac.resume().catch(() => {})
      audio.ok = true
    } catch {
      /* 繋げない環境では音の判定を出さない（「無音だった」とは言わない） */
    }

    const every = 50
    const rows = []
    const trace = []
    // **進んだ量は「前へ進んだぶん」だけ足す。** 引き戻し（頭出し）を混ぜると、
    // 追いつけていないのに realtime で流れているように見えてしまう
    let advance = 0
    // **必ず「いま映っている面」だけを見る。**
    // カットの手前では裏の面も走っている（助走）。全部の最大で見てしまうと、
    // 表が止まっていても裏が進んでいるぶんで隠れて、**止まりが 0ms に見える**。
    const shownIdx = () =>
      vids.findIndex((v) => !v.paused && !v.muted && getComputedStyle(v).opacity === '1')
    const t0 = performance.now()
    let prev = vids.map((v) => v.currentTime)
    let prevShown = shownIdx()
    let lagMax = 0
    while (performance.now() - t0 < ms) {
      await new Promise((res) => setTimeout(res, every))
      const now = vids.map((v) => v.currentTime)
      const shown = shownIdx()
      // 計測の小窓が出している「絵の遅れ」。**文字は再生ヘッドの時刻で動くので、
      // ここが大きいと文字だけ先に動いて見える**（動きの置き場所の話と紛らわしい）
      const lagTxt = document.querySelector('.perf-lag b')?.textContent
      const lagNow = lagTxt ? Number(lagTxt) : NaN
      if (Number.isFinite(lagNow) && lagNow > lagMax) lagMax = lagNow
      // 面が入れ替わった直後は、別の物どうしを引き算しても意味が無いので飛ばす
      const same = shown >= 0 && shown === prevShown
      const step = same ? now[shown] - prev[shown] : null
      if (step !== null && step > 0 && step < 0.5) advance += step
      rows.push(step === null ? true : step > 0.005)
      trace.push({
        ms: Math.round(performance.now() - t0),
        // 映っている面と、その音量。**カットで面を入れ替えたときに音量が
        // 引き継がれていないと、そこだけ全開で鳴る**（＝ホワイトノイズが荒くなる）
        snd: shown,
        vol: Number((vids[shown]?.volume ?? -1).toFixed(3)),
        // どの<video>が何をしているかも別々に残す（--trace で読む）
        v: vids.map((v) => ({
          ct: Number(v.currentTime.toFixed(3)),
          p: v.paused ? 1 : 0,
          sk: v.seeking ? 1 : 0,
          rs: v.readyState
        }))
      })
      prev = now
      prevShown = shown
    }
    obs?.disconnect()
    for (const f of offs) f()
    tap.stats = null // 数えるのはここまで（割り込みは繋いだままにしておく）
    const active = vids.find((v) => !v.paused) ?? vids[0]
    return {
      rows,
      trace,
      advance,
      every,
      longs,
      seeks,
      audio,
      lagMax,
      played: rows.length > 0 && rows.some(Boolean),
      src: active.currentSrc ?? '',
      dropped: active.getVideoPlaybackQuality?.()?.droppedVideoFrames ?? 0
    }
  }, ms)
  await page.keyboard.press('Space') // 止める
  await page.waitForTimeout(500)
  if (!r) return null
  let run = 0
  let worst = 0
  let frozen = 0
  // 止まった場所を残す。「何msカクついた」だけだと、頭出しなのかカットなのか分からない
  const stops = []
  for (let i = 0; i < r.rows.length; i++) {
    if (r.rows[i]) {
      if (run >= 2) stops.push({ at: (i - run) * r.every, ms: run * r.every })
      run = 0
    } else {
      run++
      frozen++
      if (run > worst) worst = run
    }
  }
  if (run >= 2) stops.push({ at: (r.rows.length - run) * r.every, ms: run * r.every })

  // 音量の跳ね上がり。**一瞬だけ飛び出して戻る形**だけを拾う。
  // カットで音を重ねている間は単調に上がるだけなので、それは拾わない。
  //
  // ※50msごとの標本なので、**もっと短い飛び出しは写らない**。
  //   ここが「なし」でも「無い」証明にはならない。
  const jumps = []
  for (let i = 1; i < r.trace.length - 1; i++) {
    const a = r.trace[i - 1]
    const b = r.trace[i]
    const c = r.trace[i + 1]
    if (a.vol < 0 || b.vol < 0 || c.vol < 0) continue
    if (b.vol - a.vol > 0.05 && b.vol - c.vol > 0.05) {
      jumps.push({
        at: b.ms,
        from: a.vol,
        to: b.vol,
        swap: a.snd !== b.snd // 面の入れ替えと同時か（＝引き継ぎ漏れ）
      })
    }
  }
  const sk = r.seeks.slice().sort((a, b) => a - b)
  const ranMs = r.rows.length * r.every
  return {
    worstMs: worst * r.every,
    frozenMs: frozen * r.every,
    ranMs,
    // 1.0 なら等倍。0.6 なら**デコードが追いつけていない**（引き戻しで誤魔化している）
    speed: ranMs ? r.advance / (ranMs / 1000) : 0,
    lagMax: r.lagMax,
    // 音の判定。**鳴っていない素材では判定しない**（「全部抜けた」と読ませない）
    audio:
      r.audio?.ok && r.audio.loud > 8
        ? {
            gaps: r.audio.gaps.filter((g) => g.ms >= 10),
            clicks: r.audio.clicks
          }
        : null,
    trace: r.trace,
    stops,
    jumps,
    played: r.played,
    dropped: r.dropped,
    proxy: r.src.includes('giftcut-proxies'),
    seekN: sk.length,
    seekMid: sk.length ? sk[Math.floor(sk.length / 2)] : 0,
    seekMax: sk.length ? sk[sk.length - 1] : 0,
    blockCount: r.longs.length,
    blockWorst: r.longs.length ? Math.max(...r.longs) : 0
  }
}

/** 再生位置を頭から少し入った所へ（頭出し直後の1回目は条件が違う） */
const seekTo = async (sec) => {
  await page.evaluate((sec) => {
    const bar = document.querySelector('.preview-scrub')
    const track = bar?.querySelector('.preview-scrub-track')
    if (!bar || !track) return
    const rect = track.getBoundingClientRect()
    // 全体の長さは分からないので、割合で押す。0秒なら 2% 入った所
    const at = rect.left + rect.width * (sec > 0 ? 0.25 : 0.02)
    bar.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: at,
        clientY: rect.top + rect.height / 2
      })
    )
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  }, sec)
  await page.waitForTimeout(1500)
}

const results = []
for (const res of RES_LIST) {
  console.log(`\n── 画質 ${res}p ──`)
  await page.locator('.pq-preview').first().selectOption(res)
  await page.waitForTimeout(1000)
  if (process.argv.includes('--fresh')) {
    // 待たずに測る＝変換の裏で再生する（いちばん条件が悪い）
    const busy = (await page.locator('.proxy-badge').count()) > 0
    console.log(`  ${busy ? '**焼き直しの最中**に測ります' : '焼き直しは走っていません'}`)
  } else if (!(await waitQuiet())) {
    console.log('  ※焼き直しが終わりませんでした（そのまま測ります）')
  }
  await seekTo(AT)
  // 計測の小窓を出しておく（「絵の遅れ」をここから読む）
  if (!(await page.locator('.perf-hud').count())) {
    await page.keyboard.press('Control+Shift+P')
    await page.waitForTimeout(1200)
  }
  const r = await scan(SEC * 1000)
  if (!r) {
    console.log('  プレビューに映像がありません')
    continue
  }
  results.push({ res, ...r })
  if (process.argv.includes('--trace')) {
    for (const x of r.trace) {
      console.log(
        `  ${String(x.ms).padStart(5)}ms  音${x.vol}(面${x.snd})  ` +
          x.v
            .map((v, i) => `[${i}] ${v.ct.toFixed(3)} ${v.p ? '停止' : '再生'}${v.sk ? '/頭出し' : ''} 準備${v.rs}`)
            .join('   ')
      )
    }
  }
  console.log(
    `  再生しているもの: ${r.proxy ? '焼き直した映像' : '**原本**（まだ焼けていない）'}\n` +
      `  流れる速さ: ${r.speed.toFixed(2)}倍（1.00 が等倍。低いとデコードが追いつけていない）\n` +
      `  絵の止まり: 一番長い ${r.worstMs}ms / 合計 ${r.frozenMs}/${r.ranMs}ms` +
      (r.stops.length
        ? `\n    止まった所: ${r.stops.map((s) => `${(s.at / 1000).toFixed(1)}秒に${s.ms}ms`).join(' / ')}`
        : '') +
      '\n' +
      `  頭出し: ${r.seekN}回 / 中央 ${r.seekMid}ms / 最大 ${r.seekMax}ms\n` +
      `  絵の遅れ: 最大 ${r.lagMax}ms（大きいと**文字だけ先に動いて見える**）\n` +
      `  音量の跳ね上がり: ${
        r.jumps.length
          ? r.jumps
              .map(
                (j) =>
                  `${(j.at / 1000).toFixed(1)}秒に ${j.from}→${j.to}${j.swap ? '（面の入れ替えと同時＝引き継ぎ漏れ）' : ''}`
              )
              .join(' / ')
          : 'なし（※50msごとの標本なので、短い飛び出しは写らない）'
      }\n` +
      `  音: ${
        r.audio
          ? `抜け ${r.audio.gaps.length}回${
              r.audio.gaps.length
                ? `（${r.audio.gaps.map((g) => `${(g.at / 1000).toFixed(1)}秒に${g.ms}ms`).join(' / ')}）`
                : ''
            } / 段差（プツッ）${r.audio.clicks.length}回${
              r.audio.clicks.length
                ? `（${r.audio.clicks
                    .slice(0, 10)
                    .map((c) => `${(c.at / 1000).toFixed(1)}秒`)
                    .join(' ')}）`
                : ''
            }`
          : '測れませんでした（音が鳴っていないか、経路に繋げませんでした）'
      }\n` +
      `  落としたコマ: ${r.dropped}\n` +
      `  主スレッドを塞いだ処理: ${r.blockCount}回・最長 ${r.blockWorst}ms（音がプチプチいう原因）`
  )
}

console.log('\n===== まとめ =====')
for (const r of results) {
  // **音の抜けも不合格にする。** 絵が滑らかでも音が途切れれば使い物にならない
  const audioBad = (r.audio?.gaps.length ?? 0) > 0
  const verdict = !r.played
    ? '？ 流れていない'
    : r.worstMs > 100
      ? '× 引っかかる'
      : audioBad
        ? '× 音が抜ける'
        : r.frozenMs > r.ranMs * 0.2
          ? '△ ときどき止まる'
          : '○ 滑らか'
  console.log(
    `${verdict}  ${r.res}p  速さ ${r.speed.toFixed(2)}倍 / 止まり最長 ${String(r.worstMs).padStart(4)}ms / ` +
      `合計 ${String(r.frozenMs).padStart(4)}/${r.ranMs}ms / ` +
      `頭出し ${r.seekN}回 最大 ${r.seekMax}ms / ` +
      `${r.proxy ? '焼直' : '原本'} / 主スレッド最長 ${r.blockWorst}ms`
  )
}
const bad = results.filter(
  (r) => r.played && (r.worstMs > 100 || (r.audio?.gaps.length ?? 0) > 0)
)
console.log(
  bad.length
    ? `\nだめだった画質: ${bad.map((r) => r.res + 'p').join(', ')}`
    : '\nどの画質も、絵は止まらず音も抜けませんでした'
)

await app.close().catch(() => {})
rmSync(tmp, { recursive: true, force: true })
process.exit(bad.length ? 1 : 0)
