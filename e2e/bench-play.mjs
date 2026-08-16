// 負荷チェックの**「流して見る」2項目**。
//
// ## なぜ触る側（bench-ops）から出したか（2026-08-07）
//
// あちらが 719行になった（上限は 600）。話題も別で、あちらは**触ったときの
// もたつき**、こちらは**流している間に合っているか**を見る。
//
// **同じ「再生」でも見ている物が違う。**
//
//   再生してみる（3秒）  … コマ落ちを測る。合っているかは見ない
//   20秒流して、ずれを見る … 合っているかを見る。コマ落ちは見ない
//
// ## 中身
//
// - `runPlayChecks` … 2項目を順に測る
// - `長く流してずれを見る` … 20秒ぶん、1秒ごとに突き合わせる（下に長い説明）
export async function runPlayChecks(ctx) {
  const { measure, page, fmt, MINUTES, seekTo0, headX, shot, say, done } = ctx

  await measure(
    '再生してみる（3秒）',
    async () => {
      // **自分で見え方を決める（全体表示）。**
      //
      // 再生の重さは「同時に何本の帯が見えているか」で決まる。前の項目が残した
      // 拡大率に任せると、**アプリを1行も変えていないのに 104.2ms → 25.1ms** になる
      //（2026-08-04、前の項目を寄せた状態で終わるよう直したとき実際にそうなった）。
      // ここは**いちばん重い側＝全部見えている状態**で測る。編集し終えて
      // 全体を見ながら流す、という実際によくやる形でもある。
      const fit = page.locator('.tl-zoom button').first()
      if (await fit.count()) await fit.click().catch(() => {})
      await page.waitForTimeout(500)
      await seekTo0()
      // **Space を押す前に、文字入力から手を離す。**
      // 直前の項目でテロップの文字を打ち直しているので、focus が入力欄に
      // 残っていると Space は**空白を打つだけ**で再生が始まらない。
      // 「再生が進んでいない」＝アプリの不具合、と読み違える所だった
      //（light でも同じように落ちていた。2026-08-04）。
      await page.evaluate(() => document.activeElement?.blur?.())
      await page.waitForTimeout(150)
      const x0 = await headX()
      await page.keyboard.press('Space')
      await page.waitForTimeout(3000)
      await page.keyboard.press('Space')
      await page.waitForTimeout(300)
      const moved = (await headX()) - x0
      // **「何px 動いたか」で判定しない。** 引いた状態だと 3秒＝1.2px にしかならず、
      // 5px のしきい値に届かない。**再生は動いているのに「進んでいない」と出て、
      // アプリの不具合に見えた**（2026-08-04。light でも同じように落ちていた）。
      // 動くはずの量（3秒 × 拡大率）に対する割合で見れば、拡大率に左右されない。
      const zoom = await page.evaluate(() => {
        const inner = document.querySelector('.track-inner')
        return inner ? parseFloat(inner.style.width || '0') : 0
      })
      const want = (zoom / Math.max(1, MINUTES * 60)) * 3 // 3秒ぶんの px
      if (!(want > 0)) throw new Error('拡大率が読めない（測れていない）')
      if (moved < want * 0.5)
        throw new Error(
          `再生が進んでいない（${fmt(moved)}px しか動かなかった。3秒なら ${fmt(want)}px のはず）`
        )
    },
    // わざと間違える: 再生を始めずに待つだけ
    async () => {
      await seekTo0()
      const x0 = await headX()
      await page.waitForTimeout(3000)
      if (Math.abs((await headX()) - x0) < 5) throw new Error('再生が進んでいない')
    }
  )

  await 長く流してずれを見る({ page, shot, say, done, fmt, seekTo0, MINUTES })
}


