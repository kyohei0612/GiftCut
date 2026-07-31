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

  // =========================================================================
}
