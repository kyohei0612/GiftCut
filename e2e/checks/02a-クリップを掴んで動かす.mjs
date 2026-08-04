// 4. クリップを掴んで動かす ／ 6. プレビュー画面での直接操作
//
// ## なぜ出したか（2026-08-04）
//
// 元は `02-タイムライン編集.mjs` 1本に7つの章が同居して1,078行あった。
// **500 を超えると AI は通しで読まず grep に切り替わる**ので、直したい章を
// 決める前に全部を読む羽目になっていた。**話題（章）で5つに割った**。
// 行数で機械的に切ってはいない。呼ぶ順は入口（`02-タイムライン編集.mjs`）が
// 元の並びのまま持っている。
//
// ## 順番の話（**ここを動かすと後ろが崩れる**）
//
// ・章の頭で1回だけ測る `W`（クリップ1つ＝5秒ぶんの幅）を、この章だけでなく
//   **`02e-帯の細さと段の高さ.mjs` の「鍵をかけると動かせない」でも使う**。
//   途中の確認が拡大率を動かすので**測り直すと値が変わる**。だから返して手渡す。
// ・`before`（最初のクリップの並び）にも、この中の4項目が続けて寄りかかっている。
//   掴んで動かす → 跡を見る → 戻す、が1本の流れになっているため。

