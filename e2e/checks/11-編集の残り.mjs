// 編集まわりで残っていた確認とトラック
//
// 章: 4-5. 編集とキー操作 / 4-5. 編集の残り / 11-12. トラックと元に戻す
//
// **通しの本体は e2e/run.mjs から分けてある。** 1ファイル7,400行だと、
// 直したい章を探すのに毎回全部を読むことになり、足す場所も決まらないので
// 「仕上げ」に流れ込んでいた。道具（check・assert・素材づくり）は
// run.mjs 側に置いたままで、まとめて受け取る。

import { join } from 'node:path'

export default async function (C) {
  const {
    trackHead,
    binCardReady,
    assert,
    check,
    clipLayout,
    clipW,
    dragBy,
    near,
    outDir,
    page,
    resetProject,
    section,
    seekTo,
    setDialogFiles,
    v1Clips,
  } = C

  // クリップ1つぶんの幅（5秒）。章をまたいで持ち回さず、その場で測る
  const W = await clipW()
  section('4-5. 編集とキー操作')
  await resetProject()

  await check('Q で、ひとつ前の編集点まで詰めて削除できる', async () => {
    await seekTo(12) // 3つ目のクリップの中
    const before = (await clipLayout()).reduce((a, c) => a + c.w, 0)
    await page.keyboard.press('q')
    await page.waitForTimeout(500)
    const after = (await clipLayout()).reduce((a, c) => a + c.w, 0)
    assert(after < before - 5, `詰まっていない（${before} → ${after}）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('文字が乗っている所で Q を押すと、文字の手前で止まる', async () => {
    // 文字は 1〜3秒 と 6〜8秒。7.5秒から Q を押すと 6秒（文字の頭）で止まるはず。
    await seekTo(7.5)
    const n0 = await page.locator('.telop-clip').count()
    await page.keyboard.press('q')
    await page.waitForTimeout(500)
    assert((await page.locator('.telop-clip').count()) === n0, '文字が巻き添えで消えた')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('波形の帯（A1）を掴んでも、映像と一緒に動く', async () => {
    const before = await clipLayout()
    const audio = page.locator('[data-tid="A1"] .audio-clip:not(.se-ghost)').first()
    assert(await audio.count(), 'A1 に波形の帯が出ていない')
    await dragBy(audio, (await clipW()) * 0.5)
    const after = await clipLayout()
    assert(after[0].x > before[0].x + 5, '音声側を掴んでも映像が動かない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('目印を選んだあと本編をクリックして Delete → 本編が消える', async () => {
    const marker = page.locator('.marker, .ruler-marker, [class*="marker"]').first()
    if (await marker.count()) {
      await marker.click()
      await page.waitForTimeout(250)
    }
    const n0 = await v1Clips().count()
    await v1Clips().nth(0).click()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(500)
    assert((await v1Clips().count()) === n0 - 1, '本編が消えていない（目印だけ消えた疑い）')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('スペースキーで再生が始まり、もう一度で止まる', async () => {
    const headX = async () =>
      page.locator('.playhead').first().evaluate((el) => el.getBoundingClientRect().x)
    await seekTo(2)
    const x0 = await headX()
    await page.keyboard.press('Space')
    await page.waitForTimeout(900)
    const x1 = await headX()
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    const x2 = await headX()
    await page.waitForTimeout(600)
    const x3 = await headX()
    assert(x1 > x0 + 2, '再生が始まらない')
    assert(Math.abs(x3 - x2) < 3, 'もう一度押しても止まらない')
  })

  // =========================================================================
  section('4-5. 編集の残り')
  await resetProject()

  await check('W で、次の編集点まで削って詰められる', async () => {
    await seekTo(11) // 3つ目のクリップの中（文字や効果音が無い所）
    const before = (await clipLayout()).reduce((a, c) => a + c.w, 0)
    await page.keyboard.press('w')
    await page.waitForTimeout(500)
    const after = (await clipLayout()).reduce((a, c) => a + c.w, 0)
    assert(after < before - 3, `詰まっていない（${before} → ${after}）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('クリップを消すと、文字・効果音・画像も一緒にずれる', async () => {
    await resetProject()
    const cue0 = await page.locator('.telop-clip').last().boundingBox()
    const se0 = await page.locator('.se-clip').first().boundingBox()
    const img0 = await page.locator('.img-clip:not(.se-ghost)').first().boundingBox()
    await v1Clips().nth(0).click()
    await page.keyboard.press('f') // 消して詰める
    await page.waitForTimeout(600)
    const cue1 = await page.locator('.telop-clip').last().boundingBox()
    const se1 = await page.locator('.se-clip').first().boundingBox()
    const img1 = await page.locator('.img-clip:not(.se-ghost)').first().boundingBox()
    assert(cue1.x < cue0.x - 5, '文字が一緒にずれていない')
    assert(se1.x < se0.x - 5, '効果音が一緒にずれていない')
    assert(img1.x < img0.x - 5, '画像が一緒にずれていない')
  })

  await check('掴んだ後で Alt を押すと「複製」に切り替わる', async () => {
    await resetProject()
    const box = await v1Clips().nth(0).boundingBox()
    const W2 = await clipW()
    await page.mouse.move(box.x + 20, box.y + box.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 4; i++)
      await page.mouse.move(box.x + 20 + (W2 * 0.5 * i) / 4, box.y + box.height / 2)
    await page.waitForTimeout(250)
    const moving = await page.locator('.se-ghost .clip-text').first().textContent()
    assert(moving.includes('移動'), `最初が「移動」になっていない: ${moving}`)
    await page.keyboard.down('Alt')
    await page.mouse.move(box.x + 20 + W2 * 0.55, box.y + box.height / 2)
    await page.waitForTimeout(250)
    const copying = await page.locator('.se-ghost .clip-text').first().textContent()
    assert(copying.includes('複製'), `Alt で「複製」に変わらない: ${copying}`)
    await page.keyboard.down('Control')
    await page.keyboard.up('Alt')
    await page.mouse.move(box.x + 20 + W2 * 0.6, box.y + box.height / 2)
    await page.waitForTimeout(250)
    const inserting = await page.locator('.se-ghost .clip-text').first().textContent()
    assert(inserting.includes('割り込み'), `Ctrl で「割り込み」に変わらない: ${inserting}`)
    await page.keyboard.up('Control')
    await page.mouse.move(box.x + 20, box.y + box.height / 2)
    await page.mouse.up()
    await page.waitForTimeout(400)
  })

  await check('Ctrl を押して動かさずクリックすると、複数選びになる', async () => {
    await resetProject()
    await v1Clips().nth(0).click()
    await v1Clips().nth(1).click({ modifiers: ['Control'] })
    await page.waitForTimeout(300)
    const sel = await page.locator('[data-tid="V1"] .video-clip.clip-selected').count()
    assert(sel === 2, `2つ選ばれていない（${sel}）`)
    await v1Clips().nth(1).click({ modifiers: ['Control'] })
    await page.waitForTimeout(300)
    assert(
      (await page.locator('[data-tid="V1"] .video-clip.clip-selected').count()) === 1,
      'もう一度 Ctrl クリックしても選択が外れない'
    )
  })

  await check('Ctrl+A で全部選んで動かすと、文字も効果音も一緒に動く', async () => {
    await resetProject()
    const cue0 = await page.locator('.telop-clip').first().boundingBox()
    const se0 = await page.locator('.se-clip').first().boundingBox()
    await page.keyboard.press('Control+a')
    await page.waitForTimeout(300)
    await dragBy(v1Clips().nth(0), (await clipW()) * 0.4)
    await page.waitForTimeout(500)
    const cue1 = await page.locator('.telop-clip').first().boundingBox()
    const se1 = await page.locator('.se-clip').first().boundingBox()
    assert(cue1.x > cue0.x + 5, '文字が一緒に動いていない')
    assert(se1.x > se0.x + 5, '効果音が一緒に動いていない')
  })

  await check('全部選んで動かす途中で Alt を押すと、文字が元の位置に戻る', async () => {
    await resetProject()
    const cue0 = await page.locator('.telop-clip').first().boundingBox()
    await page.keyboard.press('Control+a')
    await page.waitForTimeout(300)
    const box = await v1Clips().nth(0).boundingBox()
    const W2 = await clipW()
    await page.mouse.move(box.x + 20, box.y + box.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 4; i++)
      await page.mouse.move(box.x + 20 + (W2 * 0.4 * i) / 4, box.y + box.height / 2)
    await page.waitForTimeout(300)
    const cueMoved = await page.locator('.telop-clip').first().boundingBox()
    assert(cueMoved.x > cue0.x + 5, '掴んでいる間に文字が動いていない')
    await page.keyboard.down('Alt')
    await page.mouse.move(box.x + 20 + W2 * 0.42, box.y + box.height / 2)
    await page.waitForTimeout(350)
    const cueBack = await page.locator('.telop-clip').first().boundingBox()
    near(cueBack.x, cue0.x, 4, 'Alt を押しても文字が元の位置に戻らない')
    await page.keyboard.up('Alt')
    await page.mouse.up()
    await page.waitForTimeout(400)
  })

  await check('空きにマウスを乗せると、触れる場所だと分かる枠が出る', async () => {
    await resetProject()
    await dragBy(v1Clips().nth(0), (await clipW()) * 0.6)
    const gap = page.locator('[data-tid="V1"] .gap-clip').first()
    assert(await gap.count(), '空きができていない')
    const plain = await gap.evaluate((el) => getComputedStyle(el).borderColor)
    await gap.hover()
    await page.waitForTimeout(250)
    const hovered = await gap.evaluate((el) => getComputedStyle(el).borderColor)
    assert(hovered !== plain, `乗せても見た目が変わらない（${plain}）`)
  })

  await check('詰めきれない空きは、理由を教えてくれる', async () => {
    await resetProject()
    await dragBy(v1Clips().nth(0), (await clipW()) * 2.2)
    const gap = page.locator('[data-tid="V1"] .gap-clip').first()
    await gap.click()
    await page.keyboard.press('d')
    await page.waitForTimeout(500)
    await page.locator('[data-tid="V1"] .gap-clip').first().click()
    await page.keyboard.press('d')
    await page.waitForTimeout(500)
    const toast = await page.locator('.toast').allTextContents()
    assert(
      toast.some((t) => t.includes('別のクリップ')),
      `理由が出ていない: ${toast.join(' / ')}`
    )
  })

  await check('空きを含んだまま保存して開き直すと、空きが残っている', async () => {
    await resetProject()
    await dragBy(v1Clips().nth(0), (await clipW()) * 0.6)
    const gaps0 = await page.locator('[data-tid="V1"] .gap-clip').count()
    assert(gaps0 > 0, '空きができていない')
    const saved = join(outDir, 'with-gap.gcproj')
    await setDialogFiles([saved], saved)
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.locator('.menu-drop-item', { hasText: '別名で保存' }).first().click()
    await page.waitForTimeout(1500)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(500)
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) await cont.click()
    await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 15000 })
    await page.waitForTimeout(800)
    assert(
      (await page.locator('[data-tid="V1"] .gap-clip').count()) === gaps0,
      '開き直したら空きが消えた'
    )
  })

  await check('効果音を複数選ぶと、まとめて動かせる', async () => {
    await resetProject()
    // 2つ目の効果音を作る（複製）
    await page.locator('.se-clip').first().click()
    await page.keyboard.press('Control+d')
    await page.waitForTimeout(500)
    const n = await page.locator('.se-clip').count()
    assert(n >= 2, `効果音が2つにならない（${n}）`)
    const xs0 = await page.locator('.se-clip').evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().x))
    )
    await page.locator('.se-clip').nth(0).click()
    await page.locator('.se-clip').nth(1).click({ modifiers: ['Control'] })
    await dragBy(page.locator('.se-clip').nth(0), 60)
    await page.waitForTimeout(400)
    const xs1 = await page.locator('.se-clip').evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().x))
    )
    // **並び順で比べないこと。**
    // 動かしたあとに要素の並びが入れ替わることがあり、添字どうしで比べると
    // 「317,506 → 566,377」のように**両方ちゃんと +60 動いていても落ちる**。
    // 見たいのは「どれも右へ動いたか」なので、位置順に並べてから比べる。
    const a = [...xs0].sort((p, q) => p - q)
    const b = [...xs1].sort((p, q) => p - q)
    assert(
      b.every((x, i) => x > a[i] + 5),
      `まとめて動いていない（${a.join(',')} → ${b.join(',')}）`
    )
  })

  await check('タイムラインで使っている素材は、置き場から消せず理由が出る', async () => {
    await resetProject()
    const card = await binCardReady('test_image')
    await card.click()
    await page.waitForTimeout(300)
    const bin0 = await page.locator('.media-card').count()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(500)
    assert((await page.locator('.media-card').count()) === bin0, '使用中なのに消えた')
    const toast = await page.locator('.toast').allTextContents()
    assert(toast.some((t) => t.includes('使用中')), `理由が出ていない: ${toast.join(' / ')}`)
  })

  await check('使っていない素材は、置き場から Delete で消える', async () => {
    const n0 = await v1Clips().count()
    const card = await binCardReady('spare_image')
    await card.click()
    await page.waitForTimeout(300)
    const bin0 = await page.locator('.media-card').count()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(500)
    assert((await page.locator('.media-card').count()) === bin0 - 1, '置き場の素材が消えていない')
    assert((await v1Clips().count()) === n0, 'タイムラインのクリップが消えてしまった')
  })

  // =========================================================================
  section('11-12. トラックと元に戻す')
  await resetProject()

  await check('中身が入っているトラックは削除できず、理由が出る', async () => {
    const n0 = await page.locator('[data-tid]').count()
    await trackHead('V1').locator('.th-name').click()
    await page.waitForTimeout(250)
    await page.keyboard.press('Delete')
    await page.waitForTimeout(500)
    assert((await page.locator('[data-tid]').count()) === n0, '中身があるのにトラックが消えた')
  })

  await check('鍵をかけると、端のトリム・分割・削除・複製が全部できなくなる', async () => {
    await resetProject()
    const lock = trackHead('V1').locator('button[title="ロック"]').first()
    const before = await clipLayout()

    // ★先に「鍵なしなら効く」ことを確かめる。
    //   これが無いと、操作がそもそも届いていないだけでも
    //   「鍵が効いている」と読めてしまい、鍵が壊れても気づけない。
    const trimEnd = async () => {
      const box = await v1Clips().nth(0).boundingBox()
      await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width + 80, box.y + box.height / 2, { steps: 5 })
      await page.mouse.up()
      await page.waitForTimeout(400)
    }
    const razorCut = async () => {
      await page.keyboard.press('c')
      await v1Clips().nth(0).click({ position: { x: 30, y: 8 } })
      await page.waitForTimeout(400)
      await page.keyboard.press('v')
    }
    const undo = async () => {
      await page.keyboard.press('Control+z')
      await page.waitForTimeout(500)
    }
    await trimEnd()
    assert(
      Math.abs((await clipLayout())[0].w - before[0].w) > 3,
      '鍵なしでも長さが変わらない＝確認になっていない（つまむ場所が違う疑い）'
    )
    await undo()
    await razorCut()
    assert(
      (await v1Clips().count()) === before.length + 1,
      '鍵なしでも分割できない＝確認になっていない（カッターが効いていない疑い）'
    )
    await undo()
    await v1Clips().nth(0).click()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(400)
    assert(
      (await v1Clips().count()) === before.length - 1,
      '鍵なしでも削除できない＝確認になっていない（キー割当が違う疑い）'
    )
    await undo()
    await v1Clips().nth(0).click()
    await page.keyboard.press('Control+d')
    await page.waitForTimeout(400)
    assert(
      (await v1Clips().count()) === before.length + 1,
      '鍵なしでも複製できない＝確認になっていない'
    )
    await undo()
    assert((await v1Clips().count()) === before.length, '確認の前に状態を戻せていない')

    // ここからが本題。同じ操作が、鍵をかけると全部できなくなること。
    await lock.click()
    await page.waitForTimeout(300)
    await trimEnd()
    near((await clipLayout())[0].w, before[0].w, 3, '鍵をかけたのに長さが変わった')
    await razorCut()
    assert((await v1Clips().count()) === before.length, '鍵をかけたのに分割できた')
    await v1Clips().nth(0).click()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(400)
    assert((await v1Clips().count()) === before.length, '鍵をかけたのに削除できた')
    await page.keyboard.press('Control+d')
    await page.waitForTimeout(400)
    assert((await v1Clips().count()) === before.length, '鍵をかけたのに複製できた')
    await lock.click()
    await page.waitForTimeout(300)
  })

  await check('一番下の音声の段に鍵をかけると、本編の波形も切れない', async () => {
    await resetProject()
    const lock = trackHead('A1').locator('button[title="ロック"]').first()
    const n0 = await v1Clips().count()
    const cutAudio = async () => {
      await page.keyboard.press('c')
      const audio = page.locator('[data-tid="A1"] .audio-clip:not(.se-ghost)').first()
      await audio.click({ position: { x: 40, y: 8 } })
      await page.waitForTimeout(400)
      await page.keyboard.press('v')
    }
    // ★先に「鍵なしなら切れる」ことを確かめる。切れないなら、鍵ではなく
    //   カッターが効いていないだけで合格してしまう。
    await cutAudio()
    assert(
      (await v1Clips().count()) === n0 + 1,
      '鍵なしでも切れない＝確認になっていない（カッターが効いていない疑い）'
    )
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
    assert((await v1Clips().count()) === n0, '確認の前に状態を戻せていない')

    await lock.click()
    await page.waitForTimeout(300)
    await cutAudio()
    assert((await v1Clips().count()) === n0, '音声側の鍵が効かず、本編が分割された')
    await lock.click()
    await page.waitForTimeout(300)
  })

  await check('元に戻したあと、音の波形が消えていない', async () => {
    await resetProject()
    const waveOf = async () =>
      page.locator('[data-tid="A1"] canvas').count()
    const w0 = await waveOf()
    assert(w0 > 0, 'そもそも波形が出ていない')
    await v1Clips().nth(0).click()
    await page.keyboard.press('f')
    await page.waitForTimeout(500)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(700)
    assert((await waveOf()) >= w0, `元に戻したら波形が消えた（${w0} → ${await waveOf()}）`)
  })

  await check('トラックの追加も元に戻せる', async () => {
    const n0 = await page.locator('[data-tid]').count()
    await page.locator('.th-add').first().click()
    await page.waitForTimeout(500)
    assert((await page.locator('[data-tid]').count()) > n0, 'トラックが増えていない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)
    assert((await page.locator('[data-tid]').count()) === n0, '元に戻していない')
  })

  await check('トラックを追加すると、番号順の正しい位置に入る', async () => {
    await page.locator('.th-add').first().click() // 映像トラックを追加
    await page.waitForTimeout(500)
    const ids = await page.locator('[data-tid]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-tid') ?? '')
    )
    const vs = ids.filter((i) => i.startsWith('V')).map((i) => Number(i.slice(1)))
    assert(
      JSON.stringify(vs) === JSON.stringify([...vs].sort((a, b) => b - a)),
      `映像トラックの並びが番号順でない: ${vs.join(',')}`
    )
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  // =========================================================================
}
