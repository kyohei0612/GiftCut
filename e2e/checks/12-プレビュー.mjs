// プレビューでの直接操作・上書き・重ね順
//
// 章: 6-8. プレビュー操作・文字・重ねた動画
//
// **通しの本体は e2e/run.mjs から分けてある。** 1ファイル7,400行だと、
// 直したい章を探すのに毎回全部を読むことになり、足す場所も決まらないので
// 「仕上げ」に流れ込んでいた。道具（check・assert・素材づくり）は
// run.mjs 側に置いたままで、まとめて受け取る。

export default async function (C) {
  const {
    placePiP,
    assert,
    check,
    page,
    resetProject,
    section,
    seekTo,
    v1Clips,
  } = C
  section('6-8. プレビュー操作・文字・重ねた動画')
  await resetProject()

  /** 重ねた動画を V2 に1つ用意する（無いと章8が確認できない） */
  // placePiP は章をまたいで使うので e2e/run.mjs にある

  await check('プレビューで、画像も重ねた動画も無い所を掴むと本編の映像が動く', async () => {
    // 前の項目が残した状態（クリップが増えている・再生位置が違う）に
    // 頼っていて、絞って回すと落ちていた。自分で用意する。
    await resetProject()
    await seekTo(12) // 画像は 1〜5秒。そこを外す
    const vid = page.locator('.screen-video').first()
    const before = await vid.evaluate((el) => el.style.transform)
    const box = await vid.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    const after = await vid.evaluate((el) => el.style.transform)
    assert(after !== before, `本編の映像が動いていない（${before}）`)
  })

  await check('掴めるものにマウスを乗せると、名前が吹き出しで出る', async () => {
    await seekTo(3) // 画像が映っている時刻
    const img = page.locator('.screen-img').first()
    assert(await img.count(), 'プレビューに画像が出ていない')
    const title = await img.getAttribute('title')
    assert(title && title.includes('test_image'), `名前が出ていない: ${title}`)
  })

  await check('プレビューで文字を動かすと、選んである他の文字も一緒に動く', async () => {
    // まとめて選んで、まとめて下げる。1つずつ動かして目分量で揃え直すのは無理がある。
    // **元の位置関係は崩さない**（同じ場所へ集めない）ことも一緒に見る。
    await resetProject()
    await seekTo(1)
    const posOf = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.telop-box')]
          .slice(0, 3)
          .map((el) => {
            const r = el.getBoundingClientRect()
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
          })
      )
    // 同じ時刻に文字が2つ要る。**素材任せにしない**（無ければ飛ばす、にすると
    // 中身を確かめないまま緑になる）。ここで作る。T をもう一度押すと1段上にできる。
    await page.keyboard.press('t')
    await page.waitForTimeout(400)
    await page.keyboard.press('t')
    await page.waitForTimeout(500)
    const before = await posOf()
    assert(before.length >= 2, `同じ時刻に文字を2つ作れなかった（${before.length}個）`)
    // 2つとも選ぶ（タイムライン上の文字クリップを Ctrl 付きで足す）
    const clips = page.locator('.telop-clip')
    await clips.nth(0).click()
    await clips.nth(1).click({ modifiers: ['Control'] })
    await page.waitForTimeout(300)
    // プレビュー上の1つ目を掴んで下へ
    const t0 = page.locator('.telop-box').first()
    const b = await t0.boundingBox()
    assert(b, 'プレビューに文字が見つからない')
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 6; i++) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - (60 * i) / 6)
    await page.mouse.up()
    await page.waitForTimeout(400)
    const after = await posOf()
    const d0 = before[0].y - after[0].y
    const d1 = before[1].y - after[1].y
    assert(d0 > 20, `掴んだ文字が動いていない（${d0}px）`)
    assert(d1 > 20, `選んである他の文字が付いてこない（掴んだ方 ${d0}px / 他 ${d1}px）`)
    // 同じだけ動く＝元の位置関係が崩れていない
    assert(
      Math.abs(d0 - d1) <= 4,
      `一緒に動いてはいるが、ずれ方が違う（${d0}px と ${d1}px）`
    )
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('文字を選んで切ると、下地の動画にはカット点が増えない', async () => {
    // 「何も選んでいない＝全部／選んでいる＝その物だけ」の後半。
    // ここが効いていないと、文字を切るたびに本編へ余計なカット点が増える。
    await resetProject()
    await seekTo(7)
    const vClips = () => page.locator('[data-tid="V1"] .video-clip:not(.se-ghost)').count()
    const telops = () => page.locator('.telop-clip').count()
    // 再生ヘッドの上にある文字を選ぶ
    const cue = page.locator('.telop-clip').first()
    assert(await cue.count(), '文字が無い')
    await cue.click()
    await page.waitForTimeout(300)
    const v0 = await vClips()
    const t0 = await telops()
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(600)
    assert(
      (await vClips()) === v0,
      `文字を選んで切ったのに、動画にもカット点が増えた（${v0} → ${await vClips()}）`
    )
    // 文字のほうは、再生ヘッドがその文字の中にあれば増える
    const t1 = await telops()
    assert(t1 >= t0, `文字が減った（${t0} → ${t1}）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
  })

  await check('文字を分割すると、左右それぞれが残る', async () => {
    await resetProject()
    const n0 = await page.locator('.telop-clip').count()
    await page.locator('.telop-clip').first().click()
    await page.keyboard.press('c') // カッター
    await page.locator('.telop-clip').first().click({ position: { x: 20, y: 8 } })
    await page.waitForTimeout(500)
    await page.keyboard.press('v')
    assert((await page.locator('.telop-clip').count()) === n0 + 1, '文字が分割されていない')
    const widths = await page.locator('.telop-clip').evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect().width)
    )
    assert(widths.every((w) => w > 2), `幅0の文字ができた（${widths.map(Math.round).join(',')}）`)
  })

  await check('続けて何度でも、再生ヘッドで動画を切れる', async () => {
    // 1回目は切れるのに2回目から切れない、という不具合があった。
    // 分割してできたテロップが選択状態になり、次の Ctrl+K が
    // 「選択中のテロップだけ分割」に切り替わっていたため。
    await resetProject()
    const n0 = await v1Clips().count()
    for (const sec of [1.5, 2.5, 3.5]) {
      await seekTo(sec)
      await page.keyboard.press('Control+k')
      await page.waitForTimeout(350)
    }
    const n1 = await v1Clips().count()
    assert(
      n1 === n0 + 3,
      `3回切ったのにクリップが ${n0} → ${n1} 個（${n0 + 3} 個のはず。2回目以降が効いていない）`
    )
  })

  await check('プレビューの文字をダブルクリックすると、その場で打ち直せる', async () => {
    await resetProject()
    await seekTo(2)
    const tel = page.locator('.telop-overlay > *').first()
    assert(await tel.count(), 'プレビューに文字が出ていない')
    await tel.dblclick()
    await page.waitForTimeout(500)
    const editor = page.locator('.telop-editor textarea, .telop-editor input')
    assert(await editor.count(), 'その場で打ち直す欄が出ない')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  })

  await check('重ねた動画に、拡大・不透明度・回転・色調整・切り抜きが全部ある', async () => {
    await resetProject()
    await placePiP()
    await page.locator('[data-tid="V2"] .clip:not(.se-ghost)').first().click()
    await page.waitForTimeout(500)
    const panel = await page.locator('.panel').first().textContent()
    for (const label of ['拡大', '不透明度', '回転', '色調整', 'クロップ']) {
      assert(panel.includes(label), `右パネルに「${label}」が無い: ${panel.slice(0, 120)}`)
    }
  })

  await check('拡大のつまみを右端まで動かすと 800% まで行く', async () => {
    const sliders = page.locator('.sp-row input[type="range"]')
    const n = await sliders.count()
    assert(n > 0, 'つまみが出ていない')
    let max = null
    for (let i = 0; i < n; i++) {
      const m = await sliders.nth(i).getAttribute('max')
      if (m && Number(m) >= 8) {
        max = Number(m)
        break
      }
    }
    assert(max !== null, `拡大のつまみが見つからない（上限が8以上のものが無い）`)
    assert(max >= 8, `上限が 800% になっていない（${max * 100}%）`)
  })

  await check('「変形・調整をリセット」で設定が元に戻る', async () => {
    const clip = page.locator('[data-tid="V2"] .clip:not(.se-ghost)').first()
    await clip.click()
    await page.waitForTimeout(400)
    // プレビューで動かして変形を付ける
    await seekTo(1)
    const pip = page.locator('.screen-vclip').first()
    // **要る物が無いときは、そう言って落ちる。**
    // 絞って回すと V2 に重ねた動画が置かれていないことがあり、
    // そのままだと「8秒待って時間切れ」としか出ない＝毎回原因を調べ直すことになる
    assert(
      await pip.count(),
      'プレビューに重ねた動画が出ていない（この項目は V2 に重ねた動画が要ります。絞って回すと前段の配置が飛びます）'
    )
    {
      const b = await pip.boundingBox()
      if (b) {
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
        await page.mouse.down()
        await page.mouse.move(b.x + b.width / 2 + 70, b.y + b.height / 2, { steps: 5 })
        await page.mouse.up()
        await page.waitForTimeout(400)
      }
    }
    const moved = await page.locator('.screen-vclip').first().evaluate((el) => el.style.transform)
    const reset = page.locator('button', { hasText: 'リセット' }).first()
    assert(await reset.count(), '「リセット」のボタンが無い')
    await reset.click()
    await page.waitForTimeout(500)
    const after = await page.locator('.screen-vclip').first().evaluate((el) => el.style.transform)
    assert(after !== moved, `リセットしても変形が残っている（${after}）`)
  })

  await check('重ねた動画の音が、対の音声段に波形として並ぶ', async () => {
    // 前の項目が置いた動画に頼っていたので、絞って回すと必ず落ちていた
    // （置かれていない＝波形が無い、を不具合として報告してしまう）。自分で置く。
    await placePiP()
    const wave = await page.locator('[data-tid="A2"] canvas').count()
    assert(wave > 0, '対の音声段に波形が出ていない')
  })

  // =========================================================================
}
