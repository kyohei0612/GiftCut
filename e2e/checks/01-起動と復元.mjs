// 起動して、前回の続きから始められるか
//
// 章: 1. 起動と、前回の続きから始める
//
// **通しの本体は e2e/run.mjs から分けてある。** 1ファイル7,400行だと、
// 直したい章を探すのに毎回全部を読むことになり、足す場所も決まらないので
// 「仕上げ」に流れ込んでいた。道具（check・assert・素材づくり）は
// run.mjs 側に置いたままで、まとめて受け取る。

export default async function (C) {
  const {
    assert,
    captureViewBase,
    check,
    page,
    pause,
    section,
    v1Clips,
  } = C
  section('1. 起動と、前回の続きから始める')

  await check(
    '前回の続きを復元するか聞かれる',
    async () => {
    await page.waitForSelector('.restore-box', { timeout: 15000 })
      const t = await page.locator('.restore-title').textContent()
      assert(t.includes('前回の作業'), `見出しが違う: ${t}`)
    },
    { setup: true }
  )

  await check(
    '「復元する」でクリップ・文字・効果音・画像が全部戻る',
    async () => {
    await page.locator('.restore-btns button', { hasText: '復元' }).first().click()
    await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 15000 })
    await pause()
    assert((await v1Clips().count()) === 3, `本編のクリップが3つでない（${await v1Clips().count()}）`)
    assert((await page.locator('.telop-clip').count()) === 2, '文字が2つ出ていない')
    assert((await page.locator('.se-clip').count()) === 1, '効果音が出ていない')
      assert((await page.locator('.img-clip:not(.se-ghost)').count()) === 1, '画像が出ていない')
    },
    { setup: true }
  )

  // ここが「起動直後」。まだどの項目も画面をいじっていないので、
  // この時点の画面の状態を基準にする。**遅れて取ると、ずれた状態が基準になる。**
  await captureViewBase()

  // =========================================================================
}