export default async function (C) {
  const {
    assert,
    check,
    clipLayout,
    clipW,
    dragBy,
    near,
    page,
    resetProject,
    section,
    seekTo,
    v1Clips,
  } = C
  section('4. クリップを掴んで動かす')

  await resetProject()
  let before = await clipLayout()
  const W = await clipW() // クリップ1つ＝5秒ぶんの幅

  // **掴んだまま枠の外まで引っぱると、タイムラインが送られる**（ウェブページと同じ）。
  // 送りの速さは shared/edgeScroll、枠の位置は lib/edgeScroller が見ている。
  // **確認が1つも無かった**ので足した（2026-08-03。枠の位置を毎コマ測り直すのを
  // やめたときに、壊れても気づけないことに気づいた）。
  await check('掴んだまま右端まで引っぱると、タイムラインが送られる', async () => {
    await resetProject()
    // 全部が見えていると送る余地が無いので、まず寄せる
    const scr = await page.locator('.track-scroll').boundingBox()
    await page.keyboard.down('Control')
    await page.mouse.move(scr.x + scr.width / 2, scr.y + 60)
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, -120)
      await page.waitForTimeout(60)
    }
    await page.keyboard.up('Control')
    await page.waitForTimeout(400)
    const left = () => page.evaluate(() => document.querySelector('.track-scroll')?.scrollLeft ?? 0)
    await page.evaluate(() => {
      const el = document.querySelector('.track-scroll')
      if (el) el.scrollLeft = 0
    })
    await page.waitForTimeout(200)
    const x0 = await left()

    // 帯を掴んで、右端の外まで持っていって**そのまま止める**
    const clip = page.locator('[data-tid="V1"] .video-clip').first()
    const b = await clip.boundingBox()
    assert(b, '掴む帯が見つからない')
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(scr.x + scr.width - 4, b.y + b.height / 2)
    // 止めたまま待つ＝送りは「掴んでいる間ずっと」効く物
    await page.waitForTimeout(900)
    const x1 = await left()
    await page.mouse.up()
    await page.waitForTimeout(300)
    assert(x1 > x0 + 50, `端まで引っぱってもタイムラインが送られない（${x0} → ${x1}）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
    // **寄せた状態と送った位置を、この確認の中で必ず戻す。**
    //
    // 画面の状態を戻すのは `resetProject()` の中（run.mjs の viewDrift / restoreView）で、
    // **次に誰かが呼ぶまで走らない。** この確認は Ctrl+ホイールで10回寄せ、
    // 端まで送ってから終わるので、戻さないと後ろの確認が
    // 「2.5倍に寄せて 4602px 送った画面」を測ることになる:
    //
    //   ・帯は**見えている範囲にしか作られない**ので clipLayout() の数が減る（3 → 1）
    //   ・画面の外へ出たクリップの x が負になる（-2074）
    //
    // どちらも「クリップが消えた」「後ろのクリップが動いた」という文言になるので、
    // **アプリが壊れたようにしか見えない赤が4件続けて出る**（2026-08-03 に実際に出た。
    // リファクタ前へ戻しても同じ赤が出たので「元からある不具合」と記録されていたが、
    // 本当はこの確認を足した 08-03 15:44 から始まっていた）。
    //
    // ※ **この1行を外すと本当に赤4件に戻ることを確かめてある**（2026-08-03）。
    //   そのとき `run.mjs` が「残したのは『掴んだまま右端まで引っぱると、
    //   タイムラインが送られる』」と名指しで出す。
    await resetProject()
  })

  await check('掴んで動かしている間、ブラウザ標準のドラッグ（半透明の影と🚫）が始まらない', async () => {
    // 標準のドラッグが始まると dragstart が飛ぶ。1回でも飛んだらアウト。
    await page.evaluate(() => {
      window.__dragstarts = 0
      window.addEventListener('dragstart', () => (window.__dragstarts++), true)
    })
    // 隣のクリップを丸ごと踏まない量だけ動かす（踏むと上書きで数が減り、
    // 「位置が動いたか」と「上書きされたか」の区別がつかなくなる）
    await dragBy(v1Clips().nth(0), W * 0.35)
    const n = await page.evaluate(() => window.__dragstarts)
    assert(n === 0, `標準のドラッグが ${n} 回始まってしまった`)
  })

  await check('掴んで右へ動かすと、その位置へ移動する', async () => {
    const after = await clipLayout()
    assert(after.length === before.length, `クリップの数が変わった（${before.length} → ${after.length}）`)
    // 動かした跡には何も残らないので、先頭のクリップは元より右から始まる
    assert(after[0].x > before[0].x + 5, `先頭に空きができていない（${before[0].x} → ${after[0].x}）`)
  })

  await check('元の場所はただの空きになり（「空白」の帯は出ない）、他のクリップは動かない', async () => {
    const after = await clipLayout()
    const texts = after.map((c) => c.text).join(' / ')
    assert(!texts.includes('空白'), `動かした跡の帯が残っている: ${texts}`)
    // 踏んでいない最後のクリップは1ミリも動かない（後ろが押し出されない＝上書き配置）
    near(after[after.length - 1].x, before[before.length - 1].x, 2, '後ろのクリップが動いてしまった')
  })

  await check('Ctrl+Z で元の位置に戻る', async () => {
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
    const after = await clipLayout()
    assert(after.length === before.length, `クリップ数が戻っていない（${after.length} / ${before.length}）`)
    near(after[0].x, before[0].x, 2, '先頭のクリップが元の位置に戻っていない')
  })

  await check('離すと丸ごと消えるクリップが、離す前に赤く縁取られる', async () => {
    // 黙って消えると事故になるので、掴んでいる間に気づけること
    const box = await v1Clips().nth(0).boundingBox()
    const w = box.width
    const x = box.x + 20
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    // 隣のクリップをちょうど丸ごと踏む位置まで運ぶ
    for (let i = 1; i <= 6; i++) await page.mouse.move(x + (w * i) / 6, y)
    await page.waitForTimeout(250)
    const marked = await page.locator('.clip-overwrite').count()
    await page.mouse.move(x, y) // 戻してから離す（実際には動かさない）
    await page.waitForTimeout(200)
    const cleared = await page.locator('.clip-overwrite').count()
    await page.mouse.up()
    await page.waitForTimeout(300)
    assert(marked > 0, '丸ごと踏む位置に来ても警告が出ない')
    assert(cleared === 0, '踏まない位置へ戻しても警告が消えない')
    assert((await page.locator('.clip-overwrite').count()) === 0, '離したあとも警告が残っている')
  })

  await check('動かしてできた空きをクリックして選び、D で消せる（＝詰まる）', async () => {
    await resetProject()
    const base = await clipLayout()
    const W2 = await clipW()
    await dragBy(v1Clips().nth(0), W2 * 0.6) // 先頭に空きを作る
    const gap = page.locator('[data-tid="V1"] .gap-clip')
    assert(await gap.count(), '空きをクリックする場所が無い（当たり判定が無い）')
    await gap.first().click()
    await page.waitForTimeout(250)
    const selCls = (await gap.first().getAttribute('class')) ?? ''
    assert(selCls.includes('clip-selected'), '空きをクリックしても選ばれない')
    await page.keyboard.press('d') // 空きを「消す」＝その空きが無くなる＝詰まる
    await page.waitForTimeout(500)
    const after = await clipLayout()
    assert(after[0].x < base[0].x + W2 * 0.6, `空きが詰まっていない（${after[0].x}）`)
  })

  await check('空きの途中に文字があると、その手前で止まる（文字を巻き込まない）', async () => {
    await resetProject()
    const W2 = await clipW()
    // 先頭のクリップを大きく右へ動かす → 文字（1〜3秒）を含む空きができる
    await dragBy(v1Clips().nth(0), W2 * 2.2)
    const gapBefore = await page.locator('[data-tid="V1"] .gap-clip').first().boundingBox()
    assert(gapBefore, '空きができていない')
    await page.locator('[data-tid="V1"] .gap-clip').first().click()
    await page.keyboard.press('f')
    await page.waitForTimeout(500)
    // 文字は消えない（巻き込んで削らない）
    assert((await page.locator('.telop-clip').count()) === 2, '文字が消えてしまった')
    // 文字の手前までしか詰めないので、空きはまだ残っている
    const gapAfter = await page.locator('[data-tid="V1"] .gap-clip').first().boundingBox()
    assert(gapAfter, '文字を飛び越えて空きを全部消してしまった')
    assert(
      gapAfter.width < gapBefore.width - 2,
      `空きが縮んでいない（${Math.round(gapBefore.width)} → ${Math.round(gapAfter?.width ?? 0)}）`
    )
    // もう一度押すと、今度は文字が先頭に来ているので「これ以上は詰められない」と伝える
    await page.locator('[data-tid="V1"] .gap-clip').first().click()
    await page.keyboard.press('f')
    await page.waitForTimeout(400)
    assert((await page.locator('.telop-clip').count()) === 2, '2回目で文字が消えた')
  })

  await check('空きは掴んでも動かない（穴が増殖しない）', async () => {
    const n0 = await page.locator('[data-tid="V1"] .gap-clip').count()
    if (n0) {
      await dragBy(page.locator('[data-tid="V1"] .gap-clip').first(), 60)
      const n1 = await page.locator('[data-tid="V1"] .gap-clip').count()
      assert(n1 <= n0, `空きが増えた（${n0} → ${n1}）`)
    }
    await resetProject()
  })

  await check('同じ素材の断片は、元動画のどこを使っているかで見分けられる', async () => {
    const texts = await v1Clips().evaluateAll((els) => els.map((e) => e.textContent ?? ''))
    assert(texts.length > 1, 'クリップが1つしかないので確認できない')
    const ins = texts.map((t) => (t.match(/(\d+:\d+(?:\.\d+)?)〜/) ?? [])[1])
    assert(ins.every(Boolean), `イン点が出ていないクリップがある: ${texts.join(' | ')}`)
    assert(new Set(ins).size === ins.length, `イン点が重複している: ${ins.join(', ')}`)
  })

  await check('Alt+ドラッグで複製できる（元はその場に残る）', async () => {
    const n0 = await v1Clips().count()
    await dragBy(v1Clips().nth(0), W * 0.5, 0, ['Alt'])
    const n1 = await v1Clips().count()
    assert(n1 > n0, `クリップが増えていない（${n0} → ${n1}）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('Ctrl+ドラッグで割り込みできる（後ろがずれる）', async () => {
    const total0 = (await clipLayout()).reduce((a, c) => a + c.w, 0)
    await dragBy(v1Clips().nth(2), -W * 1.5, 0, ['Control'])
    const after = await clipLayout()
    const total1 = after.reduce((a, c) => a + c.w, 0)
    // 割り込みは長さの合計を変えない（空白を作らずに詰めて差し込む）
    near(total1, total0, 6, '割り込みで全体の長さが変わってしまった')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  // =========================================================================
  section('6. プレビュー画面での直接操作')

  await check('プレビューに出ている画像を掴むと、画像が動く（下の動画が動かない）', async () => {
    await seekTo(3) // 画像が映っている時刻へ
    const img = page.locator('.screen-img').first()
    assert(await img.count(), 'プレビューに画像が出ていない')
    await dragBy(img, 40, 20)
    // 画像が選ばれ、右パネルが画像の設定になっていること
    const sel = await page.locator('.img-clip.clip-selected').count()
    assert(sel > 0, '画像が選ばれていない（クリックが下の動画に吸われている）')
  })

  // **`W` を返すのは、最後の章がこの値を使うから。**
  // 元は1つのファイルの中の局所変数で、最後の「鍵をかけると動かせない」まで
  // 使い回していた。割った先で測り直すと、途中の確認が動かした拡大率が乗って
  // 別の値になる（＝掴む量が変わる）ので、**測った所から手渡しする**。
  return { W }
}
