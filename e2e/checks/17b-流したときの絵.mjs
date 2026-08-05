// 流したときに**絵が止まらない**か（画質ごと・カット多め・文字多め・つなぎ目）。
//
// `17-目と耳の確認.mjs` から出した（決まり: 600超は500以下に割る）。
// 章は名乗らない——17a の続きとして呼ばれる。入口は ./17-目と耳の確認.mjs
//
// ## 数え始める位置に気をつけること
//
// `Space` を押しても `play()` は非同期で、最初の絵が出るまでに数百ms かかる。
// その間を数えると **合計＝最長＝250ms が3秒に1回だけ**という形の赤が間欠的に出る。
// **しきい値は緩めない。** 絵が1コマ進むまで待ってから数え始める（下の stutterScan）。

import { join } from 'node:path'

export default async function (C) {
  const {
    ONLY, SHOT_ONLY, assert, avgColor, check, page, resetProject, seekTo, shotDir, v1Clips
  } = C

  // ---- カクつきを数で見る -------------------------------------------------
  //
  // **記録の「落としたコマ」では分からない。** 再生ヘッドは壁時計で進むので、
  // 動画が止まっていてもコマ落ちは 0 と出る（実際それで見逃していた）。
  //
  // 見るべきは**絵そのもの**。流しながら一定の間隔で撮り、
  // 「前のコマと変わっていない」＝止まっていた、として数える。
  /**
   * 裏の変換（プレビューの焼き直し）が終わるまで待つ。
   *
   * **待たずに測ると、変換に食われた分をカクつきとして数えてしまう。**
   * 実際、並びで回すたびに落ちる項目が入れ替わり、それがこれだった。
   * 使う人も「最適化中…」が消えるまで待つので、待つのが本当の条件に近い。
   *
   * ※ もとは 17a（目で見る）の末尾にあった。**使うのはここだけ**なので、
   *   割ったときに一緒に連れてきた（境目をまたぐ名前を1つ減らす）。
   */
  const waitQuiet = async (ms = 90000) => {
    for (let i = 0; i < ms / 500; i++) {
      if ((await page.locator('.proxy-badge').count()) === 0) {
        await page.waitForTimeout(600) // 終わった直後は後片付けが残っている
        return true
      }
      await page.waitForTimeout(500)
    }
    return false
  }
  const stutterScan = async (label, ms = 3000, everyMs = 50) => {
    await waitQuiet()
    await page.keyboard.press('Space') // 再生
    const r = await page.evaluate(
      async ({ ms, everyMs }) => {
        const vids = [...document.querySelectorAll('.screen-video')]
        if (!vids.length) return null
        const rows = []
        // **音がぶつ切りになる直接の原因**＝主スレッドを長く塞ぐ処理。
        // 音は途切れた瞬間しか分からず、あとから確かめようがないので、
        // 原因のほうを数で押さえる（50ms 以上塞ぐと、その間の音は作れない）
        const longs = []
        let obs = null
        try {
          obs = new PerformanceObserver((list) => {
            for (const e of list.getEntries()) longs.push(Math.round(e.duration))
          })
          obs.observe({ entryTypes: ['longtask'] })
        } catch {
          /* 使えない環境では絵の止まりだけで見る */
        }
        let prev = vids.map((v) => v.currentTime)
        // **立ち上がりは測らない。**
        //
        // `Space` を押しても `play()` は非同期で、最初の絵が出るまでに数百ms かかる。
        // その間を数えると **合計＝最長＝250ms（5サンプル連続）が3秒に1回だけ**という
        // 形の赤が間欠的に出る。2026-08-03 に4回測って、同じコードで赤2回・緑2回だった
        //（しかも主スレッド最長 0ms＝JS は詰まっていない＝本物の止まりではない）。
        //
        // **しきい値は緩めない。** 100ms は「1コマ落ちても気づかない」の線で、
        // 緩めると本物の止まりを見逃す。数え始める位置の方を直す。
        const waitFrom = performance.now()
        let started = false
        while (performance.now() - waitFrom < 3000) {
          await new Promise((res) => setTimeout(res, 20))
          const now = vids.map((v) => v.currentTime)
          if (now.some((t, i) => t - prev[i] > 0.005)) {
            started = true
            prev = now
            break
          }
          prev = now
        }
        // **成立しなければ落とす。** 始まらないまま数えると「3秒ずっと止まっている」と出て、
        // アプリの不具合の顔をする
        if (!started) return { notStarted: true, waitedMs: Math.round(performance.now() - waitFrom) }
        const t0 = performance.now()
        while (performance.now() - t0 < ms) {
          await new Promise((res) => setTimeout(res, everyMs))
          const now = vids.map((v) => v.currentTime)
          // どれか1枚でも進んだか
          const moved = now.some((t, i) => t - prev[i] > 0.005)
          // 止まっているとき**何が起きているか**も採る。
          // 「止まった」だけでは、絵が来ていないのか・止められているのかが分からない
          rows.push({
            at: Math.round(performance.now() - t0),
            moved,
            ct: now.map((t) => Math.round(t * 1000) / 1000),
            paused: vids.map((v) => v.paused),
            seeking: vids.map((v) => v.seeking),
            ready: vids.map((v) => v.readyState)
          })
          prev = now
        }
        obs?.disconnect()
        const q = vids[0].getVideoPlaybackQuality?.()
        return { rows, dropped: q?.droppedVideoFrames ?? 0, longs }
      },
      { ms, everyMs }
    )
    await page.keyboard.press('Space') // 停止
    await page.waitForTimeout(300)
    assert(r, 'プレビューに映像が無い')
    assert(
      !r.notStarted,
      `再生が始まらなかった（${r.waitedMs}ms 待っても絵が1コマも進まない）。測れていない`
    )
    let run = 0
    let worst = 0
    let frozen = 0
    for (const x of r.rows) {
      if (x.moved) run = 0
      else {
        run++
        frozen++
        if (run > worst) worst = run
      }
    }
    // 止まっていた間の状態をまとめる（原因の切り分け用）
    const stuck = r.rows.filter((x) => !x.moved)
    const why = {
      止められている: stuck.filter((x) => x.paused.every(Boolean)).length,
      シーク中: stuck.filter((x) => x.seeking.some(Boolean)).length,
      絵がまだ来ない: stuck.filter((x) => x.ready.every((v) => v < 3)).length
    }
    const longs = r.longs ?? []
    return {
      worstMs: worst * everyMs,
      frozenMs: frozen * everyMs,
      ranMs: r.rows.length * everyMs,
      dropped: r.dropped,
      why,
      // 音まわり: 主スレッドを塞いだ回数と、一番長かった1回
      blockCount: longs.length,
      blockMs: longs.reduce((a, b) => a + b, 0),
      blockWorst: longs.length ? Math.max(...longs) : 0,
      // 止まり方そのもの（原因を追うとき用）。先頭だけ
      trace: r.rows.slice(0, 24).map((x) => `${x.at}:${x.ct.join('/')}${x.moved ? '' : '*'}`),
      label
    }
  }

  /** 画質を選んで、焼き直しが終わるまで待つ */
  const useRes = async (res) => {
    const vid = page.locator('.screen-video').first()
    const srcOf = () => vid.evaluate((el) => el.getAttribute('src') ?? '')
    const prev = await srcOf()
    await page.locator('.pq-preview').first().selectOption(String(res))
    for (let i = 0; i < 90; i++) {
      await page.waitForTimeout(500)
      const s = await srcOf()
      if (s !== prev && s.includes('giftcut-proxies')) return
    }
    // 作れていなくても確認は続ける（そのぶん結果に出る）
  }

  for (const res of [1080, 720, 360]) {
    await check(`${res}p で流して、絵が止まらない`, async () => {
      await resetProject()
      await useRes(res)
      await seekTo(1)
      const r = await stutterScan(`${res}p`)
      console.log(
        `      \x1b[90m${res}p: 一番長い止まり ${r.worstMs}ms / 止まり合計 ${r.frozenMs}ms / ` +
          `測った ${r.ranMs}ms / 落としたコマ ${r.dropped} / ` +
          `主スレッドを塞いだ ${r.blockCount}回・計${r.blockMs}ms・最長${r.blockWorst}ms\x1b[0m`
      )
      // 100ms 止まると、目に見えて引っかかる（実測でカット時のシークが
      // 110〜235ms のとき「カクつく」と言われた）
      assert(r.worstMs <= 100, `${res}p で ${r.worstMs}ms 絵が止まった`)
      // ずっと小刻みに止まっているのも引っかかって見える
      assert(
        r.frozenMs <= r.ranMs * 0.3,
        `${res}p で止まっている時間が長い（${r.frozenMs}/${r.ranMs}ms）`
      )
      // **音がぶつ切りになる条件**。主スレッドを長く塞ぐと、その間の音は作れない
      assert(
        r.blockWorst <= 120,
        `${res}p で音が途切れる（主スレッドを ${r.blockWorst}ms 塞いだ）`
      )
      assert(
        r.blockMs <= r.ranMs * 0.2,
        `${res}p で音が途切れがちになる（塞いだ合計 ${r.blockMs}/${r.ranMs}ms）`
      )
    })
  }

  await check('カットを増やしても、流したときに絵が止まらない', async () => {
    // カットのたびに飛ぶので、ここが一番止まりやすい。
    // **全コマがキーフレームの映像で再生している**なら、飛んでも1コマぶんで済む
    await resetProject()
    await useRes(720)
    // 0.5秒おきに切る（実際の編集より細かい＝きつい条件）
    for (let i = 1; i <= 8; i++) {
      await seekTo(i * 0.5)
      await page.keyboard.press('Control+k')
      await page.waitForTimeout(150)
    }
    await seekTo(0.2)
    const r = await stutterScan('カット多め')
    assert(
      r.worstMs <= 100,
      `カットが多いと絵が止まる（一番長い止まり ${r.worstMs}ms / 合計 ${r.frozenMs}ms / 主スレッド最長 ${r.blockWorst}ms）`
    )
  })

  await check('文字を重ねても、流したときに絵が止まらない', async () => {
    // テロップは HTML を毎コマ描き直す。**重ねるほど描画側が重くなる**ので、
    // 動画の復号とは別の理由で止まりうる
    await resetProject()
    await useRes(720)
    for (let i = 0; i < 6; i++) {
      await seekTo(0.5 + i * 0.2)
      await page.keyboard.press('t')
      await page.waitForTimeout(250)
    }
    await seekTo(0.2)
    const r = await stutterScan('文字多め')
    console.log(
      `      \x1b[90m文字多め: 一番長い止まり ${r.worstMs}ms / 合計 ${r.frozenMs}/${r.ranMs}ms / ` +
        `内訳 ${JSON.stringify(r.why)}\x1b[0m`
    )
    console.log(`      \x1b[90m時刻の進み: ${r.trace.join(' ')}\x1b[0m`)
    assert(
      r.worstMs <= 100,
      `文字を重ねると絵が止まる（一番長い止まり ${r.worstMs}ms / 合計 ${r.frozenMs}ms / 主スレッド最長 ${r.blockWorst}ms）`
    )
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

}
