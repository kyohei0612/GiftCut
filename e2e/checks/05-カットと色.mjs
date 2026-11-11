// カット・元に戻す・クリップの色分け
//
// 章: 4. カットとキー操作の続き / 12. 元に戻す・やり直す / 15. クリップの色分け
//
// **通しの本体は e2e/run.mjs から分けてある。** 1ファイル7,400行だと、
// 直したい章を探すのに毎回全部を読むことになり、足す場所も決まらないので
// 「仕上げ」に流れ込んでいた。道具（check・assert・素材づくり）は
// run.mjs 側に置いたままで、まとめて受け取る。

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export default async function (C) {
  const {
    clipW,
    assert,
    check,
    clipLayout,
    dragBy,
    fx,
    near,
    page,
    resetProject,
    section,
    seekTo,
    setDialogFiles,
    v1Clips,
  } = C

  section('4. カットとキー操作の続き')
  await resetProject()
  // クリップ1つぶんの幅（5秒）。章をまたいで持ち回さず、その場で測る。
  // **開き直したあとで測る**（2026-08-07）。前は resetProject より先に測っていて、
  // 「前の章が帯を残している」に黙って寄りかかっていた——前の章が空で終わると、
  // 章そのものが「実行に失敗」で落ちる（項目が1つも走らない）
  const W = await clipW()

  await check('C でカッター、V で矢印に戻る', async () => {
    await page.keyboard.press('c')
    await page.waitForTimeout(150)
    let cls = await page.locator('.track-inner').getAttribute('class')
    const razorOn = await page.locator('.tool.tool-on').evaluateAll((els) =>
      els.some((e) => (e.textContent ?? '').includes('✂'))
    )
    assert(razorOn, 'C でカッターにならない')
    await page.keyboard.press('v')
    await page.waitForTimeout(150)
    const stillRazor = await page.locator('.tool.tool-on').evaluateAll((els) =>
      els.some((e) => (e.textContent ?? '').includes('✂'))
    )
    assert(!stillRazor, 'V で矢印に戻らない')
    void cls
  })

  await check('Ctrl+K で再生位置にカットが入る', async () => {
    await seekTo(7) // 2番目のクリップの真ん中
    const n0 = await v1Clips().count()
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(400)
    const n1 = await v1Clips().count()
    assert(n1 === n0 + 1, `カットが増えていない（${n0} → ${n1}）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
  })

  await check('D は「消すだけ」— 後ろのクリップも文字も動かない', async () => {
    await resetProject()
    const before = await clipLayout()
    assert((await page.locator('.telop-clip').count()) === 2, '文字が2つある状態から始められていない')
    const cue0 = await page.locator('.telop-clip').last().boundingBox()
    await v1Clips().nth(0).click()
    await page.keyboard.press('d')
    await page.waitForTimeout(500)
    const after = await clipLayout()
    assert(after.length === before.length - 1, `クリップが1つ減っていない（${before.length} → ${after.length}）`)
    // 残ったクリップは1ミリも動かない
    near(after[0].x, before[1].x, 2, '後ろのクリップが前へ詰まってしまった')
    const cue1 = await page.locator('.telop-clip').last().boundingBox()
    near(cue1.x, cue0.x, 2, '文字が動いてしまった')
    // 消した所は「空き」として残り、クリックできる
    assert((await page.locator('[data-tid="V1"] .gap-clip').count()) > 0, '空きが残っていない')
  })

  await check('F は「消して詰める」— 後ろが前へ寄る', async () => {
    await resetProject()
    const before = await clipLayout()
    assert((await page.locator('.telop-clip').count()) === 2, '文字が2つある状態から始められていない')
    const cue0 = await page.locator('.telop-clip').last().boundingBox()
    await v1Clips().nth(0).click()
    await page.keyboard.press('f')
    await page.waitForTimeout(500)
    const after = await clipLayout()
    assert(after.length === before.length - 1, 'クリップが1つ減っていない')
    near(after[0].x, before[0].x, 2, '先頭に詰まっていない')
    assert((await page.locator('[data-tid="V1"] .gap-clip').count()) === 0, '詰めたのに空きが残っている')
    const cue1 = await page.locator('.telop-clip').last().boundingBox()
    assert(cue1.x < cue0.x - 5, '文字が一緒に前へ寄っていない')
  })

  await check('D と Delete と Backspace が同じ動きをする', async () => {
    const trial = async (key) => {
      const n0 = await v1Clips().count()
      await v1Clips().nth(0).click()
      await page.keyboard.press(key)
      await page.waitForTimeout(400)
      const n1 = await v1Clips().count()
      await page.keyboard.press('Control+z')
      await page.waitForTimeout(400)
      return n0 - n1
    }
    const d = await trial('d')
    const del = await trial('Delete')
    const bs = await trial('Backspace')
    assert(d === del && del === bs, `減り方が違う（D:${d} Delete:${del} Backspace:${bs}）`)
  })

  await check('複数のクリップを選んでまとめて動かせる', async () => {
    await resetProject()
    const before = await clipLayout()
    await v1Clips().nth(1).click()
    await v1Clips().nth(2).click({ modifiers: ['Control'] })
    await page.waitForTimeout(200)
    await dragBy(v1Clips().nth(1), W * 0.6)
    const after = await clipLayout()
    assert(after.length >= before.length, 'クリップが消えた')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  // =========================================================================
  section('12. 元に戻す・やり直す')
  await resetProject()

  await check('動かす → Ctrl+Z で戻る → Ctrl+Y でやり直せる', async () => {
    const before = await clipLayout()
    await dragBy(v1Clips().nth(0), W * 0.8)
    const moved = await clipLayout()
    assert(moved[0].x > before[0].x + 5, '動かせていない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
    const undone = await clipLayout()
    near(undone[0].x, before[0].x, 2, 'Ctrl+Z で戻っていない')
    assert(undone.length === before.length, 'クリップ数が戻っていない')
    await page.keyboard.press('Control+y')
    await page.waitForTimeout(400)
    const redone = await clipLayout()
    assert(redone[0].x > before[0].x + 5, 'Ctrl+Y でやり直せていない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('Ctrl+Shift+Z でもやり直せる', async () => {
    const base = await clipLayout()
    await dragBy(v1Clips().nth(0), 130)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
    await page.keyboard.press('Control+Shift+z')
    await page.waitForTimeout(400)
    const after = await clipLayout()
    assert(after[0].x > base[0].x + 5, 'Ctrl+Shift+Z でやり直せない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  // 素材は 5秒×3本で、2本目の上に「ふたつめ」(6〜8秒)が載っている（e2e/lib/e2eFixture）。
  // 1本目と3本目を複製すると並びは 1・1'・2・3・3' になり、2本目は 5秒後ろへ動く。
  // 前は「最後に選んだ切片より後ろ」しか送らなかったので、間のテロップが置き去りになった
  await check('離れた本編を2本選んで複製しても、間のテロップが映像についていく', async () => {
    await resetProject()
    await v1Clips().nth(0).click()
    await v1Clips().nth(2).click({ modifiers: ['Control'] })
    const sel = await v1Clips().evaluateAll((els) => els.map((e) => e.classList.contains('clip-selected')))
    assert(JSON.stringify(sel) === '[true,false,true]', `1本目と3本目が選べていない（${JSON.stringify(sel)}）`)
    await page.keyboard.press('Control+d')
    await page.waitForTimeout(600)
    assert((await v1Clips().count()) === 5, `本編が5本になっていない（${await v1Clips().count()}本）`)
    const box0 = await v1Clips().first().boundingBox()
    const pxPerSec = box0.width / 5
    const tel = page.locator('.telop-clip[title="ふたつめ"]').first()
    assert(await tel.count(), '「ふたつめ」のテロップが無い')
    const at = +(((await tel.boundingBox()).x - box0.x) / pxPerSec).toFixed(1)
    assert(Math.abs(at - 11) <= 0.2, `2本目に載っていたテロップが 6 + 5 = 11秒へ送られていない（${at}秒）`)
  })

  // 本人（2026-11-12）「動画をダブルクリックしたら配置されて2度と元に戻れない」。
  // 動画が1本も無いとき、素材ビンのダブルクリックは動画を開いて先頭に並べる。前は
  // そこで**履歴を全部捨てていた**ので、置く前にも、その前の手にも戻れなかった
  //（state/useMediaOps の loadVideo）。**置く前の手（テロップを消す）を自分で作ってから**確かめる
  await check('動画の無いプロジェクトで素材をダブルクリックして置いても、Ctrl+Z で置く前とその前へ戻れる', async () => {
    const proj = JSON.parse(readFileSync(fx.gcprojOrig, 'utf-8'))
    Object.assign(proj, { videoPath: null, sources: [], segments: [] })
    const p = join(fx.dir, 'no-video.gcproj')
    writeFileSync(p, JSON.stringify(proj), 'utf-8')
    await setDialogFiles([p], null)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(400)
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) await cont.click()
    await page.waitForTimeout(800)
    const telops = () => page.locator('.telop-clip').count()
    assert((await v1Clips().count()) === 0, `動画の無いプロジェクトが開けていない（本編 ${await v1Clips().count()}本）`)
    const t0 = await telops()
    assert(t0 >= 2, `テロップが開けていない（${t0}枚）`)
    // 置く前の手: テロップを1枚消す（履歴は 450ms で1手にまとまる）
    await page.locator('.telop-clip').first().click()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(700)
    assert((await telops()) === t0 - 1, 'テロップが消えていない（準備が成立していない）')
    const card = page.locator('.media-card', { hasText: 'test_video' }).first()
    assert(await card.count(), '素材ビンに動画のカードが無い')
    await card.dblclick()
    await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 15000 })
    await page.waitForTimeout(700)
    assert((await v1Clips().count()) === 1, 'ダブルクリックで動画が1本並んでいない（準備が成立していない）')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
    assert((await v1Clips().count()) === 0, 'Ctrl+Z で「動画を置く前」に戻らない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
    assert((await telops()) === t0, `もう一度 Ctrl+Z で、置く前に消したテロップが戻らない（${await telops()}枚）`)
  })

  // =========================================================================
  section('15. クリップの色分け')
  await resetProject()

  await check('右クリックから色を付けられて、Ctrl+Z で戻る', async () => {
    const bg = () => v1Clips().nth(0).evaluate((el) => getComputedStyle(el).backgroundColor)
    const before = await bg()
    await v1Clips().nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const swatch = page.locator('.ctx-swatch:not(.ctx-swatch-none)').first()
    if (!(await swatch.count())) {
      await page.keyboard.press('Escape')
      throw new Error('右クリックメニューに色の選択肢が無い')
    }
    await swatch.click()
    await page.waitForTimeout(400)
    const after = await bg()
    assert(after !== before, `色が変わっていない（${before}）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
    assert((await bg()) === before, 'Ctrl+Z で色が戻らない')
  })

  // =========================================================================
}
