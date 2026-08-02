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
  //   場所は右パネルのテロップタブと分かっており、**原因も見つけて直してある**
  //   （`VirtualBlock` が自分の位置を測る前に 0 と決め打っていた。詳細はそのファイル）。
  //   だが、わざと前の形へ戻してもこの確認は緑のまま——見本を120個入れて
  //   一覧を伸ばしても再現できなかった。**この確認は症状の見張りにはなっていない。**
  //   残してあるのは「節を開いたのに頭から出ない」を丸ごと落とさないため。
  await check('下まで見てから次の節を開くと、その節の頭から出る', async () => {
    // **テロップのタブで見る。** ここは「1つだけ開く」作りなので、次を開くと
    // 前の節が畳まれて一覧が一気に縮む＝送っていた位置が行き場を失う。
    // SE のタブ（複数同時に開ける）では起きない
    const strip = page.locator('.panel-tabs-strip').last()
    await page.locator('.telop-clip').first().click()
    await page.waitForTimeout(300)
    await strip.locator('.tab', { hasText: 'テロップ' }).first().click()
    await page.waitForTimeout(700)
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

    // **ここが本題。** 見えている分だけ描く箱（VirtualBlock）は、上に「まだ描いて
    // いない分」の空きを置く。開いた直後にその空きがあるということは、
    // **一覧の途中から描き始めている**＝「1からではなく途中から表示される」。
    // 位置（上の gap）だけ見ても、この状態は捕まらない。
    const padTop = await page.evaluate(() => {
      const open = [...document.querySelectorAll('.tpl-acc.open')].pop()
      const body = open?.parentElement
      if (!body) return null
      const spacer = body.querySelector('div[aria-hidden="true"]')
      // 空きは「上の空き」が先に来る。無ければ 0（＝頭から描いている）
      return spacer ? Math.round(spacer.getBoundingClientRect().height) : 0
    })
    assert(padTop != null, '開いた節の中身が見つからない')
    assert(padTop === 0, `一覧の途中から描き始めている（上の空きが ${padTop}px）`)
    assert(gap >= -4 && gap < 60, `節の頭が上端に来ていない（上端から ${gap}px）`)
  })

  // =========================================================================
}
