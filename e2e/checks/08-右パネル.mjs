// 右パネルのタブに中身が出るか
//
// 章: 右パネルのタブ（中身が出るか）
//
// **通しの本体は e2e/run.mjs から分けてある。** 1ファイル7,400行だと、
// 直したい章を探すのに毎回全部を読むことになり、足す場所も決まらないので
// 「仕上げ」に流れ込んでいた。道具（check・assert・素材づくり）は
// run.mjs 側に置いたままで、まとめて受け取る。

export default async function (C) {
  const {
    assert,
    check,
    page,
    resetProject,
    section,
  } = C
  section('右パネルのタブ（中身が出るか）')
  await resetProject()

  await check('右パネルのタブを順に開くと、それぞれの中身が出る', async () => {
    // 中身の作りを部品に分けたので、「開いたのに何も無い」を機械で見張る。
    // 中身そのものの細かい確認は各章にあるので、ここは入口だけを見る。
    //
    // **先に文字を1つ選んでおく。** テロップのタブは、選んでいる物が無い間は
    // スタイル欄ではなく案内を出す（それが正しい）。選ばずに探すと
    // 「中身が出ていない」に見えるが、実際は出る場面に居ないだけ。
    await page.locator('.telop-clip').first().click()
    await page.waitForTimeout(300)
    const tabs = [
      { label: 'プロジェクト', find: 'ファイル追加' },
      { label: 'テロップ', find: '現在のスタイルを保存' },
      { label: 'アイコン', find: '画像追加' },
      { label: 'SE', find: 'フォルダ作成' },
      { label: 'トランジション', find: null } // 中身は選択状態で変わるので存在だけ見る
    ]
    const strip = page.locator('.panel-tabs-strip').last()
    for (const t of tabs) {
      const tab = strip.locator('.tab', { hasText: t.label }).first()
      if (!(await tab.count())) {
        // 幅が足りず帯に出ていないときは ≫ から選ぶ
        await strip.locator('.tab-more').first().click()
        await page.locator('.ctx-item', { hasText: t.label }).first().click()
      } else {
        await tab.click()
      }
      await page.waitForTimeout(400)
      assert(
        (await page.locator('.panel-body').count()) > 0,
        `「${t.label}」を開いても中身が無い`
      )
      if (t.find) {
        const n = await page.locator('.panel-body button', { hasText: t.find }).count()
        assert(n > 0, `「${t.label}」に「${t.find}」のボタンが無い`)
      }
    }
    // 元のタブへ戻しておく（次の項目が探す物が変わらないように）
    await strip.locator('.tab', { hasText: 'プロジェクト' }).first().click()
    await page.waitForTimeout(300)
  })

  // 節を開いたら、その節の頭から出る。
  //
  // ※ **本人から上がった「1からではなく途中から表示される」は、これでは捕まらない。**
  //   わざと前の形（開いた2コマ後に1回だけ合わせる）へ戻しても、この確認は緑のまま
  //   ——素材が少なくて一覧が短いか、症状が出ているのが別の場所（右パネルの節では
  //   なく、字幕の一覧やタイムラインの段）かのどちらか。**再現できていない。**
  //   ここに残してあるのは「節を開いたのに頭から出ない」を丸ごと落とさないため。
  await check('下まで見てから次の節を開くと、その節の頭から出る', async () => {
    // **テロップのタブで見る。** ここは「1つだけ開く」作りなので、次を開くと
    // 前の節が畳まれて一覧が一気に縮む＝送っていた位置が行き場を失う。
    // SE のタブ（複数同時に開ける）では起きない
    const strip = page.locator('.panel-tabs-strip').last()
    await page.locator('.telop-clip').first().click()
    await page.waitForTimeout(300)
    await strip.locator('.tab', { hasText: 'テロップ' }).first().click()
    await page.waitForTimeout(500)
    const secs = page.locator('.tpl-acc')
    const n = await secs.count()
    assert(n >= 2, `節が2つ以上ないと確かめられない（${n}）`)
    // 1つ目を開いて、一覧を一番下まで送る
    await secs.first().click()
    await page.waitForTimeout(600)
    const body = page.locator('.panel-body').last()
    await body.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
    await page.waitForTimeout(400)
    const sent = await body.evaluate((el) => Math.round(el.scrollTop))
    assert(sent > 20, `準備が成立していない（下まで送れていない: ${sent}）`)
    // 別の節を開く
    await secs.nth(1).click()
    await page.waitForTimeout(1200) // 高さが落ち着くまで待つ
    // 開いた節の見出しが、一覧の上端あたりに来ているか。
    // **`.tpl-acc.open` の先頭を見てはいけない**——SE のタブは複数同時に開けるので、
    // 先に開けた方が引っかかる（それで -40px と出た）。押した物そのものを見る
    const box = await body.boundingBox()
    const head = await secs.nth(1).boundingBox()
    assert(box && head, '節または一覧が見つからない')
    const gap = Math.round(head.y - box.y)
    assert(gap >= -4 && gap < 60, `節の頭が上端に来ていない（上端から ${gap}px）`)
  })

  // =========================================================================
}