/**
 * **20秒流して、その間ずっと「ずれ」を見る**（2026-08-07・本人の指定）。
 *
 * ## なぜ3秒では足りないか
 *
 * すぐ上の `再生してみる（3秒）` はコマ落ちを測る物で、**合っているかは見ていない**。
 * ずれは**時間をかけて開く**——1秒あたり数ミリ秒の遅れは3秒では 10ms 程度でも、
 * 20秒なら 100ms（3コマ）になり、テロップの出入りが目に見えてずれる。
 *
 * ## 突き合わせるのは「同じ物差しの2つ」だけ
 *
 * 最初は3つ（映像・再生ヘッド・時刻表示）を直に比べて赤を出したが、**それは
 * 私の作りが間違っていた**。プレビューの `<video>.currentTime` は**素材側の時刻**で、
 * タイムラインの時刻とは `tToSource`（`state/useVideoSync`）で対応付けられている。
 * 直に引き算すると、切片の切り出し位置がそのまま「ずれ」として出る。
 *
 * だから**同じ物差しの物どうし**を比べる:
 *
 *   再生ヘッドの位置 ÷ 拡大率   ←→   左上の時刻表示（`.tc-cur`）   どちらもタイムラインの時刻
 *
 * 映像は**絶対値では比べない**。代わりに2つを見る:
 *
 *   進み方   実時間に対する進み（**全部そろって遅れている**を捕まえる）
 *   固まり   1度も進まない標本が続いていないか（**音だけ進んで絵が止まる**を捕まえる）
 *
 * ## 判定に使う数字
 *
 *   ずれ    再生ヘッドと時刻表示の差。**3コマ**を超えたら食い違い。
 *           1コマではない理由が2つある:
 *             ・**時刻表示はコマ単位に丸めてある**（`formatTimecode`）ので、
 *               連続値の再生ヘッドと比べれば最大1コマの差は必ず出る
 *             ・**2つは別々に描き直される。** 再生ヘッドは自分で心臓を見に行き
 *               （`components/timeline/Ruler` の `Playhead`）、時刻表示は
 *               `PreviewBars`。**わざとそうしてある**（時刻を上から配ると、
 *               再生のたびにタイムライン全体が描き直される）。
 *           実測の散らばりは 0.5／0.6／1.0／1.1／1.6コマ。**1.5 に引いたら
 *           1.6 が出て赤になった**——**丸めと描き直しの分は「ずれ」ではない。**
 *           3コマ（100ms）離れたら人にも見える、が本当の線
 *   遅れ    実時間に対する進み。**5%** を超えたら、流しながらの編集に使えない
 *   固まり  映像が進まない標本が**3つ続いたら**（＝3秒）赤
 *
 * 画面写真は 2秒おきに撮る（`e2e/bench-shots`）。数字が緑でも、
 * **絵が止まっている・真っ黒**は数字に出ないので、人が見る材料を残す。
 */
