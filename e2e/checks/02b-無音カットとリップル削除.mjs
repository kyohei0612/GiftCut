// 無音カット（喋っていない所をまとめて切る） ／ 10. リップル削除（消して後ろを詰める）
//
// ## なぜ出したか（2026-08-04）
//
// `02-タイムライン編集.mjs` が1,078行あり、7つの章が同居していた。
// **500 を超えると AI は通しで読まず grep に切り替わる**ので、話題（章）で
// 5つに割った。呼ぶ順は入口（`02-タイムライン編集.mjs`）が持っている。
//
// ## 順番の話（**ここを動かすと後ろが崩れる**）
//
// リップル削除の2項目は、**手前が残した状態の上に積み上がっている**。
// 章の頭で1回だけ素材を戻し、効果音の右クリック → 文字を1つ消す、と続く。
// 2つ目は「文字が2つある」所から始まるので、**間に別の項目を挟まない**。

export default async function (C) {
  const {
    setSlider,
    assert,
    check,
    near,
    page,
    resetProject,
    section,
  } = C
  // =========================================================================
  section('無音カット（喋っていない所をまとめて切る）')
  await resetProject()

  /** つまみに値を入れる（range は普通の入力では動かない） */
  // setSlider は章をまたいで使うので e2e/run.mjs にある
  async function openSilence() {
    if (!(await page.locator('.sil-box').count())) {
      await page.locator('.tool-wide', { hasText: '無音カット' }).click()
      await page.waitForSelector('.sil-box', { timeout: 10000 })
    }
    // 確認用の素材は20秒で、無音は 0.4〜0.6秒の3か所（`e2e/lib/e2eFixture.mjs` が
    // わざと仕込んでいる。素材まかせにしたら、無音ゼロの動画に入れ替わった日に
    // 3項目がまとめて落ちた）。既定値のままでは1つも残らないので、ゆるめて使う。
    await setSlider('これより静かなら無音', -25)
    await setSlider('この長さ以上を無音とみなす', 0.2)
    await setSlider('前後に残す余白', 0.02)
    await setSlider('これより短い所は切らない', 0.1)
    await page.locator('.btn', { hasText: '調べる' }).click()
    await page.waitForFunction(
      () => !(document.querySelector('.sil-result')?.textContent ?? '').includes('調べています'),
      { timeout: 60000 }
    )
  }
  const closeSilence = async () => {
    const btn = page.locator('.sil-box .btn', { hasText: '閉じる' })
    if (await btn.count()) await btn.click()
    await page.waitForTimeout(300)
  }
  /**
   * いまの見積もり（合計秒）。
   *
   * **読めなければ落とす。** 0 を返していたせいで「切る所が本当に0秒」なのか
   * 「文が読めていない」のかが区別できず、原因を追うのに半日かかった。
   */
  const cutSecs = async () => {
    const t = await page.locator('.sil-result').textContent()
    const m = /合計 ([\d.]+) 秒/.exec(t)
    if (!m) throw new Error(`見積もりの文が読めない（.sil-result = ${JSON.stringify(t)}）`)
    return Number(m[1])
  }

  await check('無音カットは、切る前に「どこを何秒切るか」を出す', async () => {
    // いきなり切ると、何が起きたのか分からないまま尺が変わる
    await openSilence()
    const txt = await page.locator('.sil-result').textContent()
    assert(/か所/.test(txt), `切る前の見積もりが出ていない（${txt}）`)
    await closeSilence()
  })

  await check('余白の設定が効く（バツっと切るか、少し残すか）', async () => {
    // 「バツっと切りたい人」と「余白がほしい人」の両方がいるので設定にした。
    // 効いていないと、どちらの人にも同じ結果を返す。
    await openSilence()
    await setSlider('前後に残す余白', 0)
    await page.waitForTimeout(400)
    const none = await cutSecs()
    assert(none > 0, `余白なしでも切る所が無い（${none}秒）`)
    await setSlider('前後に残す余白', 0.12)
    await page.waitForTimeout(400)
    const wide = await cutSecs()
    assert(wide < none, `余白を広げたのに切る量が減っていない（${none}秒 → ${wide}秒）`)
    await closeSilence()
  })

  await check('無音カットを実行すると短くなり、元にも戻せる', async () => {
    await resetProject()
    const width = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-tid="V1"] .video-clip:not(.se-ghost)')].reduce(
          (a, e) => a + e.getBoundingClientRect().width,
          0
        )
      )
    await openSilence()
    await setSlider('前後に残す余白', 0)
    await page.waitForTimeout(400)
    const willCut = await cutSecs()
    assert(willCut > 0, '切る所が見つからない')
    const before = await width()
    await page.locator('.btn-primary', { hasText: '切って詰める' }).click()
    await page.waitForTimeout(2000)
    assert((await page.locator('.sil-box').count()) === 0, '実行しても設定画面が閉じない')
    const after = await width()
    assert(
      after < before - 5,
      `切ったのに短くなっていない（${Math.round(before)}px → ${Math.round(after)}px / ${willCut}秒ぶん）`
    )
    // まとめて切る操作は、戻せないと怖くて使えない
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(1000)
    near(await width(), before, 8, '元に戻したのに長さが戻っていない')
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
}
