// 仕上げ（1/3）: **開き直しと、素材の入れ替え。**
//
// 章「仕上げ」を3つに割った1本目（2026-08-06。元は604行）。
// 順番は1行も変えていない——**同じ章の中の項目どうしは順番に依存する**
// （前の項目が残した状態を、次が前提にしていることがある）。
//
// ## 中身
//
//   破棄して新規／1つ前の状態から復元／中止して保存
//   動画の差し替え／消えたファイルを選んだとき
//
// 道具（check・assert・素材づくり）は run.mjs の C から受け取る。
// **使う物だけ受け取ること**——受け取っていない名前は
// `node e2e/lint-checks.mjs` が走らせる前に名指しする。
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export default async function (C) {
  const {
    assert,
    check,
    clipLayout,
    clipW,
    dragBy,
    fx,
    near,
    outDir,
    page,
    resetProject,
    setDialogFiles,
    v1Clips
  } = C

  await check('「破棄して新規」を押すと、前回の内容が残らない', async () => {
    // 自動保存からの復元プロンプトを出し直すため、アプリを開き直す代わりに
    // 「新規」相当としてプロジェクトを開かずに中身を消す経路を確かめる
    await page.keyboard.press('Control+a')
    await page.keyboard.press('f')
    await page.waitForTimeout(700)
    assert((await v1Clips().count()) === 0, '中身が消えていない')
    assert((await page.locator('.telop-clip').count()) === 0, '文字が残っている')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)
  })

  await check('落ちたときに「1つ前の状態」でも復元できる', async () => {
    // 落ちる原因になった操作ごと戻ってきてしまうと逃げ場が無いので、
    // 下書きは1世代前も残している。実際に読み込み直して確かめる。
    await resetProject()
    // 見分けのつく内容を「最後の自動保存」として置く（クリップ7個）
    const older = JSON.parse(readFileSync(fx.gcprojOrig, 'utf-8'))
    older.segments = Array.from({ length: 7 }, (_, i) => ({
      id: i + 1,
      srcId: 1,
      srcStart: i * 2,
      srcEnd: (i + 1) * 2
    }))
    writeFileSync(join(fx.userData, 'giftcut-autosave.json'), JSON.stringify(older), 'utf-8')
    // 開き直すと、閉じる直前の内容が新しい下書きになり、いま置いた方が1つ前へ回る
    await page.reload()
    await page.waitForSelector('.restore-btns', { timeout: 30000 })
    const prevBtn = page.locator('.restore-btns button', { hasText: '1つ前' })
    assert(await prevBtn.count(), '「1つ前の状態で復元」が出ていない')
    await prevBtn.first().click()
    await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 30000 })
    await page.waitForTimeout(1000)
    const n = await v1Clips().count()
    assert(n === 7, `1つ前の内容が戻っていない（クリップ ${n} 個。7個のはず）`)
  },
  // **下書きの世代交代が、手前の項目が残した状態に寄りかかっている。**
  // 絞って回すと「1つ前」が育っておらず、必ず赤くなる（通しでは緑）。
  { orderDependent: true })

  await check('未保存で「プロジェクトを開く」→「中止して保存する」で何も変わらない', async () => {
    await resetProject()
    await dragBy(v1Clips().nth(0), (await clipW()) * 0.4)
    const before = await clipLayout()
    await page.waitForTimeout(1100)
    await setDialogFiles([fx.gcprojOrig], null)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(500)
    const cancel = page.locator('.modal-btn', { hasText: '中止して保存する' })
    assert(await cancel.count(), '「中止して保存する」が出ていない')
    await cancel.click()
    await page.waitForTimeout(600)
    const after = await clipLayout()
    near(after[0].x, before[0].x, 2, '中止したのに内容が変わった')
  })

  await check('動画を差し替えると、確認のうえで差し替わる', async () => {
    await resetProject()
    await setDialogFiles([fx.video], null)
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    const item = page.locator('.menu-drop-item', { hasText: '差し替え' })
    assert(await item.count(), 'メニューに「動画を差し替え」が無い')
    await item.first().click()
    await page.waitForTimeout(700)
    const box = page.locator('.modal-box')
    assert(await box.count(), '差し替えの確認が出ていない')
    const t = await page.locator('.modal-title').textContent()
    assert(t.includes('差し替え'), `確認の見出しが違う: ${t}`)
    await page.locator('.modal-btn.danger', { hasText: '差し替える' }).first().click()
    await page.waitForTimeout(2000)
    assert((await v1Clips().count()) > 0, '差し替え後にクリップが無い')
  })

  await check('一覧のファイルを移動してから選ぶと、エラーが出て一覧から消える', async () => {
    await resetProject()
    const gone = join(outDir, 'gone.gcproj')
    copyFileSync(fx.gcprojOrig, gone)
    await setDialogFiles([gone], null)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(500)
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) await cont.click()
    await page.waitForTimeout(1200)
    rmSync(gone, { force: true }) // ファイルを消してから、一覧経由で開き直す
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.waitForTimeout(300)
    const entry = page.locator('.menu-drop-recent', { hasText: 'gone.gcproj' })
    assert(await entry.count(), '一覧に出ていない')
    await entry.first().click()
    await page.waitForTimeout(1000)
    const toast = await page.locator('.toast').allTextContents()
    assert(toast.some((t) => t.includes('開けません')), `エラーが出ていない: ${toast.join(' / ')}`)
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.waitForTimeout(300)
    assert(
      (await page.locator('.menu-drop-recent', { hasText: 'gone.gcproj' }).count()) === 0,
      '見つからなかった項目が一覧に残っている'
    )
    await page.keyboard.press('Escape')
  })
}
