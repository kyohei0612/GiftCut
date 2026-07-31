// 画面を撮って測る／書き出した音を測る／画面の記録
//
// 章: 目で見る確認（画面を撮って中身を測る） / 耳で聴く確認（書き出した音を測る） / 画面の記録
//
// **通しの本体は e2e/run.mjs から分けてある。** 1ファイル7,400行だと、
// 直したい章を探すのに毎回全部を読むことになり、足す場所も決まらないので
// 「仕上げ」に流れ込んでいた。道具（check・assert・素材づくり）は
// run.mjs 側に置いたままで、まとめて受け取る。

import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export default async function (C) {
  const {
    ONLY,
    ROOT,
    SHOT_ONLY,
    assert,
    avgColor,
    avgColorAt,
    check,
    clipLayout,
    clipW,
    dragBy,
    fx,
    loudness,
    meanVolume,
    outDir,
    page,
    resetProject,
    section,
    seekTo,
    setDialogFiles,
    shot,
    shotDir,
    silences,
    similarity,
    v1Clips,
  } = C
  section('目で見る確認（画面を撮って中身を測る）')
  await resetProject()

  // ---- 数値欄を「押して振る」まわり ---------------------------------------
  //
  // ここは**画面を撮って確かめる**。数字が変わったことだけ見ても、
  // 実際にプレビューの見た目が変わったかは分からない
  // （値だけ動いて絵が付いてこない、という壊れ方が一番たちが悪い）。

  /** 数値欄を押して、横に振る。ScrubNumber の操作 */
  const scrubField = async (input, dx) => {
    const b = await input.boundingBox()
    assert(b, '数値欄が画面に無い')
    const y = b.y + b.height / 2
    await page.mouse.move(b.x + b.width / 2, y)
    await page.mouse.down()
    // 4px 動かすまではクリック扱いなので、必ず何回かに分けて動かす
    for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.width / 2 + (dx * i) / 8, y)
    await page.mouse.up()
    await page.waitForTimeout(300)
  }
  /** モーションタブの行（ラベルで探す） */
  const moRow = (label) => page.locator('.mo-row', { hasText: label }).first()
  /** テロップを選んでモーションタブを開く */
  const openMotion = async () => {
    await page.locator('.telop-clip').first().click()
    await page.waitForTimeout(300)
    await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
    await page.waitForTimeout(400)
  }

  await check('数値欄は押して振ると変わり、プレビューの見た目も動く', async () => {
    await resetProject()
    await seekTo(1)
    // **文字が画面に出ている時刻でないと始まらない。** 素材任せにせず、ここで作る
    await page.keyboard.press('t')
    await page.waitForTimeout(500)
    await openMotion()
    // **文字のいる所だけを撮る。** 画面全体で平均を取ると、文字は面積が小さいので
    // 動いても数字がほとんど変わらない（実際それで見逃しかけた）
    // 文字の**真ん中の小さな範囲**を見る。広く撮ると、文字は面積が小さいので
    // 平均がほとんど動かない（プレビューは縮小表示なので、1080基準で40px 動いても
    // 画面上は十数pxしかない）。退いたかどうかは、狭く撮るほどはっきり出る
    const b0 = await page.locator('.telop-box').first().boundingBox()
    assert(b0, 'プレビューに文字が無い')
    const clip = {
      x: Math.round(b0.x + b0.width / 2 - 14),
      y: Math.round(b0.y + b0.height / 2 - 10),
      width: 28,
      height: 20
    }
    const before = join(shotDir, 'scrub-before.png')
    const after = join(shotDir, 'scrub-after.png')
    await page.screenshot({ path: before, clip })

    const field = moRow('位置 Y').locator('input').first()
    const v0 = Number(await field.inputValue())
    await scrubField(field, 600) // 大きく動かす（少しだと画面上では数pxで、見分けが付かない）
    const v1 = Number(await field.inputValue())
    // ※向きは見ない。押し込むと画面が固定される（ポインタロック）ので、
    //   自動操作では振る向きが安定しない。ここで見たいのは「振れば変わる」こと
    assert(v1 !== v0, `押して振っても値が変わらない（${v0} → ${v1}）`)

    // 同じ場所をもう一度撮る。文字が退いていれば、そこは平坦になる
    await page.screenshot({ path: after, clip })
    const a = await avgColor(before)
    const b = await avgColor(after)
    const moved =
      Math.abs((a.y ?? 0) - (b.y ?? 0)) > 3 || Math.abs((a.range ?? 0) - (b.range ?? 0)) > 10
    assert(moved, `値は変わったのに、プレビューの絵が変わっていない（${v0} → ${v1}）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('「横だけ拡大」も、印を打たずに触れる', async () => {
    // 元の値を持たない行は ⏱ を押すまで触れなかった。
    // 値を見ながら決めたいのに、先に印を打たせるのは順番が逆
    await openMotion()
    // 「詳細設定」は畳まずに出ている（見出しを押すと選択になるので、押さない）
    const more = page.locator('.mo-sec', { hasText: '詳細設定' }).first()
    assert(await more.count(), '「詳細設定」の見出しが無い')
    const field = moRow('横だけ拡大').locator('input').first()
    assert(await field.count(), '「横だけ拡大」の行が無い')
    assert(!(await field.isDisabled()), '「横だけ拡大」が触れないままになっている')
    const v0 = Number(await field.inputValue())
    await scrubField(field, 90)
    const v1 = Number(await field.inputValue())
    assert(v1 !== v0, `押して振っても値が変わらない（${v0} → ${v1}）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('文字を2つ選んで拡大すると、両方が大きくなる（元の差は保つ）', async () => {
    await resetProject()
    await seekTo(1)
    // 同じ時刻に2つ作る（素材任せにしない）
    await page.keyboard.press('t')
    await page.waitForTimeout(400)
    await page.keyboard.press('t')
    await page.waitForTimeout(500)
    const sizes = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.telop-box')].slice(0, 2).map((el) => {
          const r = el.getBoundingClientRect()
          return { w: Math.round(r.width), h: Math.round(r.height) }
        })
      )
    const before = await sizes()
    assert(before.length >= 2, `文字を2つ作れなかった（${before.length}個）`)

    const clips = page.locator('.telop-clip')
    await clips.nth(0).click()
    await clips.nth(1).click({ modifiers: ['Control'] })
    await page.waitForTimeout(300)
    await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
    await page.waitForTimeout(400)

    const screen = page.locator('.screen').first()
    const sb = await screen.boundingBox()
    const clip = {
      x: Math.round(sb.x),
      y: Math.round(sb.y),
      width: Math.round(sb.width),
      height: Math.round(sb.height)
    }
    await page.screenshot({ path: join(shotDir, 'group-scale-before.png'), clip })

    // **打ち込みで確かめる。** 押して振る動きは画面が固定される（ポインタロック）ため
    // 自動操作では向きが安定しない。まとめて効くかを見るのが目的で、
    // 打ち込みも振るのも通る道筋は同じ（どちらも onValue）
    const field = moRow('拡大').locator('input').first()
    await field.fill('160')
    await field.press('Enter')
    await page.waitForTimeout(500)
    const after = await sizes()
    await page.screenshot({ path: join(shotDir, 'group-scale-after.png'), clip })

    assert(after[0].w > before[0].w + 2, `掴んだ方が大きくなっていない（${before[0].w} → ${after[0].w}）`)
    assert(
      after[1].w > before[1].w + 2,
      `選んである他の文字が大きくなっていない（${before[1].w} → ${after[1].w}）`
    )
    // 倍率がそろっている＝元の大小関係が崩れていない
    const r0 = after[0].w / before[0].w
    const r1 = after[1].w / before[1].w
    assert(
      Math.abs(r0 - r1) < 0.15,
      `一緒に大きくはなったが、倍率が違う（${r0.toFixed(2)} と ${r1.toFixed(2)}）`
    )
  })

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

  // ---- カクつきを数で見る -------------------------------------------------
  //
  // **記録の「落としたコマ」では分からない。** 再生ヘッドは壁時計で進むので、
  // 動画が止まっていてもコマ落ちは 0 と出る（実際それで見逃していた）。
  //
  // 見るべきは**絵そのもの**。流しながら一定の間隔で撮り、
  // 「前のコマと変わっていない」＝止まっていた、として数える。
  /**
   * 流して、**動画の時刻が進んでいるか**を刻んで測る。
   *
   * 絵が止まっている＝動画の currentTime が進まない、なので、そのまま数で出る。
   * 連写して見比べるより軽く、止まった長さがミリ秒で分かる。
   *
   * 面は2枚ある（カットの先読み用に裏で温める作り）ので、
   * **どれか1枚でも進んでいれば動いている**とみなす。
   *
   * @returns { worstMs, frozenMs, ranMs, dropped } worstMs＝一番長く止まっていた時間
   */
  /**
   * 裏の変換（プレビューの焼き直し）が終わるまで待つ。
   *
   * **待たずに測ると、変換に食われた分をカクつきとして数えてしまう。**
   * 実際、並びで回すたびに落ちる項目が入れ替わり、それがこれだった。
   * 使う人も「最適化中…」が消えるまで待つので、待つのが本当の条件に近い。
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
        const t0 = performance.now()
        let prev = vids.map((v) => v.currentTime)
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

  await check('マウスの印が、目盛りの数字の上に切れずに出る', async () => {
    // 再生ヘッドと見分けが付く形にしてある（全高の縦線は再生ヘッドだけ）。
    // 印は目盛りの中に収め、頭を数字の上に乗せる。
    //
    // ※「目盛りより上に何px 出ているか」で見てはいけない。目盛りは
    // スクロール領域の一番上に貼り付いているので、上へ出した分は切り落とされる。
    // 実際、位置の計算は 3px 突き出しているのに目では何も見えていなかった。
    // **切られていないこと**（＝領域の内側にあること）で見る。
    await resetProject()
    const box = await page.locator('.track-inner').boundingBox()
    await page.mouse.move(Math.round(box.x + 220), Math.round(box.y + 12)) // 目盛りの上
    await page.waitForTimeout(300)
    const m = await page.evaluate(() => {
      const mk = document.querySelector('.hover-mark')
      const rl = document.querySelector('.ruler')
      const sc = document.querySelector('.track-scroll')
      const tm = document.querySelector('.hover-time')
      if (!mk || !rl || !sc) return null
      const a = mk.getBoundingClientRect()
      const b = rl.getBoundingClientRect()
      const s = sc.getBoundingClientRect()
      const head = getComputedStyle(mk, '::before')
      const own = getComputedStyle(mk)
      return {
        markTop: Math.round(a.top),
        markLeft: Math.round(a.left),
        markW: Math.round(a.width),
        markH: Math.round(a.height),
        rulerTop: Math.round(b.top),
        rulerH: Math.round(b.height),
        cut: Math.round(s.top - a.top), // 0より大きい＝切り落とされている
        inRuler: a.top >= b.top - 1 && a.top < b.bottom, // 目盛りの中に居る
        headH: parseFloat(head.height) || 0,
        headW: parseFloat(head.width) || 0,
        headBg: head.backgroundColor,
        headContent: head.content,
        vis: `${own.display}/${own.visibility}/${own.opacity}`,
        time: tm ? tm.textContent.trim() : null
      }
    })
    assert(m, 'マウスの印が出ていない')
    assert(m.cut <= 0, `印の頭が枠の外にはみ出して切れている（${m.cut}px ぶん）`)
    assert(m.inRuler, `印が目盛りの中に居ない（印 ${m.markTop} / 目盛り ${m.rulerTop}）`)
    assert(m.headH >= 3, `印の頭が出ていない（高さ ${m.headH}px）＝線だけで目盛りに紛れる`)
    assert(m.time, '印に時刻が出ていない')
    // ここまでは「計算上そうなっている」の確認。**本当に描かれているか**は画素で見る。
    //
    // 撮るのは画面まるごと（clip を渡さない）。clip を渡すと表示範囲がいじられ、
    // その拍子にマウスが枠から出た扱いになって印が消える。
    // 切り取りは撮った後に ffmpeg でやる。
    const shot = join(shotDir, 'hover-mark.png')
    await page.screenshot({ path: shot })
    const still = await page.evaluate(() => !!document.querySelector('.hover-mark'))
    assert(still, '撮っている途中で印が消えた（撮り方の問題。clip を渡していないか確認）')
    const head = await avgColorAt(shot, m.markLeft - 6, m.rulerTop, 13, 5)
    const bg = await avgColorAt(shot, m.markLeft - 46, m.rulerTop, 13, 5)
    assert(head.y != null && bg.y != null, '画素を測れなかった（ffmpeg が見つからない可能性）')
    assert(
      head.y > bg.y + 40,
      `印の頭が描かれていない（頭の明るさ ${Math.round(head.y)} / 何も無い所 ${Math.round(bg.y)}）`
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
  // **前に焼いた物を測らない。**
  // 使い回す作りなので、別の状態（例: 頭に空きを入れる項目）で焼かれた物が
  // 残っていると、まっさらにした後でもそれを測ってしまう。
  // 実際に「素材には無い無音が 0.0〜2.0秒にある」と赤くなり、
  // **本物の不具合と見分けが付かなかった**。焼き直しは1本ぶんで済む。
  rmSync(join(outDir, 'audio-check.mp4'), { force: true })

  // 音の確認は同じ書き出しを使い回す（1本焼くのに時間がかかるため）。
  // ただし**絞って回したときに、焼いていないのに測ろうとする**ことがあるので、
  // 無ければその場で焼く。前の項目の結果に寄りかからせない。
  const exportForAudioCheck = async (out) => {
    if (existsSync(out)) return
    await setDialogFiles(null, out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
    await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
    await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 240000 })
  }

  await check('書き出した動画に、途中で音が途切れる所が無い', async () => {
    const out = join(outDir, 'audio-check.mp4')
    await exportForAudioCheck(out)
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
    await exportForAudioCheck(out)
    const lufs = await loudness(out)
    assert(lufs !== null, 'ラウドネスを測れなかった')
    // 画面の設定は -14 LUFS。実測がそこから大きく外れていたら揃っていない。
    assert(Math.abs(lufs + 14) < 3, `狙いの -14 LUFS から離れている（実測 ${lufs} LUFS）`)
  })

  // =========================================================================
  section('画面の記録')

  // 画面の記録は「通しで回したとき」と「撮るだけのとき」だけ。
  // 絞って回すたびに同じ画面を撮っても、前のものと変わらず意味が無い。
  if (!ONLY.length || SHOT_ONLY) {
    await check(
      '最後の画面をスクリーンショットに残す',
      async () => {
        await page.screenshot({ path: join(ROOT, 'e2e', 'last-run.png') })
        if (SHOT_ONLY) console.log('  → e2e/last-run.png に撮りました')
      },
      { setup: true }
    )
  }
}
