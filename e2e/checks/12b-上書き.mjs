// テロップの**上書き**（重ねたら、置いた方が勝つ）。
//
// ## なぜ出したか（2026-08-05）
//
// `12-プレビュー.mjs` が 721行あった（決まり: 600超は500以下に割る）。
// 上書きの4件は互いに続き物なので、まとめて1本にした。
//
// ## 順番の話
//
// **`12-プレビュー.mjs` の途中から呼ばれる。** 章の宣言はしない——
// 手前（12a）が宣言した章の続きとして並ぶ。**単独で呼ばない。**

export default async function (C) {
  const { assert, check, clipW, dragBy, page, resetProject, seekTo, touchedRef, v1Clips } = C
  await check('テロップを重ねて置くと、重なった分が消える（上書き）', async () => {
    // **動画クリップは元から上書きされるのに、テロップだけ重なったまま残っていた。**
    // 画面では前後に重なって見えるだけで、どちらが出ているのか分からない。
    //
    // 判定そのものは shared/overwrite の試験で見ているので、ここは
    // 「掴んで落としたときに、本当にその道を通るか」だけを見る。
    await resetProject()
    const bands = () => page.locator('.telop-clip')
    assert((await bands().count()) >= 2, 'テロップが2つ以上ないと重ねられない')
    const box = async (i) => await bands().nth(i).boundingBox()
    const a = await box(0)
    const b = await box(1)
    const wBefore = b.width
    assert(wBefore > 20, `2つ目が細すぎて確かめられない（${wBefore}px）`)

    // 1つ目を右へ運んで、2つ目の頭へ食い込ませる（2つ目の幅の3割ほど）
    const bite = Math.round(b.width * 0.3)
    const toX = b.x + bite - a.width / 2
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(toX, a.y + a.height / 2, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(600)

    // 2つ目は、食い込まれた分だけ頭が削れて短くなっているはず
    const after = await page.locator('.telop-clip').nth(1).boundingBox()
    assert(after, '2つ目のテロップが消えてしまった（削りすぎ）')
    assert(
      after.width < wBefore - 4,
      `重ねても2つ目が短くなっていない（${Math.round(wBefore)} → ${Math.round(after.width)}px）`
    )
    touchedRef.dirty = true
    await resetProject()
  })

  // **端を伸ばして重ねたときも、伸ばした側が勝つ。**
  //
  // 落として重ねる道は 2026-08-02 から上書きになっていたが、**端をつまんで
  // 伸ばす道は同じ所を通っていなかった**ので、伸ばすと隣に重なったまま残っていた
  //（`useTimelineDrag` の onTrimStart が overwriteOverlappedCues を呼んでいなかった。
  //  2026-08-03 に本人から「今重なってる」と報告）。
  //
  // 判定そのものは shared/overwrite の試験で見ているので、ここは
  // 「**端を伸ばしたときに、本当にその道を通るか**」だけを見る。
  await check('テロップの端を伸ばして重ねても、伸ばした側が勝つ（上書き）', async () => {
    await resetProject()
    const bands = () => page.locator('.telop-clip')
    assert((await bands().count()) >= 2, 'テロップが2つ以上ないと重ねられない')
    const b = await bands().nth(1).boundingBox()
    const wBefore = b.width
    assert(wBefore > 20, `2つ目が細すぎて確かめられない（${wBefore}px）`)

    // **先に成立を確かめる。** 端のつまみは帯が細いと出ない（v0.1.18 で
    // 「出しても掴めない物は作らない」ことにした）。無いまま掴むと、
    // 「上書きされない」ではなく「そもそも伸ばしていない」で赤くなる
    const handle = bands().nth(0).locator('.clip-trim-r')
    assert(await handle.count(), '1つ目の右端につまみが出ていない（この確認は成立していない）')
    const h = await handle.boundingBox()

    // 2つ目の頭へ3割ほど食い込ませる
    const bite = Math.round(wBefore * 0.3)
    const y = h.y + h.height / 2
    await page.mouse.move(h.x + h.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(b.x + bite, y, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(600)

    const after = await bands().nth(1).boundingBox()
    assert(after, '2つ目のテロップが消えてしまった（削りすぎ）')
    assert(
      after.width < wBefore - 4,
      `伸ばしても2つ目が短くなっていない（${Math.round(wBefore)} → ${Math.round(after.width)}px）`
    )
    touchedRef.dirty = true
    await resetProject()
  })

  // **貼り付けたテロップが重なっても、貼った側が勝つ。**
  //
  // 落として重ねる道と、端を伸ばす道は `overwriteCues`（shared/overwrite）を
  // 通っているが、**貼り付けは通っていなかった**（`state/useCopyPaste`）。
  // 2026-08-03 に秘書エージェントの検証で見つかった——⑥（端を伸ばす）を直したとき、
  // 貼り付けと複製は視野に入っていなかった。
  //
  // ## 重なる作り方
  //
  // 貼り付けは**再生ヘッド位置が基準**（`offset = 再生位置 - 写した物の最小 start`）。
  // 再生ヘッドを 0秒 に置いて貼ると、元より手前へずれて**必ず重なる**。
  await check('貼り付けたテロップが重なっても、貼った側が勝つ（上書き）', async () => {
    await resetProject()
    await seekTo(0)
    const V2 = '[data-tid="V2"] .telop-clip'
    const boxes = async () => {
      const n = await page.locator(V2).count()
      const out = []
      for (let i = 0; i < n; i++) out.push(await page.locator(V2).nth(i).boundingBox())
      return out.sort((a, b) => a.x - b.x)
    }
    const before = await boxes()
    assert(before.length >= 1, 'V2 にテロップが無い（この確認は成立していない）')

    await page.locator(V2).first().click()
    await page.waitForTimeout(250)
    await page.keyboard.press('Control+c')
    await page.keyboard.press('Control+v')
    await page.waitForTimeout(700)

    const after = await boxes()
    assert(
      after.length > before.length,
      `そもそも貼り付いていない（${before.length} → ${after.length}）`
    )
    // **同じ段で重なった帯が残っていないこと。** 端が接するだけは重なりではない
    //（隙間なく並べたテロップが、置き直すたびに削られてしまう）ので 2px 見逃す
    const bad = []
    for (let i = 1; i < after.length; i++) {
      const prev = after[i - 1]
      const cur = after[i]
      if (cur.x < prev.x + prev.width - 2)
        bad.push(`${Math.round(prev.x)}+${Math.round(prev.width)} と ${Math.round(cur.x)}`)
    }
    assert(!bad.length, `貼ったあとも重なったままの帯がある: ${bad.join(' / ')}`)
  })

  // **複製したテロップが次の物に食い込んでも、複製した側が勝つ。**
  //
  // 複製は「自分の直後」（`start: c.end`）に置く。つまり**同じ段に次のテロップが
  // 並んでいれば必ず食い込む**。貼り付けと同じ日（2026-08-03）に、同じ型として直した。
  await check('複製したテロップが次の物に重なっても、複製した側が勝つ（上書き）', async () => {
    await resetProject()
    const V2 = '[data-tid="V2"] .telop-clip'
    const boxes = async () => {
      const n = await page.locator(V2).count()
      const out = []
      for (let i = 0; i < n; i++) out.push(await page.locator(V2).nth(i).boundingBox())
      return out.sort((a, b) => a.x - b.x)
    }
    const before = await boxes()
    assert(before.length >= 2, 'V2 にテロップが2つ以上ないと「次の物」が無い')

    // **重なる配置を自分で作る。**
    //
    // 確認用のプロジェクトは1つ目と2つ目が離れている（実測: 1つ目 222+188、2つ目 694）。
    // 複製は「自分の直後・同じ長さ」なので、**1回では 598 までしか届かない**。
    // そのまま書いたら「直しを外しても緑」＝**何も試していない見張り**になっていた。
    //
    // → **2回複製する。** 複製すると複製した側が選ばれるので、2回目は
    //   1回目の直後（598〜786）に置かれ、**2つ目（694〜）に食い込む**。
    await page.locator(V2).first().click()
    await page.waitForTimeout(250)
    await page.keyboard.press('Control+d')
    await page.waitForTimeout(700)
    const once = await boxes()
    // **1回目が効いていることを先に確かめる**（ここで止まれば、重なり以前の問題）
    assert(
      once.length === before.length + 1,
      `複製そのものが効いていない（${before.length} → ${once.length}）。` +
        `Ctrl+D の届く先が変わった可能性`
    )
    await page.keyboard.press('Control+d')
    await page.waitForTimeout(700)

    const after = await boxes()
    assert(
      after.length > before.length,
      `そもそも複製されていない（${before.length} → ${after.length}）`
    )
    const bad = []
    for (let i = 1; i < after.length; i++) {
      const prev = after[i - 1]
      const cur = after[i]
      if (cur.x < prev.x + prev.width - 2)
        bad.push(`${Math.round(prev.x)}+${Math.round(prev.width)} と ${Math.round(cur.x)}`)
    }
    assert(!bad.length, `複製したあとも重なったままの帯がある: ${bad.join(' / ')}`)
  })

}
