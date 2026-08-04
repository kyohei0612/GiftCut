// 5. 選ぶ操作とキー操作 ／ 7. 文字（テロップ）
//
// ## なぜ出したか（2026-08-04）
//
// `02-タイムライン編集.mjs` が1,078行あり、7つの章が同居していた。
// **500 を超えると AI は通しで読まず grep に切り替わる**ので、話題（章）で
// 5つに割った。呼ぶ順は入口（`02-タイムライン編集.mjs`）が持っている。
//
// ## 順番の話（**ここを動かすと後ろが崩れる**）
//
// 「枠が出た状態でタイムライン上をホイールしても、映像が拡大しない」は
// 手前の項目と同じ「プレビューを押して枠を出す」から始まり、**最後に
// 拡大率を動かしたまま終わる**。後ろの章はその戻し（`resetProject`）に
// 寄りかかっているので、この2つは並べたままにする。

export default async function (C) {
  const {
    assert,
    check,
    clipLayout,
    clipW,
    dragBy,
    page,
    resetProject,
    section,
    seekTo,
    v1Clips,
  } = C
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

  await check('空きがあっても、全部選んで消せば全部消える', async () => {
    // 空きが1つでも混じっていると、Delete が「空きを詰める」だけで止まり、
    // クリップが1つも消えないことがあった（選んでいる物の種類で動きが変わっていた）。
    // クリップを動かして空きを作ってから、全部選んで消す。
    await resetProject()
    await dragBy(v1Clips().nth(1), (await clipW()) * 0.5)
    await page.waitForTimeout(600)
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Delete')
    await page.waitForTimeout(600)
    assert((await v1Clips().count()) === 0, `本編のクリップが残っている`)
    assert((await page.locator('.telop-clip').count()) === 0, '文字が残っている')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)
  })

  await check('空きだけを選んだときは、今までどおり詰まる', async () => {
    // 上の直しで「空きを選んで Delete＝詰める」が効かなくなっていないかを見る
    await resetProject()
    await dragBy(v1Clips().nth(1), (await clipW()) * 0.5)
    await page.waitForTimeout(600)
    const before = await clipLayout()
    const gap = page.locator('.gap-clip').first()
    assert(await gap.count(), '空きができていない')
    await gap.click()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(600)
    const after = await clipLayout()
    assert(
      after.length === before.length && after[1].x < before[1].x - 5,
      `空きが詰まっていない（${before.map((c) => c.x)} → ${after.map((c) => c.x)}）`
    )
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)
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

  // **段は決め打ちで見ない。** 2026-08-03 に「被っていない一番下の段に作る」へ
  // 変わったので、V2→V3 と決め打ちしていた頃の書き方は嘘になる（実際、
  // 通しでは V4→V5 に作られていて落ちていた。アプリは正しく、確認が古かった）。
  // ここが見たいのは「増えること」と「2回目は1段上へ逃げること」の2つだけ。
  await check('T キーで文字ができ、もう一度押すと1段上にできる', async () => {
    /** いまテロップが載っている映像段の番号（V2 → 2） */
    const lanes = async () =>
      await page.evaluate(() =>
        [...document.querySelectorAll('[data-tid]')]
          .filter((el) => el.querySelector('.telop-clip'))
          .map((el) => Number((el.getAttribute('data-tid') ?? '').replace('V', '')))
          .filter((n) => Number.isFinite(n))
      )
    const n0 = await page.locator('.telop-clip').count()
    const before = new Set(await lanes())
    await page.locator('.track-scroll').click({ position: { x: 700, y: 30 } })
    await page.keyboard.press('t')
    await page.waitForTimeout(400)
    const n1 = await page.locator('.telop-clip').count()
    assert(n1 === n0 + 1, `文字が増えていない（${n0} → ${n1}）`)
    const after1 = await lanes()
    const first = Math.max(...after1)
    assert(first >= 2, `本編（V1）に作られている（V${first}）`)
    assert(
      !before.has(first) || after1.filter((x) => x === first).length > 1,
      `被っていない段に作られていない（V${first}）`
    )
    await page.keyboard.press('t')
    await page.waitForTimeout(400)
    const second = Math.max(...(await lanes()))
    assert(
      second === first + 1,
      `同じ位置で2回目を押しても1段上にできていない（V${first} → V${second}）`
    )
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })
}