async function 長く流してずれを見る({ page, shot, say, done, fmt, seekTo0, MINUTES }) {
  const 名 = '20秒流して、ずれを見る'
  await say('動作', 名, '20秒流しながら、再生ヘッドと時刻表示のずれを見る')
  // 入口を自分で作る（前の項目が残した再生位置を持ち越さない）
  await page.evaluate(() => document.activeElement?.blur?.())
  await seekTo0()
  await page.waitForTimeout(300)

  /** `00:00:49:03` を秒へ。**読めなければ null**（黙って0にしない） */
  const 秒へ = (tc) => {
    const m = /^(\d+):(\d+):(\d+):(\d+)$/.exec(tc ?? '')
    if (!m) return null
    return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 30
  }

  const 読む = () =>
    page.evaluate(() => {
      const inner = document.querySelector('.track-inner')
      const head = document.querySelector('.playhead')
      const vid =
        [...document.querySelectorAll('video.screen-video')].find(
          (v) => v.readyState > 0 && !v.paused
        ) ?? document.querySelector('video.screen-video')
      return {
        幅: inner ? parseFloat(inner.style.width || '0') : 0,
        左: head ? parseFloat(head.style.left || '') : NaN,
        映像: vid ? vid.currentTime : null,
        tc: document.querySelector('.tc-cur')?.textContent?.trim() ?? '',
        // **裏で走っている仕事も控える**（2026-08-07）。
        // 画面写真を見て気づいた——**測っている最中もプレビューの
        // 最適化（プロキシ作り）が 66% → 86% と進んでいる**。
        // これは CPU を食うので、進み具合によって数字が変わる。
        // **数字だけ見て「その日は重かった」と読まないための手掛かり。**
        // 今日いちばん最初の通しで `再生してみる` が1回だけ落ちた件も、
        // これが早い段階（＝いちばん重い所）に当たった可能性がある。
        最適化: document.querySelector('.proxy-badge')?.textContent?.match(/(\d+)%/)?.[1] ?? null
      }
    })

  const 最初 = await 読む()
  if (!(最初.幅 > 0)) throw new Error('タイムラインの幅が読めない（測れていない）')

  await page.keyboard.press('Space')
  const 標本 = []
  const t0 = Date.now()
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000)
    標本.push({ 経過: (Date.now() - t0) / 1000, ...(await 読む()) })
    if (i % 2 === 1) await shot(`再生${String(i + 1).padStart(2, '0')}秒`)
  }
  await page.keyboard.press('Space')
  await page.waitForTimeout(300)

  // **成立していなければ落とす。** 読めない標本ばかりなら、ずれ以前の話
  const 有効 = 標本.filter((s) => Number.isFinite(s.左) && s.映像 != null && 秒へ(s.tc) != null)
  if (有効.length < 15)
    throw new Error(
      `測れた標本が ${有効.length}/20 しかない（再生ヘッド・映像・時刻表示のどれかが読めない）`
    )

  const fps = 30
  // **1秒あたりの px は、標本そのものから出す**（2026-08-07）。
  //
  // 最初は `幅 ÷ (分×60)` で出したが、アプリの尺は**そこちょうどではない**
  //（テロップの終わり+3秒／最低60秒。`state/useTimelineSpan`）。3,600 と 3,603 の
  // 違いは、47.8秒の地点で **40ms** の誤差になり、観測した 50.7ms とほぼ一致した
  // ——**アプリではなく、私の物差しがずれていた。**
  //
  // 尺を当てにせず、**再生ヘッドが1秒でどれだけ動いたか**を標本から測れば、
  // 尺が何秒でも関係なくなる。ここで見たいのは「2つが一緒に動くか」だけ。
  const 端A = 有効[0]
  const 端B = 有効[有効.length - 1]
  const 秒差 = 秒へ(端B.tc) - 秒へ(端A.tc)
  if (!(秒差 > 1)) throw new Error(`再生が進んでいないので傾きが出せない（${fmt(秒差)}秒）`)
  const pxPerSec = (端B.左 - 端A.左) / 秒差
  // **桁違いなら落とす。** 幅から出した見込みと大きく離れたら、どちらかが壊れている
  const 見込み = 最初.幅 / Math.max(1, MINUTES * 60)
  if (!(pxPerSec > 0) || Math.abs(pxPerSec - 見込み) > 見込み * 0.1)
    throw new Error(
      `拡大率が出せない（標本から ${fmt(pxPerSec)} / 幅から ${fmt(見込み)} px/秒）`
    )
  // ① 再生ヘッド と 時刻表示（**同じ物差し**）
  let 最大ずれ = 0
  let 最悪 = null
  for (const s of 有効) {
    const 帯秒 = s.左 / pxPerSec
    const ずれ = Math.abs(帯秒 - 秒へ(s.tc))
    if (ずれ > 最大ずれ) {
      最大ずれ = ずれ
      最悪 = { ...s, 帯秒, 表示秒: 秒へ(s.tc) }
    }
  }
  // ② 進み方（全部そろって遅れていないか）
  //
  // **測るのは「読めた標本の端から端まで」**（端A→端B）。時刻も経過時間も
  // 同じ区間で取る。片方を再生前の1枚（`最初`）から取ると、その1枚が
  // **読めなかったときに黙って0になる**（2026-08-17 まで `?? 0` と書いてあり、
  // 127行の「**読めなければ null**（黙って0にしない）」と正面から矛盾していた
  // ——進んだ量が絶対時刻に化け、遅れ率が負＝実時間より速い、で素通りする）。
  //
  // ついでに起点のズレも消える。`最初` は Space を押す前＝経過0の手前だが、
  // 端A は押した約1秒後なので、**時刻は端Aから・経過は0から**取ると
  // 1秒ぶん（20秒中5%）を遅れとして数えてしまう。
  const 掛かった = 端B.経過 - 端A.経過
  if (!(掛かった > 1)) throw new Error(`測れた区間が短すぎる（${fmt(掛かった)}秒）`)
  const 遅れ率 = 1 - 秒差 / 掛かった
  // ③ 絵が固まっていないか（音だけ進んで絵が止まる）
  let 止まり = 0
  let 最長止まり = 0
  for (let i = 1; i < 有効.length; i++) {
    if (Math.abs(有効[i].映像 - 有効[i - 1].映像) < 0.05) 止まり++
    else 止まり = 0
    if (止まり > 最長止まり) 最長止まり = 止まり
  }

  const 行 =
    `ずれ 最大 ${fmt(最大ずれ * 1000)}ms＝${fmt(最大ずれ * fps)}コマ（丸めで1コマまでは出る） / ` +
    `${fmt(掛かった)}秒で ${fmt(秒差)}秒 進んだ（遅れ ${fmt(遅れ率 * 100)}%） / ` +
    `絵の固まり 最長 ${最長止まり}秒 / 時刻表示 ${端B.tc} / 標本 ${有効.length}` +
    (端A.最適化 != null || 端B.最適化 != null
      ? ` / **裏でプレビュー最適化中** ${端A.最適化 ?? '?'}% → ${端B.最適化 ?? '?'}%`
      : '')

  if (秒差 < 1) return done('動作', 名, `**再生が進んでいない**（${fmt(秒差)}秒）。${行}`, 'ng')
  if (最長止まり >= 3)
    return done('動作', 名, `**絵が ${最長止まり}秒 止まっている**（音だけ進んでいる）。${行}`, 'ng')
  if (最大ずれ > 3 / fps)
    return done(
      '動作',
      名,
      `**再生ヘッドと時刻表示が食い違う**（最悪 ${fmt(最大ずれ * 1000)}ms＝` +
        `${fmt(最大ずれ * fps)}コマ。${fmt(最悪.経過)}秒の所で 帯 ${fmt(最悪.帯秒)}秒 / ` +
        `表示 ${fmt(最悪.表示秒)}秒）。${行}`,
      'ng'
    )
  if (遅れ率 > 0.05) return done('動作', 名, `**再生が実時間より遅れている**。${行}`, 'warn')
  return done('動作', 名, 行, 'ok')
}
