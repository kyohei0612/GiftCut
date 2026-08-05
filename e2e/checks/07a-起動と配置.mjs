// 起動直後の状態と、素材の配置。
//
// `07-保存とプロジェクト.mjs` が 704行あったので出した（決まり: 600超は500以下に割る）。
// 章「1・3. 起動直後と素材の配置」を名乗るのはここ。入口は ./07-保存とプロジェクト.mjs

export default async function (C) {
  const {
    app, assert, check, clipLayout, clipW, dndFromBin, dragBy, fx, outDir, page,
    resetProject, section, setDialogFiles, touchedRef, v1Clips
  } = C
  section('1・3. 起動直後と素材の配置')
  await resetProject()

  await check('起動直後の画質設定が 1080p になっている', async () => {
    // **黙って低画質で始めない。** 何もしていないのに粗く見えているのが一番困る
    const v = await page.locator('.pq-preview').first().inputValue()
    assert(v === '1080', `画質設定が 1080p になっていない（${v}）`)
  })

  await check('効果音の「お気に入り」は最初から開いていて、フォルダを開いても畳まれない', async () => {
    // 実際に使うのはお気に入りがほとんど。1つだけ開く作りだと、
    // フォルダを見に行くたびにお気に入りが畳まれて、毎回開き直すことになる。
    await page.locator('.panel-tabs-strip').last().locator('.tab', { hasText: 'SE' }).first().click()
    await page.waitForTimeout(500)
    // 開いている節の見出し（.tpl-acc が見出しボタンそのもの）
    const openTitles = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.tpl-acc.open')].map((el) =>
          (el.textContent ?? '').slice(0, 24).trim()
        )
      )
    // **お気に入りは1件も無いと節ごと出ない。** 中身を出すため、まずフォルダを開く
    const folder = page.locator('.tpl-acc', { hasText: '📁' }).first()
    assert(await folder.count(), '効果音のフォルダが1つも無い')
    await folder.click()
    await page.waitForTimeout(600)
    // ★は**マウスを乗せるまで隠れている**（visibility: hidden）ので、先に乗せる
    const item = page.locator('.se-item').first()
    assert(await item.count(), 'フォルダを開いても効果音が出てこない')
    await item.hover()
    await page.waitForTimeout(200)
    await item.locator('.item-fav').first().click()
    await page.waitForTimeout(600)

    const after = await openTitles()
    // お気に入りは、できた瞬間から開いている
    assert(
      after.some((t) => t.includes('お気に入り')),
      `お気に入りが開いた状態で出てこない（開いている節: ${after.join(' / ') || 'なし'}）`
    )
    // **開いたフォルダも畳まれていない。** ここが本題
    // （1つだけ開く作りだと、お気に入りが出た時点でフォルダが閉じる）
    assert(
      after.some((t) => t.includes('📁')),
      `お気に入りが出たらフォルダが畳まれた（開いている節: ${after.join(' / ') || 'なし'}）`
    )
    // ★を戻す（次の項目に持ち越さない）
    const unstar = page.locator('.item-fav.on').first()
    if (await unstar.count()) await unstar.click()
    await page.waitForTimeout(300)
  })

  await check('タイムラインが中身の長さに収まっている（左端の小さな塊にならない）', async () => {
    const { content, view } = await page.evaluate(() => {
      const inner = document.querySelector('.track-inner').getBoundingClientRect()
      const scroll = document.querySelector('.track-scroll').getBoundingClientRect()
      const clips = [...document.querySelectorAll('[data-tid="V1"] .video-clip:not(.se-ghost)')]
      const last = clips[clips.length - 1].getBoundingClientRect()
      return { content: last.right - inner.x, view: scroll.width }
    })
    // 中身が画面幅の半分以上を占めていれば「収まっている」とみなす
    assert(content > view * 0.5, `中身が画面の左端に寄っている（${Math.round(content)} / ${Math.round(view)}）`)
  })

  await check('素材を追加しても、タイムラインには載らない', async () => {
    // **押すボタンのある所を自分で開く。**
    // 直前が SE タブを見たまま終わっていると、プロジェクトの「ファイル追加」が
    // 見つからずに落ちる（通しで実際に踏んだ）
    await page.locator('.panel-tabs-strip').last().locator('.tab', { hasText: 'プロジェクト' }).first().click()
    await page.waitForTimeout(400)
    const n0 = await v1Clips().count()
    await setDialogFiles([fx.video], null)
    await page.locator('button', { hasText: 'ファイル追加' }).first().click()
    await page.waitForTimeout(900)
    assert((await v1Clips().count()) === n0, '追加しただけでタイムラインに載った')
  })

  await check('ビンからドラッグして落とすと、その位置から始まる', async () => {
    await resetProject()
    const r = await dndFromBin('test_image', '[data-tid="V3"]', { x: 300, y: 10 })
    assert(r.ghost, '掴んだ素材の影が出なかった')
    await page.waitForTimeout(500)
    const imgs = await page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)').all()
    assert(imgs.length >= 2, `落とした画像が増えていない（${imgs.length}）`)
    const boxes = await Promise.all(imgs.map((i) => i.boundingBox()))
    const inner = await page.locator('.track-inner').boundingBox()
    // 落とした位置（+300px）の近くから始まっているものがある
    assert(
      boxes.some((b) => Math.abs(b.x - (inner.x + 300)) < 25),
      `落とした位置から始まっていない（${boxes.map((b) => Math.round(b.x - inner.x)).join(',')}）`
    )
  })

  await check('動画を上から2段目に置くと、対の音声段に音が入って連動する', async () => {
    await resetProject()
    const r = await dndFromBin('test_video', '[data-tid="V2"]', { x: 200, y: 10 })
    assert(r.ghost, '掴んだ動画の影が出なかった')
    await page.waitForTimeout(1500)
    const v2 = await page.locator('[data-tid="V2"] .clip:not(.se-ghost)').count()
    const a2 = await page.locator('[data-tid="A2"] .clip:not(.se-ghost)').count()
    assert(v2 > 0, 'V2 に動画が置かれていない')
    assert(a2 > 0, '対の音声段（A2）に音が入っていない')
  })

  await check('お知らせが積み上がらず、多くても2つまでで消える', async () => {
    await resetProject()
    // わざと立て続けに操作してお知らせを何度も出す
    for (let i = 0; i < 4; i++) {
      await v1Clips().nth(0).click({ button: 'right' })
      await page.waitForSelector('.ctx-menu')
      await page.locator('.ctx-swatch:not(.ctx-swatch-none)').nth(i % 3).click()
      await page.waitForTimeout(120)
    }
    const n = await page.locator('.toast').count()
    assert(n <= 2, `お知らせが ${n} 件たまっている`)
    await page.waitForTimeout(3600)
    assert((await page.locator('.toast').count()) === 0, 'しばらく経ってもお知らせが消えない')
  })

  // =========================================================================
}
