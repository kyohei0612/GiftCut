// 設定のコピー＆貼り付けと、種類ごとの色
//
// 章: 設定のコピーと貼り付け（プレミアの属性ペースト相当） / 15. クリップの色分け（種類ごと）
//
// **通しの本体は e2e/run.mjs から分けてある。** 1ファイル7,400行だと、
// 直したい章を探すのに毎回全部を読むことになり、足す場所も決まらないので
// 「仕上げ」に流れ込んでいた。道具（check・assert・素材づくり）は
// run.mjs 側に置いたままで、まとめて受け取る。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export default async function (C) {
  const {
    assert,
    check,
    fx,
    near,
    page,
    resetProject,
    section,
    seekTo,
    setDialogFiles,
    shotDir,
    similarity,
    v1Clips,
  } = C
  section('設定のコピーと貼り付け（プレミアの属性ペースト相当）')
  await resetProject()

  await check('テロップの見た目を変えると、プレビューにもすぐ出る', async () => {
    // 見た目まわりは確認が1つも無かった。ここが空いていると、
    // 「設定は変わったのに画面は変わらない」に誰も気づけない。
    await resetProject()
    await page.locator('.telop-clip').first().click()
    await page.waitForTimeout(400)
    await seekTo(2)
    const shown = page.locator('.telop-overlay .telop-textmain').first()
    assert(await shown.count(), 'プレビューに文字が出ていない')
    // 文字の大きさは cqh（画面の高さ基準）で指定されているので、
    // 計算後の font-size ではなく**実際に描かれた高さ**で見る
    const sizeOf = async () => (await shown.boundingBox())?.height ?? 0
    const before = await sizeOf()
    assert(before > 0, '文字の大きさが取れない')
    // 文字の大きさを変える。**つまみ（range）ではなく数値の欄**を使う
    // （range は普通の入力では動かない）。行が複数あるので、数値欄を持つ行を選ぶ。
    const row = page
      .locator('.sp-row')
      .filter({ hasText: 'サイズ' })
      .filter({ has: page.locator('input.sp-num') })
      .first()
    const num = row.locator('input.sp-num').first()
    assert(await num.count(), '文字の大きさの入力が見つからない')
    // 入力の数字は「1080基準の大きさ」で、画面上の高さとは基準が違う。
    // いまの値を読んでから増やす（画面の高さを渡すと、逆に小さくなる）
    const cur = Number(await num.inputValue())
    assert(cur > 0, `文字の大きさを読めない（${cur}）`)
    await num.fill(String(Math.round(cur * 1.8)))
    await num.press('Enter')
    await page.waitForTimeout(600)
    const after = await sizeOf()
    assert(after > before * 1.2, `大きさを変えてもプレビューが変わらない（${before} → ${after}）`)
  })

  await check('変えた見た目は、保存して開き直しても残っている', async () => {
    // クリップの色が保存で消えた前科がある（読み込みの許可リスト漏れ）。
    // 見た目の項目は数が多く、1つ漏れても気づけないので、実際に往復させる。
    //
    // 文字が画面に出ていないと測れない。出ている所まで再生ヘッドを動かす
    // （どこにいるかは前の項目次第なので、ここで自分で決める）。
    await seekTo(2)
    await page.waitForSelector('.telop-overlay .telop-textmain', { timeout: 8000 })
    const size = (await page.locator('.telop-overlay .telop-textmain').first().boundingBox())?.height ?? 0
    assert(size > 0, '文字がプレビューに出ていない')
    await page.keyboard.press('Control+s')
    await page.waitForTimeout(1600)
    // 開き直す
    await setDialogFiles([fx.gcproj], null)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(2500)
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) {
      await cont.click()
      await page.waitForTimeout(1500)
    }
    await seekTo(2)
    await page.waitForTimeout(600)
    const back = (await page.locator('.telop-overlay .telop-textmain').first().boundingBox())?.height ?? 0
    near(back, size, 2, `開き直したら文字の大きさが戻ってしまった（${size} → ${back}）`)
    // この項目は「保存したファイル」を開いた状態で終わる。そのままだと
    // 以降の項目が別の中身を見ることになるので、用意した状態へ戻しておく。
    await resetProject()
  })

  // ---- テロップの見た目（縁取り・影・フォント）----
  //
  // ここは確認が1つも無かった領域。DOM の細かい値を見ると測り方で転ぶので
  // （文字の大きさで実際に2回転んだ）、**画面を撮って見比べる**。
  // 「設定は入ったが見た目は変わらない」を確実に捕まえられる。
  /**
   * プレビューの**文字そのもの**を撮る。
   *
   * 映像ごと撮ると、文字は画面のごく一部なので、縁取りを足しても
   * 一致度が 1.0000 のままになる（実際にそれで「不具合だ」と誤認した）。
   * 見たいのは文字なので、文字の要素だけを撮る。
   */
  /**
   * 見た目を比べる範囲。**先に決めて、前後で同じ範囲を撮る。**
   * 文字の要素そのものを撮ると、大きさが変わったときに画像の寸法も変わり、
   * 比べられなくなる（実際に「比べられなかった」で落ちた）。
   */
  const telopRegion = async () => {
    const b = await page.locator('.telop-overlay .telop-textmain').first().boundingBox()
    assert(b, '文字の位置が取れない')
    const pad = 24
    return {
      x: Math.max(0, Math.round(b.x - pad)),
      y: Math.max(0, Math.round(b.y - pad)),
      width: Math.round(b.width + pad * 2),
      height: Math.round(b.height + pad * 2)
    }
  }
  const telopShot = async (label, clip) => {
    const f = join(shotDir, `telop-${label}.png`)
    await page.screenshot({ path: f, clip })
    return f
  }
  /** 見た目をいじる前に、文字が出ている状態にする */
  const readyTelop = async () => {
    await resetProject()
    // **先に再生位置を合わせてから選ぶ。** 逆にすると、目盛りを押した拍子に
    // 選択が外れ、見た目の設定が「次に作るテロップの既定」の方へ入ってしまう
    // （画面は何も変わらないので、アプリの不具合に見える）。
    await seekTo(2)
    await page.waitForTimeout(300)
    await page.locator('.telop-clip').first().click()
    await page.waitForTimeout(400)
    assert(await page.locator('.telop-overlay .telop-textmain').count(), 'プレビューに文字が出ていない')
    // **選べていないと、見た目の設定は「次に作るテロップの既定」の方へ入る。**
    // 画面は何も変わらないので、アプリの不具合と見分けが付かなくなる。
    assert(
      await page.locator('.telop-clip.clip-selected').count(),
      'テロップを選べていない（この確認が成立していない）'
    )
  }

  await check('縁取りを太くすると、プレビューの見た目が変わる', async () => {
    // 「足す」だけだと、元から太い縁があるぶん変化がごく小さく（一致度0.9999）、
    // 効いているのに落ちる。**太さを大きく変えて**、確実に見える差を作る。
    await readyTelop()
    const reg = await telopRegion()
    const before = await telopShot('stroke-before', reg)
    const row = page
      .locator('.sp-row')
      .filter({ has: page.locator('.sp-color[title="縁の色"]') })
      .first()
    assert(await row.count(), '縁取りの行が無い')
    const num = row.locator('input.sp-num').first()
    assert(await num.count(), '縁取りの太さの入力が無い')
    const cur = Number(await num.inputValue())
    await num.fill(String(Math.max(20, Math.round((cur || 5) * 4))))
    await num.press('Enter')
    await page.waitForTimeout(800)
    const after = await telopShot('stroke-after', reg)
    const sim = await similarity(before, after)
    assert(sim < 0.99, )
  })

  await check('影を足すと、プレビューの見た目が変わる', async () => {
    await readyTelop()
    const reg = await telopRegion()
    const before = await telopShot('shadow-before', reg)
    const add = page.locator('.sp-add[title="シャドウを追加"]').first()
    assert(await add.count(), '影を足すボタンが無い')
    await add.click()
    await page.waitForTimeout(700)
    const after = await telopShot('shadow-after', reg)
    const sim = await similarity(before, after)
    assert(sim < 0.999, `影を足しても見た目が変わらない（一致度 ${sim.toFixed(4)}）`)
  })

  await check('フォントを変えると、プレビューの見た目が変わる', async () => {
    await readyTelop()
    const reg = await telopRegion()
    const before = await telopShot('font-before', reg)
    const sel = page.locator('.sp-select').first()
    assert(await sel.count(), 'フォントの選択が無い')
    const opts = await sel.locator('option').all()
    assert(opts.length >= 2, 'フォントの選択肢が1つしかない')
    const cur = await sel.inputValue()
    let picked = null
    for (const o of opts) {
      const v = await o.getAttribute('value')
      if (v && v !== cur) {
        picked = v
        break
      }
    }
    assert(picked, '別のフォントが選べない')
    await sel.selectOption(picked)
    await page.waitForTimeout(900)
    const after = await telopShot('font-after', reg)
    const sim = await similarity(before, after)
    assert(sim < 0.999, `フォントを変えても見た目が変わらない（一致度 ${sim.toFixed(4)}）`)
  })

  await check('縁取り・影は、保存の中身に入っていて、開き直しても残っている', async () => {
    // クリップの色が保存で消えた前科がある（読み込みの許可リスト漏れ）。
    // 見た目は画面で比べると位置ずれに左右されるので、**保存された中身**を直接見る。
    await readyTelop()
    const strokeRows = () => page.locator('.sp-color[title="縁の色"]').count()
    const before = await strokeRows()
    await page.locator('.sp-add[title="ストロークを追加"]').first().click()
    await page.waitForTimeout(400)
    await page.locator('.sp-add[title="シャドウを追加"]').first().click()
    await page.waitForTimeout(700)
    const added = await strokeRows()
    assert(added > before, `縁取りが増えていない（${before} → ${added}）`)
    await page.keyboard.press('Control+s')
    await page.waitForTimeout(1800)
    // 保存された中身に入っているか（ここが抜けると、開き直したとき静かに消える）
    const saved = JSON.parse(readFileSync(fx.gcproj, 'utf-8'))
    const cue = (saved.cues ?? []).find((c) => c.style)
    assert(cue, '保存の中身にテロップの見た目が無い')
    assert(
      Array.isArray(cue.style.strokes) && cue.style.strokes.length >= added,
      `保存された縁取りが足りない（画面 ${added} / 保存 ${cue.style.strokes?.length}）`
    )
    assert(
      Array.isArray(cue.style.shadows) && cue.style.shadows.length >= 1,
      `保存に影が入っていない（${JSON.stringify(cue.style.shadows)}）`
    )
    // 開き直して、画面にも戻っているか
    await setDialogFiles([fx.gcproj], null)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(2500)
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) {
      await cont.click()
      await page.waitForTimeout(1500)
    }
    await seekTo(2)
    await page.waitForTimeout(400)
    await page.locator('.telop-clip').first().click()
    await page.waitForTimeout(600)
    const back = await strokeRows()
    assert(back >= added, `開き直したら縁取りが減っている（${added} → ${back}）`)
    await resetProject()
  })

  await check('テロップの位置をコピーして、他のテロップにも貼れる', async () => {
    // プレビュー上で1つ目のテロップを動かし、その位置を他へ写す
    await seekTo(2)
    const tel = page.locator('.telop-overlay > *').first()
    assert(await tel.count(), 'プレビューにテロップが出ていない')
    const b0 = await tel.boundingBox()
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2)
    await page.mouse.down()
    await page.mouse.move(b0.x + b0.width / 2 - 120, b0.y + b0.height / 2 - 90, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    const moved = await page.locator('.telop-overlay > *').first().boundingBox()

    await page.locator('.telop-clip').first().click()
    await page.keyboard.press('Control+Alt+c')
    await page.waitForTimeout(300)
    await page.locator('.telop-clip').nth(1).click()
    await page.keyboard.press('Control+Alt+v')
    await page.waitForTimeout(500)

    await seekTo(7) // 2つ目のテロップが映る時刻
    const b1 = await page.locator('.telop-overlay > *').first().boundingBox()
    assert(b1, '2つ目のテロップがプレビューに出ていない')
    near(b1.x, moved.x, 8, '貼り付けたのに位置が揃っていない')
    near(b1.y, moved.y, 8, '貼り付けたのに位置が揃っていない')
  })

  await check('テロップの設定を全部選んで貼っても、動画クリップは壊れない', async () => {
    const n0 = await v1Clips().count()
    await page.locator('.telop-clip').first().click()
    await page.keyboard.press('Control+Alt+c')
    await page.waitForTimeout(300)
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+Alt+v')
    await page.waitForTimeout(600)
    assert((await v1Clips().count()) === n0, '動画クリップの数が変わった')
  })

  await check('動画クリップの設定をコピーして、別の動画クリップに貼れる', async () => {
    await resetProject()
    await v1Clips().nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const sw = page.locator('.ctx-swatch:not(.ctx-swatch-none)').first()
    const want = await sw.evaluate((e) => getComputedStyle(e).backgroundColor)
    await sw.click()
    await page.waitForTimeout(400)
    await v1Clips().nth(0).click()
    await page.keyboard.press('Control+Alt+c')
    await page.waitForTimeout(300)
    await v1Clips().nth(2).click()
    await page.keyboard.press('Control+Alt+v')
    await page.waitForTimeout(500)
    const got = await v1Clips().nth(2).evaluate((el) => getComputedStyle(el).backgroundColor)
    assert(got === want, `貼り付いていない（${got} / 期待 ${want}）`)
  })

  await check('右クリックからも、コピーと「何が貼れるか」が分かる形で貼れる', async () => {
    // 何も設定されていないクリップからコピーすると、当然「設定なし」になる。
    // 見たいのは「何が貼れるかが名前で分かるか」なので、まず1つ設定を付ける。
    // （ここへ来るまでに何が設定済みかは、前の項目次第で変わる）
    await v1Clips().nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    await page.locator('.ctx-swatch:not(.ctx-swatch-none)').first().click()
    await page.waitForTimeout(400)

    await v1Clips().nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const copy = page.locator('.ctx-item', { hasText: '設定をコピー' })
    assert(await copy.count(), 'メニューに「設定をコピー」が無い')
    await copy.first().click()
    await page.waitForTimeout(300)
    await v1Clips().nth(1).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const paste = page.locator('.ctx-item', { hasText: '設定を貼り付け' })
    assert(await paste.count(), 'メニューに「設定を貼り付け」が無い')
    const label = await paste.first().textContent()
    assert(/色|変形|音量|切り抜き|不透明度/.test(label), `何が貼れるか出ていない: ${label}`)
    await page.keyboard.press('Escape')
  })

  // =========================================================================
  section('15. クリップの色分け（種類ごと）')
  await resetProject()

  await check('本編に色を付けると、映像と音声の両方に付く', async () => {
    await v1Clips().nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    await page.locator('.ctx-swatch:not(.ctx-swatch-none)').first().click()
    await page.waitForTimeout(400)
    const vBg = await v1Clips().nth(0).evaluate((el) => getComputedStyle(el).backgroundColor)
    const aBg = await page
      .locator('[data-tid="A1"] .audio-clip:not(.se-ghost)')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor)
    assert(vBg === aBg, `映像と音声で色が違う（${vBg} / ${aBg}）`)
  })

  await check('「色なし」を選ぶと元の色に戻る', async () => {
    const colored = await v1Clips().nth(0).evaluate((el) => getComputedStyle(el).backgroundColor)
    await v1Clips().nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    await page.locator('.ctx-swatch-none').first().click()
    await page.waitForTimeout(400)
    const plain = await v1Clips().nth(0).evaluate((el) => getComputedStyle(el).backgroundColor)
    assert(plain !== colored, '色なしにしても色が残っている')
  })

  await check('文字・効果音・画像にも色を付けられる', async () => {
    let i = 0
    for (const [name, sel] of [
      ['文字', '.telop-clip'],
      ['効果音', '.se-clip'],
      ['画像', '.img-clip:not(.se-ghost)']
    ]) {
      const el = page.locator(sel).first()
      await el.click({ button: 'right' })
      await page.waitForSelector('.ctx-menu')
      const sw = page.locator('.ctx-swatch:not(.ctx-swatch-none)').nth(i++ % 3)
      assert(await sw.count(), `${name} のメニューに色の選択肢が無い`)
      const want = await sw.evaluate((e) => getComputedStyle(e).backgroundColor)
      await sw.click()
      await page.waitForTimeout(400)
      const after = await el.evaluate((e) => getComputedStyle(e).backgroundColor)
      assert(after === want, `${name} に選んだ色が付いていない（${after} / 選んだ色 ${want}）`)
    }
  })

  // =========================================================================
}
