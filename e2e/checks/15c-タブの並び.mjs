// パネルの**タブ**（見切れ対策と並び順）。
//
// `15-パネルと見た目.mjs` から出した（決まり: 600超は500以下に割る）。
// 章「パネルのタブ」を名乗るのはここ。入口は ./15-パネルと見た目.mjs

export default async function (C) {
  const {
    app, assert, check, fx, near, page, resetProject, section, seekTo, setDialogFiles,
    touchedRef
  } = C
  section('パネルのタブ（見切れ対策と並び順）')
  await resetProject()

  /** 右パネルを狭めて、タブがはみ出す状態を作る */
  async function narrowRightPanel() {
    const handle = page.locator('.resizer-v').last()
    const b = await handle.boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + 260, b.y + b.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(500)
  }

  await check('送りと一覧のボタンは、狭めていなくても常に出ている', async () => {
    // 出たり消えたりすると押す場所がずれて、どこにあるか覚えられない。
    // 「狭めたときだけ出る」だと、この確認は広いままでも通ってしまう（空振り）ので、
    // **狭める前**に見る。
    for (const panel of [page.locator('.panel-tabs').last(), page.locator('.panel.monitor .panel-tabs')]) {
      assert((await panel.locator('.tab-more').count()) > 0, '一覧（≫）が出ていない')
      assert((await panel.locator('.tab-nav').count()) >= 3, '送りのボタンが出ていない')
    }
    // 送るものが無いときは薄くなる。右パネルは既定の幅でもタブが入りきらないので、
    // 余裕のあるモニタ側（プログラム／ミキサーの2つ）で見る。
    const off = await page.locator('.panel.monitor .tab-nav.tab-nav-off').count()
    assert(off >= 2, `送るものが無いのに薄くなっていない（${off}個）`)
  })

  await check('パネルを狭めると、送りのボタンが押せる状態に変わる', async () => {
    await narrowRightPanel()
    const strip = page.locator('.panel-tabs-strip').last()
    const over = await strip.evaluate((el) => el.scrollWidth > el.clientWidth + 2)
    assert(over, 'タブがはみ出す状態を作れなかった')
    const off = await page.locator('.panel-tabs').last().locator('.tab-nav.tab-nav-off').count()
    assert(off === 0, `はみ出しているのに送りが薄いまま（${off}個）`)
  })

  await check('送りボタンを押しっぱなしにすると、タブが横に流れる', async () => {
    const strip = page.locator('.panel-tabs-strip').last()
    const x0 = await strip.evaluate((el) => el.scrollLeft)
    const next = page.locator('.tab-nav', { hasText: '›' }).last()
    const b = await next.boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(600) // 押しっぱなし
    await page.mouse.up()
    await page.waitForTimeout(200)
    const x1 = await strip.evaluate((el) => el.scrollLeft)
    assert(x1 > x0 + 5, `押しっぱなしで流れていない（${x0} → ${x1}）`)
  })

  await check('一覧（≫）から、見えていないタブへ移動できる', async () => {
    // 送りボタンで流れたままだと「隠れているタブ」が変わるので、先頭に戻す
    await page.locator('.panel-tabs-strip').last().evaluate((el) => (el.scrollLeft = 0))
    await page.waitForTimeout(300)
    await page.locator('.tab-more').last().click()
    await page.waitForSelector('.ctx-menu')
    const item = page.locator('.ctx-item', { hasText: 'トランジション' })
    assert(await item.count(), '一覧に「トランジション」が無い')
    await item.first().click()
    await page.waitForTimeout(600)
    const on = await page.locator('.panel-tabs-strip .tab.tab-on').last().textContent()
    assert(on.includes('トランジション'), `切り替わっていない: ${on}`)
    await page.mouse.click(5, 5) // メニューを閉じる
    await page.waitForTimeout(200)
  })

  await check('一覧（≫）には、いま見えていないタブだけが出る', async () => {
    const strip = page.locator('.panel-tabs-strip').last()
    await strip.evaluate((el) => (el.scrollLeft = 0))
    await page.waitForTimeout(300)
    const visible = await strip.evaluate((el) => {
      const box = el.getBoundingClientRect()
      return [...el.querySelectorAll('.tab')]
        .filter((t) => {
          const r = t.getBoundingClientRect()
          return r.left >= box.left - 1 && r.right <= box.right + 1
        })
        .map((t) => t.textContent.trim())
    })
    await page.locator('.tab-more').last().click()
    await page.waitForSelector('.ctx-menu')
    const listed = await page.locator('.ctx-menu .ctx-item').allTextContents()
    assert(listed.length > 0, '一覧が空')
    assert(
      listed.every((t) => !visible.includes(t.trim())),
      `見えているタブまで出ている（見えている: ${visible.join(',')} / 一覧: ${listed.join(',')}）`
    )
    await page.mouse.click(5, 5)
    await page.waitForTimeout(200)
  })

  await check('一覧（≫）の並び替えコーナーで、長押しして並び順を変えられる', async () => {
    const strip = page.locator('.panel-tabs-strip').last()
    const before = await strip.locator('.tab').allTextContents()
    await page.locator('.tab-more').last().click()
    await page.waitForSelector('.ctx-menu')
    const rows = page.locator('.ctx-menu .tab-sort-row')
    assert((await rows.count()) >= 2, '並び替えコーナーが出ていない')
    const a = await rows.nth(0).boundingBox()
    const b = await rows.nth(1).boundingBox()
    // 長押し → 掴めたことを見てから動かす（掴めていないのに動かして
    // 「並びが変わらない＝正しい」に化けるのを防ぐ）
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(450)
    assert((await page.locator('.tab-sort-grab').count()) === 1, '長押ししても掴めていない')
    for (let i = 1; i <= 6; i++)
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + ((b.y + b.height - a.y) * i) / 6)
    await page.mouse.up()
    await page.waitForTimeout(400)
    const after = await strip.locator('.tab').allTextContents()
    assert(after[0] === before[1], `並び替わっていない（${before.join(',')} → ${after.join(',')}）`)
    await page.mouse.click(5, 5)
    await page.waitForTimeout(200)
  })

  await check('並び替えコーナーは、長押ししていなければ並びが変わらない', async () => {
    // 押しただけ・触れただけで並びが崩れると、選ぼうとしただけで壊れる。
    const strip = page.locator('.panel-tabs-strip').last()
    const before = await strip.locator('.tab').allTextContents()
    await page.locator('.tab-more').last().click()
    await page.waitForSelector('.ctx-menu')
    const rows = page.locator('.ctx-menu .tab-sort-row')
    const a = await rows.nth(0).boundingBox()
    const b = await rows.nth(1).boundingBox()
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    // 長押しの手前（280ms）より短い間に動かす
    for (let i = 1; i <= 6; i++)
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + ((b.y + b.height - a.y) * i) / 6)
    await page.mouse.up()
    await page.waitForTimeout(400)
    const after = await strip.locator('.tab').allTextContents()
    assert(
      after.join(',') === before.join(','),
      `長押ししていないのに並びが変わった（${before.join(',')} → ${after.join(',')}）`
    )
    await page.mouse.click(5, 5)
    await page.waitForTimeout(200)
  })

  await check('タブを掴んで動かすと、並び順を変えられる', async () => {
    const strip = page.locator('.panel-tabs-strip').last()
    await strip.evaluate((el) => (el.scrollLeft = 0))
    await page.waitForTimeout(300)
    const before = await strip.locator('.tab').allTextContents()
    const a = await strip.locator('.tab').nth(0).boundingBox()
    const b = await strip.locator('.tab').nth(1).boundingBox()
    // 1つ目を2つ目より右へ運ぶ
    const goal = b.x + b.width + 6 // 2つ目の右端を越える所まで運ぶ
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++)
      await page.mouse.move(
        a.x + a.width / 2 + ((goal - (a.x + a.width / 2)) * i) / 8,
        a.y + a.height / 2
      )
    await page.mouse.up()
    await page.waitForTimeout(400)
    const after = await strip.locator('.tab').allTextContents()
    assert(after[0] === before[1], `入れ替わっていない（${before.join(',')} → ${after.join(',')}）`)
  })

  await check('掴んで動かしただけでは、タブが切り替わらない', async () => {
    const strip = page.locator('.panel-tabs-strip').last()
    const on = await strip.locator('.tab.tab-on').textContent()
    const t = strip.locator('.tab').nth(1)
    const b = await t.boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(b.x + b.width / 2 - i * 8, b.y + b.height / 2)
    await page.mouse.up()
    await page.waitForTimeout(400)
    const on2 = await strip.locator('.tab.tab-on').textContent()
    assert(on === on2, `並べ替えただけでタブが切り替わった（${on} → ${on2}）`)
  })

  await check('タブの右クリックは、切り離しのメニューだけを出す', async () => {
    // 並び順を変えるのは「掴んで動かす」だけ、右クリックはドッキング関連だけ、
    // と決めた（右クリックに両方入れると、押し間違いで並びが変わってしまう）。
    // 以前はここで「並び順を元に戻す」を探していたが、その項目はアプリに無い。
    const strip = page.locator('.panel-tabs-strip').last()
    // 前の項目で流れたままだと、1つ目のタブが帯からはみ出していて、
    // 右クリックが帯の外（パネル本体）へ落ち、別のメニューが出る。
    await strip.evaluate((el) => (el.scrollLeft = 0))
    await page.waitForTimeout(300)
    await strip.locator('.tab').nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const items = await page.locator('.ctx-menu .ctx-item').allTextContents()
    assert(items.length > 0, 'メニューが空')
    assert(
      items.some((t) => t.includes('切り離す') || t.includes('戻す')),
      `切り離しの項目が無い（${items.join(' / ')}）`
    )
    assert(
      !items.some((t) => t.includes('並び順')),
      `右クリックに並び替えが混ざっている（${items.join(' / ')}）`
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    assert((await page.locator('.ctx-menu').count()) === 0, 'Escape でメニューが閉じない')
  })

  // =========================================================================
}
