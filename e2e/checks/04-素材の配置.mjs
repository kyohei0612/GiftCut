// 素材ビンからタイムラインへ置く
//
// 章: 3. 素材のドラッグと「置けません」マーク
//
// **通しの本体は e2e/run.mjs から分けてある。** 1ファイル7,400行だと、
// 直したい章を探すのに毎回全部を読むことになり、足す場所も決まらないので
// 「仕上げ」に流れ込んでいた。道具（check・assert・素材づくり）は
// run.mjs 側に置いたままで、まとめて受け取る。

export default async function (C) {
  const {
    binCardReady,
    dndFromBin,
    assert,
    check,
    clipLayout,
    page,
    resetProject,
    section,
  } = C
  section('3. 素材のドラッグと「置けません」マーク')
  await resetProject()

  /** 素材ビンのカード。しまわれている種類は先に開く。 */
  // binCardReady は章をまたいで使うので e2e/run.mjs にある
  const binCard = (name) => page.locator('.media-card', { hasText: name }).first()
  /**
   * 素材ビンからのドラッグを再現する。
   * 掴む（dragstart）→ 重ねる（dragover）→ 離す（drop）を実際のイベントで送る。
   * 戻り値の prevented が false なら、その場所は「置けません」＝駐禁が出ている。
   */
  // dndFromBin は章をまたいで使うので e2e/run.mjs にある

  await check('素材はまとめて選べる（Ctrl で足し引き・Shift で範囲）', async () => {
    // **1つずつしか選べなかった。** プロジェクトに素材が何本もあるとき、
    // まとめて選んでまとめて置けないと、1本ずつ運ぶことになる。
    //
    // **押した順を覚えるのが要点**（まとめて置いたときにその順で並べるため）。
    // ここでは「選べる／外せる／範囲で入る」までを見る。
    await resetProject()
    const cards = page.locator('.media-card')
    const n = await cards.count()
    assert(n >= 3, `素材が3つ以上ないと確かめられない（${n}個）`)
    const sel = () => page.locator('.media-card.media-sel').count()

    await cards.nth(0).click()
    await page.waitForTimeout(200)
    assert((await sel()) === 1, `1つ押して1つ選ばれない（${await sel()}個）`)

    // Ctrl で足す
    await cards.nth(1).click({ modifiers: ['Control'] })
    await page.waitForTimeout(200)
    assert((await sel()) === 2, `Ctrl+クリックで足せない（${await sel()}個）`)

    // Ctrl でもう一度押すと外れる
    await cards.nth(1).click({ modifiers: ['Control'] })
    await page.waitForTimeout(200)
    assert((await sel()) === 1, `Ctrl+クリックで外せない（${await sel()}個）`)

    // Shift で範囲（並んでいる順にまとめて入る）
    await cards.nth(2).click({ modifiers: ['Shift'] })
    await page.waitForTimeout(200)
    assert((await sel()) === 3, `Shift+クリックで範囲にならない（${await sel()}個）`)

    // 普通に押したら1つに戻る
    await cards.nth(0).click()
    await page.waitForTimeout(200)
    assert((await sel()) === 1, `普通のクリックで1つに戻らない（${await sel()}個）`)
  })

  await check('まとめて選んだ素材は、その順に続けて並ぶ', async () => {
    // **1本ずつ運ぶしかなかった。** 何本もあるとき、選んでまとめて置けないと
    // 置く→戻る→次を掴む、をひたすら繰り返すことになる。
    //
    // **続けて並ぶ（重ならない）ことまで見る。** 同じ所へ2つ落とすと
    // 上に乗るだけで、置いたつもりが1つしか無いように見える。
    await resetProject()
    const before = await page.locator('.img-clip').count()
    const cards = page.locator('.media-card')
    // 画像は2枚ある。まとめて選ぶ
    const imgs = page.locator('.media-card', { hasText: '.png' })
    const n = await imgs.count()
    assert(n >= 2, `画像が2枚ないと確かめられない（${n}枚）`)
    await imgs.nth(0).click()
    await imgs.nth(1).click({ modifiers: ['Control'] })
    await page.waitForTimeout(300)
    assert(
      (await page.locator('.media-card.media-sel').count()) === 2,
      'まとめて選べていない'
    )
    // 選んだうちの1枚を掴んで落とす → 2枚とも置かれるはず
    const name = (await imgs.nth(0).innerText()).split('\n')[0].trim()
    await dndFromBin(name, '[data-tid="V3"]', { x: 160, y: 10 })
    await page.waitForTimeout(2500)
    const after = await page.locator('.img-clip').count()
    assert(
      after - before === 2,
      `まとめて置けていない（増えたのは ${after - before} 枚。2枚のはず）`
    )
    // 続けて並んでいる＝重なっていない。
    // **元からあった画像まで数えない**（置く前から居る物と重なるのは当たり前）。
    // 落とした先はいちばん右なので、右の2つだけを見る
    const boxes = await page.locator('.img-clip').evaluateAll((els) =>
      els
        .map((e) => {
          const r = e.getBoundingClientRect()
          return { l: Math.round(r.left), r: Math.round(r.right) }
        })
        .sort((a, b) => a.l - b.l)
    )
    const [a, b] = boxes.slice(-2)
    assert(
      a && b && b.l >= a.r - 2,
      `置いた2枚が重なっている（${JSON.stringify(boxes.slice(-2))}）`
    )
    void cards
  })

  await check('タイムラインのどこに重ねても「置けません」にならない', async () => {
    for (const [where, sel, off] of [
      ['クリップの上', '[data-tid="V1"]', { x: 60, y: 10 }],
      ['段と段の境目', '.track-scroll', { x: 300, y: 1 }],
      ['一番下の余白', '.track-scroll', { x: 300, y: 400 }],
      ['ルーラーの上', '.ruler', { x: 300, y: 5 }]
    ]) {
      const r = await dndFromBin('test_image', sel, off)
      assert(r.ghost, `${where} で、掴んだ素材の影が出なかった（アプリが認識していない）`)
      assert(r.prevented, `${where} で「置けません」になった`)
      await page.keyboard.press('Control+z')
      await page.waitForTimeout(200)
    }
  })

  await check('段の外で離しても、一番近い段に置かれる（消えない）', async () => {
    const n0 = await page.locator('.img-clip:not(.se-ghost)').count()
    await dndFromBin('test_image', '.track-scroll', { x: 400, y: 400 })
    await page.waitForTimeout(400)
    const n1 = await page.locator('.img-clip:not(.se-ghost)').count()
    assert(n1 > n0, `画像が置かれなかった（${n0} → ${n1}）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
  })

  await check('一番下の余白へ動画を落としても、本編が上書きされない', async () => {
    const before = await clipLayout()
    const r = await dndFromBin('test_video', '.track-scroll', { x: 200, y: 400 })
    assert(r.ghost, '掴んだ動画の影が出なかった（この確認が空振りになる）')
    await page.waitForTimeout(600)
    const after = await clipLayout()
    assert(
      after.length === before.length && Math.abs(after[0].w - before[0].w) < 3,
      '本編のクリップが書き換えられた'
    )
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
  })

  await check('タイムライン内のどの高さでも「置けません」にならない（段の境目を含む）', async () => {
    // 段と段の境目・グループの切れ目など、1pxでも受け付けない帯があると
    // そこだけ 🚫 が出て「置けない場所」に見える。全部の高さを刻んで確かめる。
    await binCardReady('test_video')
    await page.evaluate((name) => {
      const card = [...document.querySelectorAll('.media-card')].find((e) =>
        (e.textContent ?? '').includes(name)
      )
      window.__dt = new DataTransfer()
      card.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dt })
      )
    }, 'test_video')
    const bad = await page.evaluate(() => {
      const out = []
      // ウィンドウ全体を細かく網羅する。タイムラインの中だけでなく、
      // パネルの境目やトラック名の列も含めて「どこでも置ける」ことを確かめる。
      //
      // dragenter も見るのが要点。HTML5 のドラッグは dragenter と dragover の
      // 両方で受け入れを宣言しないと、要素をまたぐ一瞬だけ 🚫 が出る。
      // dragover だけ見ていると、この「行き来すると出る」型を見逃す。
      let prev = null
      for (let y = 2; y < window.innerHeight; y += 3) {
        for (let x = 4; x < window.innerWidth; x += 20) {
          const el = document.elementFromPoint(x, y)
          if (!el) continue
          const mk = (type) =>
            new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
              dataTransfer: window.__dt
            })
          // 要素が変わった＝またいだ瞬間。ここで dragenter が飛ぶ。
          if (el !== prev) {
            const enter = mk('dragenter')
            el.dispatchEvent(enter)
            if (!enter.defaultPrevented) {
              out.push({ x, y, ev: 'dragenter', tag: (el.className || el.tagName).toString().slice(0, 34) })
            }
            prev = el
          }
          const over = mk('dragover')
          el.dispatchEvent(over)
          if (!over.defaultPrevented) {
            out.push({ x, y, ev: 'dragover', tag: (el.className || el.tagName).toString().slice(0, 34) })
          }
        }
      }
      return out
    })
    await page.evaluate(() => {
      document.querySelector('.app').dispatchEvent(new DragEvent('dragend', { bubbles: true }))
    })
    assert(
      bad.length === 0,
      `受け付けない場所がある(${bad.length}点): ${bad.slice(0, 6).map((b) => `(${b.x},${b.y}) ${b.ev} ${b.tag}`).join(" / ")}`
    )
  })

  await check('タイムラインの外へ出ても、置き先の影が消えない', async () => {
    // 外れた瞬間に影が消えると、置けないのか場所が悪いのか分からなくなる
    for (const [where, sel, off] of [
      ['トラック名の列', '.th', { x: 20, y: 10 }],
      ['プレビュー', '.panel.monitor', { x: 200, y: 150 }],
      ['右のパネル', '.panel:not(.monitor)', { x: 60, y: 200 }],
      ['メニューバー', '.menubar', { x: 40, y: 5 }]
    ]) {
      await binCardReady('test_video')
      await page.evaluate((name) => {
        const card = [...document.querySelectorAll('.media-card')].find((e) =>
          (e.textContent ?? '').includes(name)
        )
        window.__dt = new DataTransfer()
        card.dispatchEvent(
          new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dt })
        )
      }, 'test_video')
      const prevented = await page.evaluate(
        ({ sel, ox, oy }) => {
          const el = document.querySelectorAll(sel)[0]
          if (!el) throw new Error('見つからない: ' + sel)
          const b = el.getBoundingClientRect()
          const ev = new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            clientX: b.x + ox,
            clientY: b.y + oy,
            dataTransfer: window.__dt
          })
          el.dispatchEvent(ev)
          return ev.defaultPrevented
        },
        { sel, ox: off.x, oy: off.y }
      )
      await page.waitForTimeout(200)
      assert(prevented, `${where} の上で「置けません」になった`)
      assert((await page.locator('.se-ghost').count()) > 0, `${where} の上で置き先の影が消えた`)
      await page.evaluate(() => {
        document.querySelector('.app').dispatchEvent(new DragEvent('dragend', { bubbles: true }))
      })
      await page.waitForTimeout(150)
      assert((await page.locator('.se-ghost').count()) === 0, 'やめたのに影が残っている')
    }
  })

  await check('素材ビンの中へ戻すと、何も置かれない（やめた扱い）', async () => {
    const n0 = await page.locator('.img-clip:not(.se-ghost)').count()
    await dndFromBin('test_image', '.panel:not(.monitor)', { x: 40, y: 40 })
    await page.waitForTimeout(400)
    const n1 = await page.locator('.img-clip:not(.se-ghost)').count()
    assert(n1 === n0, '素材置き場に戻したのにタイムラインへ置かれた')
  })

  await check('まだ無い段の位置へ動画を落とすと、その段と対の音声段が作られる', async () => {
    const v0 = await page.locator('[data-tid]').count()
    // 一番上の映像段より上（ルーラーのすぐ下）へ落とす
    await dndFromBin('test_video', '.track-scroll', { x: 300, y: 400 })
    await page.waitForTimeout(800)
    const ids = await page.locator('[data-tid]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-tid'))
    )
    assert(ids.length >= v0, '段が減った')
    // 映像段があれば、同じ番号の音声段も必ずある
    for (const id of ids.filter((i) => i.startsWith('V') && i !== 'V1')) {
      const pair = 'A' + id.slice(1)
      assert(ids.includes(pair), `${id} に対する ${pair} が作られていない`)
    }
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
  })

  // =========================================================================
}
