// クリップを掴む・切る・詰める・段を扱う
//
// 章: 4. クリップを掴んで動かす / 6. プレビュー画面での直接操作 / 無音カット（喋っていない所をまとめて切る） / 10. リップル削除（消して後ろを詰める） / 5. 選ぶ操作とキー操作 / 7. 文字（テロップ） / 11. トラック（段）
//
// **通しの本体は e2e/run.mjs から分けてある。** 1ファイル7,400行だと、
// 直したい章を探すのに毎回全部を読むことになり、足す場所も決まらないので
// 「仕上げ」に流れ込んでいた。道具（check・assert・素材づくり）は
// run.mjs 側に置いたままで、まとめて受け取る。

export default async function (C) {
  const {
    setSlider,
    trackHead,
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

  // =========================================================================
  section('無音カット（喋っていない所をまとめて切る）')
  await resetProject()

  /** つまみに値を入れる（range は普通の入力では動かない） */
  // setSlider は章をまたいで使うので e2e/run.mjs にある
  async function openSilence() {
    if (!(await page.locator('.sil-box').count())) {
      await page.locator('.tool-wide', { hasText: '無音カット' }).click()
      await page.waitForSelector('.sil-box', { timeout: 10000 })
    }
    // 確認用の素材は20秒で、無音も0.2〜0.36秒と短い。
    // 既定値のままでは1つも残らないので、ゆるめて使う（本来の流れもこれ）。
    await setSlider('これより静かなら無音', -25)
    await setSlider('この長さ以上を無音とみなす', 0.2)
    await setSlider('前後に残す余白', 0.02)
    await setSlider('これより短い所は切らない', 0.1)
    await page.locator('.btn', { hasText: '調べる' }).click()
    await page.waitForFunction(
      () => !(document.querySelector('.sil-result')?.textContent ?? '').includes('調べています'),
      { timeout: 60000 }
    )
  }
  const closeSilence = async () => {
    const btn = page.locator('.sil-box .btn', { hasText: '閉じる' })
    if (await btn.count()) await btn.click()
    await page.waitForTimeout(300)
  }
  /** いまの見積もり（合計秒） */
  const cutSecs = async () => {
    const t = await page.locator('.sil-result').textContent()
    const m = /合計 ([\d.]+) 秒/.exec(t)
    return m ? Number(m[1]) : 0
  }

  await check('無音カットは、切る前に「どこを何秒切るか」を出す', async () => {
    // いきなり切ると、何が起きたのか分からないまま尺が変わる
    await openSilence()
    const txt = await page.locator('.sil-result').textContent()
    assert(/か所/.test(txt), `切る前の見積もりが出ていない（${txt}）`)
    await closeSilence()
  })

  await check('余白の設定が効く（バツっと切るか、少し残すか）', async () => {
    // 「バツっと切りたい人」と「余白がほしい人」の両方がいるので設定にした。
    // 効いていないと、どちらの人にも同じ結果を返す。
    await openSilence()
    await setSlider('前後に残す余白', 0)
    await page.waitForTimeout(400)
    const none = await cutSecs()
    assert(none > 0, `余白なしでも切る所が無い（${none}秒）`)
    await setSlider('前後に残す余白', 0.12)
    await page.waitForTimeout(400)
    const wide = await cutSecs()
    assert(wide < none, `余白を広げたのに切る量が減っていない（${none}秒 → ${wide}秒）`)
    await closeSilence()
  })

  await check('無音カットを実行すると短くなり、元にも戻せる', async () => {
    await resetProject()
    const width = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-tid="V1"] .video-clip:not(.se-ghost)')].reduce(
          (a, e) => a + e.getBoundingClientRect().width,
          0
        )
      )
    await openSilence()
    await setSlider('前後に残す余白', 0)
    await page.waitForTimeout(400)
    const willCut = await cutSecs()
    assert(willCut > 0, '切る所が見つからない')
    const before = await width()
    await page.locator('.btn-primary', { hasText: '切って詰める' }).click()
    await page.waitForTimeout(2000)
    assert((await page.locator('.sil-box').count()) === 0, '実行しても設定画面が閉じない')
    const after = await width()
    assert(
      after < before - 5,
      `切ったのに短くなっていない（${Math.round(before)}px → ${Math.round(after)}px / ${willCut}秒ぶん）`
    )
    // まとめて切る操作は、戻せないと怖くて使えない
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(1000)
    near(await width(), before, 8, '元に戻したのに長さが戻っていない')
  })

  // =========================================================================
  section('10. リップル削除（消して後ろを詰める）')
  await resetProject()

  await check('効果音を右クリック →「リップル削除」が出る', async () => {
    await page.locator('.se-clip').first().click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const item = page.locator('.ctx-item', { hasText: 'リップル削除' })
    assert(await item.count(), 'メニューに「リップル削除」が無い')
    await page.keyboard.press('Escape')
  })

  await check('文字をリップル削除すると、同じ段の後ろだけが詰まる', async () => {
    const t0 = await page.locator('.telop-clip').nth(0).boundingBox()
    const t1 = await page.locator('.telop-clip').nth(1).boundingBox()
    await page.locator('.telop-clip').nth(0).click()
    await page.locator('.telop-clip').nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    await page.locator('.ctx-item', { hasText: 'リップル削除' }).first().click()
    await page.waitForTimeout(400)
    assert((await page.locator('.telop-clip').count()) === 1, '文字が1つになっていない')
    const rest = await page.locator('.telop-clip').first().boundingBox()
    assert(rest.x < t1.x - 5, `後ろの文字が前へ詰まっていない（${Math.round(t1.x)} → ${Math.round(rest.x)}）`)
    void t0
  })

  // =========================================================================
  section('5. 選ぶ操作とキー操作')
  await resetProject()

  await check('Ctrl+A で全部選んで Delete → 全部消える（トラックは消えない）', async () => {
    await page.locator('.track-scroll').click({ position: { x: 600, y: 30 } })
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Delete')
    await page.waitForTimeout(500)
    assert((await v1Clips().count()) === 0, '本編のクリップが残っている')
    assert((await page.locator('.telop-clip').count()) === 0, '文字が残っている')
    assert((await page.locator('[data-tid="V1"]').count()) === 1, 'トラックまで消えてしまった')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
    assert((await v1Clips().count()) > 0, 'Ctrl+Z で戻らない')
  })

  await check('空きがあっても、全部選んで消せば全部消える', async () => {
    // 空きが1つでも混じっていると、Delete が「空きを詰める」だけで止まり、
    // クリップが1つも消えないことがあった（選んでいる物の種類で動きが変わっていた）。
    // クリップを動かして空きを作ってから、全部選んで消す。
    await resetProject()
    await dragBy(v1Clips().nth(1), (await clipW()) * 0.5)
    await page.waitForTimeout(600)
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Delete')
    await page.waitForTimeout(600)
    assert((await v1Clips().count()) === 0, `本編のクリップが残っている`)
    assert((await page.locator('.telop-clip').count()) === 0, '文字が残っている')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)
  })

  await check('空きだけを選んだときは、今までどおり詰まる', async () => {
    // 上の直しで「空きを選んで Delete＝詰める」が効かなくなっていないかを見る
    await resetProject()
    await dragBy(v1Clips().nth(1), (await clipW()) * 0.5)
    await page.waitForTimeout(600)
    const before = await clipLayout()
    const gap = page.locator('.gap-clip').first()
    assert(await gap.count(), '空きができていない')
    await gap.click()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(600)
    const after = await clipLayout()
    assert(
      after.length === before.length && after[1].x < before[1].x - 5,
      `空きが詰まっていない（${before.map((c) => c.x)} → ${after.map((c) => c.x)}）`
    )
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)
  })

  await check('音量つまみを触った直後の矢印キーで、再生位置が動く（つまみが動かない）', async () => {
    await v1Clips().nth(0).click()
    await page.waitForTimeout(200)
    const slider = page.locator('.sp-row input[type="range"]').first()
    assert(await slider.count(), '右パネルにつまみが出ていない')
    // 再生位置は「再生ヘッドの左端の座標」で見る（表示形式に依存しない）
    const headX = async () =>
      page.locator('.playhead').first().evaluate((el) => el.getBoundingClientRect().x)
    const v0 = await slider.inputValue()
    await slider.click()
    const x0 = await headX()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(300)
    const v1 = await slider.inputValue()
    const x1 = await headX()
    assert(v0 === v1, `つまみの値が矢印キーで動いた（${v0} → ${v1}）`)
    assert(Math.abs(x1 - x0) > 0.5, '再生位置が動かなかった（矢印キーがつまみに取られている）')
  })

  /** 画像や重ねた動画が映っていない時刻へ再生位置を移す（プレビュー本体を掴めるように） */
  async function seekToBareVideo() {
    await seekTo(12) // 画像は 1〜5秒。そこを外した所へ
    assert(
      (await page.locator('.screen-img').count()) === 0,
      'プレビューに画像が出たままで、映像本体を掴めない'
    )
  }

  await check('プレビューをクリックして枠を出し、Escape で枠が消える', async () => {
    await seekToBareVideo()
    await page.locator('.screen-video').first().click({ position: { x: 30, y: 30 } })
    await page.waitForTimeout(250)
    const had = await page.locator('.reframe-box').count()
    assert(had > 0, 'プレビューをクリックしても枠が出ない')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
    assert((await page.locator('.reframe-box').count()) === 0, 'Escape で枠が消えない')
  })

  await check('枠が出た状態でタイムライン上をホイールしても、映像が拡大しない', async () => {
    await seekToBareVideo()
    await page.locator('.screen-video').first().click({ position: { x: 30, y: 30 } })
    await page.waitForTimeout(200)
    const before = await page.locator('.screen-video').first().evaluate((el) => el.style.transform)
    const tl = await page.locator('.track-scroll').boundingBox()
    // ★拡大は Ctrl（か Alt）を押しながらのホイール。ただのホイールは横スクロールなので、
    //   押さずに回すと「何も起きない＝映像も変わらない」で必ず合格してしまっていた。
    const tlW = () => page.locator('.track-inner').evaluate((e) => Math.round(e.getBoundingClientRect().width))
    const w0 = await tlW()
    await page.keyboard.down('Control')
    await page.mouse.move(tl.x + 300, tl.y + 60)
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, -120)
      await page.waitForTimeout(80)
    }
    await page.keyboard.up('Control')
    await page.waitForTimeout(300)
    const w1 = await tlW()
    assert(w1 > w0 * 1.1, `タイムラインが拡大していない＝確認になっていない（${w0} → ${w1}px）`)
    const after = await page.locator('.screen-video').first().evaluate((el) => el.style.transform)
    assert(before === after, `ホイールで映像が変わった（${before} → ${after}）`)
    await page.keyboard.press('Escape')
  })

  // =========================================================================
  section('7. 文字（テロップ）')
  await resetProject()

  await check('T キーで文字ができ、もう一度押すと1段上にできる', async () => {
    const n0 = await page.locator('.telop-clip').count()
    await page.locator('.track-scroll').click({ position: { x: 700, y: 30 } })
    await page.keyboard.press('t')
    await page.waitForTimeout(400)
    const n1 = await page.locator('.telop-clip').count()
    assert(n1 === n0 + 1, `文字が増えていない（${n0} → ${n1}）`)
    const onV2 = await page.locator('[data-tid="V2"] .telop-clip').count()
    assert(onV2 > 0, '上から2段目に作られていない')
    await page.keyboard.press('t')
    await page.waitForTimeout(400)
    const onV3 = await page.locator('[data-tid="V3"] .telop-clip').count()
    assert(onV3 > 0, '同じ位置で2回目を押しても1段上にできていない')
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  // =========================================================================
  section('11. トラック（段）')
  await resetProject()

  /** 指定した段のヘッダー（V1 / A1 など） */
  // trackHead は章をまたいで使うので e2e/run.mjs にある

  await check('トラック名をダブルクリックして名前を変えられる', async () => {
    const name = page.locator('.th-name').first()
    const before = await name.textContent()
    await name.dblclick()
    await page.waitForTimeout(300)
    const input = page.locator('.modal-input')
    assert(await input.count(), 'ダブルクリックしても名前の入力欄が出ない')
    await input.fill('テスト段')
    await page.locator('.modal-btn.primary').click()
    await page.waitForTimeout(300)
    // 段の頭は「番号＋名前」に分かれている（番号は切らせない作りにした）。
    // 見るのは名前の方。全体を見ると "V3テスト段" になって食い違う。
    const after = await page.locator('.th-label').first().textContent()
    assert(after === 'テスト段', `名前が変わっていない: ${before} → ${after}`)
    // 番号は残っている（どの段か分からなくならない）
    const id = await page.locator('.th-id').first().textContent()
    assert(id.trim().length > 0, '段の番号が消えた')
  })

  await check('トラック名をクリックしても、意味のない青い表示にならない', async () => {
    // 以前は「ターゲット」という、どこからも参照されない死んだ表示に占領されていた
    await page.locator('.th-name').first().click()
    await page.waitForTimeout(200)
    const cls = await page.locator('.th').first().getAttribute('class')
    assert(cls.includes('th-selected'), 'クリックしてもトラックが選択状態にならない')
  })

  // ---- 縦スクロールの追従 -------------------------------------------------
  // ここは一度壊している。縦に送れるようにしたのに見出し列を追従させず、
  // V1 の行に音の波形が出て、掴める段と見えている段が食い違って
  // クリップを移動できなくなった。**目で見て分かる形**で固定する。
  //
  // プレビューの枠を広げる＝タイムラインが縮む、なので、
  // 「縮めて入りきらない状態」を作ってから見る。
  const timelineVScroll = {
    /**
     * タイムラインを一番低くして、中身がはみ出す状態を作る。
     *
     * **必ず一度広げてから縮める。** 既に最小まで縮んでいると、下へ引いても
     * 高さが変わらず、伸び縮みの処理そのものが動かない
     * （動かないのを「効いていない」と読み違えて1回転んだ）。
     */
    async squeeze() {
      await dragBy(page.locator('.resizer-h').first(), 0, -400) // まず広げる
      await page.waitForTimeout(250)
      const before = await page.evaluate(
        () => document.querySelector('.timeline')?.getBoundingClientRect().height ?? 0
      )
      await dragBy(page.locator('.resizer-h').first(), 0, before) // 下へ目いっぱい＝最小まで縮む
      await page.waitForTimeout(300)
    },
    /** 段の行と、その見出しの、画面上での上端 */
    tops(id) {
      return page.evaluate((tid) => {
        const row = document.querySelector(`.track[data-tid="${tid}"]`)
        const head = [...document.querySelectorAll('.th')].find(
          (el) => el.querySelector('.th-id')?.textContent?.trim() === tid
        )
        const ruler = document.querySelector('.ruler')
        const sc = document.querySelector('.track-scroll')
        return {
          row: row ? Math.round(row.getBoundingClientRect().top) : null,
          head: head ? Math.round(head.getBoundingClientRect().top) : null,
          ruler: ruler ? Math.round(ruler.getBoundingClientRect().top) : null,
          over: sc ? sc.scrollHeight - sc.clientHeight : 0
        }
      }, id)
    },
    async scrollTo(y) {
      await page.evaluate((v) => {
        const el = document.querySelector('.track-scroll')
        if (el) el.scrollTop = v
      }, y)
      await page.waitForTimeout(250)
    },
    /** 映像と音声の境目が、いま見えている枠のどこに居るか */
    where() {
      return page.evaluate(() => {
        const sc = document.querySelector('.track-scroll')
        const a = document.querySelector('.track-audio')
        if (!sc || !a) return null
        const s = sc.getBoundingClientRect()
        return {
          rel: Math.round(a.getBoundingClientRect().top - s.top), // 枠の上端から境目まで
          view: Math.round(s.height),
          over: sc.scrollHeight - sc.clientHeight,
          top: Math.round(sc.scrollTop)
        }
      })
    }
  }

  await check('タイムラインを縮めると、中身は縦に送れるようになる', async () => {
    await timelineVScroll.squeeze()
    const st = await timelineVScroll.tops('V1')
    assert(st.over > 0, `縮めたのに送り分が無い（はみ出し ${st.over}px）`)
  })

  await check('縦に送っても、段の見出しが行についてくる', async () => {
    // 縮めた時点で既に真ん中へ送られている（境目を残す動き）ので、
    // 「最初は先頭」と決めつけない。**送る前の位置を自分で作る。**
    await timelineVScroll.scrollTo(0)
    const before = await timelineVScroll.tops('V1')
    assert(before.row != null && before.head != null, 'V1 の行か見出しが見つからない')
    // 行と見出しは、送る前は同じ高さに並んでいる
    near(before.head, before.row, 2, '送る前から行と見出しがずれている')
    await timelineVScroll.scrollTo(60)
    const after = await timelineVScroll.tops('V1')
    near(
      before.row - after.row,
      60,
      2,
      `送った量と行の動きが合わない（${before.row} → ${after.row}／送った量 60px）`
    )
    // ここが本体。**見出しだけ残ると、V1 の行に別の段の中身が見える。**
    near(
      after.head,
      after.row,
      2,
      `行と見出しがずれた（行 ${after.row} / 見出し ${after.head}）＝掴める段と見えている段が食い違う`
    )
  })

  // **段に置いた物は、段に固定されない。**
  // 置いたら最後その段から動かせない、という状態が長く続いていた（本人から
  // 「レーン固定で他レーンに動かせなかった」）。掴んで縦に振れば移せる。
  // 上下の動きは種類ごとに別々の仕掛け（テロップ＝state/useTimelineDrag、
  // 画像＝state/useClipDrag）なので、**両方見る**。片方だけ直っても気づけない。
  await check('テロップを縦に振ると、別の段へ移せる（往復とも）', async () => {
    await resetProject()
    const rowY = async (id) => (await page.locator(`[data-tid="${id}"]`).boundingBox()).y
    const dy = (await rowY('V3')) - (await rowY('V2')) // 上へ（負）
    assert(Math.abs(dy) > 5, `段の高さが取れない（${dy}）`)
    const n2 = await page.locator('[data-tid="V2"] .telop-clip').count()
    const n3 = await page.locator('[data-tid="V3"] .telop-clip').count()
    assert(n2 > 0, 'V2 に文字が無い状態から始まっている')

    await dragBy(page.locator('[data-tid="V2"] .telop-clip').first(), 0, dy)
    await page.waitForTimeout(500)
    const up3 = await page.locator('[data-tid="V3"] .telop-clip').count()
    assert(up3 === n3 + 1, `上の段へ移っていない（V3 が ${n3} → ${up3}）`)

    // 戻せないと「片道だけ動く」状態に気づけない
    await dragBy(page.locator('[data-tid="V3"] .telop-clip').first(), 0, -dy)
    await page.waitForTimeout(500)
    const back2 = await page.locator('[data-tid="V2"] .telop-clip').count()
    assert(back2 === n2, `元の段へ戻せない（V2 が ${n2} → ${back2}）`)
  })

  await check('画像も別の段へ移せる', async () => {
    await resetProject()
    const rowY = async (id) => (await page.locator(`[data-tid="${id}"]`).boundingBox()).y
    const dy = (await rowY('V2')) - (await rowY('V3')) // 下へ（正）
    const img = page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)')
    assert(await img.count(), 'V3 に画像が無い状態から始まっている')
    const before = await page.locator('[data-tid="V2"] .img-clip:not(.se-ghost)').count()
    await dragBy(img.first(), 0, dy)
    await page.waitForTimeout(500)
    const after = await page.locator('[data-tid="V2"] .img-clip:not(.se-ghost)').count()
    assert(after === before + 1, `下の段へ移っていない（V2 が ${before} → ${after}）`)
    // **元の段へ戻す。** 戻さないと、この確認のあと画像が V2 に居座ったままになり、
    // 画面を見た人に「V2 に見覚えのない枠がある」と映る（実際そう言われた）。
    // 戻せること自体も確かめたい（片道だけ動く状態に気づけない）
    await dragBy(page.locator('[data-tid="V2"] .img-clip:not(.se-ghost)').first(), 0, -dy)
    await page.waitForTimeout(500)
    const back = await page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)').count()
    assert(back >= 1, '元の段へ戻せない')
  })

  await check('段見出しの境目を掴んで、レーンの高さを変えられる', async () => {
    // 高さを変える所は、左端の丸の列から**段見出しの境目**へ移した（プレミアと同じ）。
    // 境目は見出しと一緒に動くので、縦に送っても見えている段の境目は必ず掴める。
    await timelineVScroll.scrollTo(0)
    const rowH = () =>
      page.evaluate(() =>
        Math.round(document.querySelector('.track-video')?.getBoundingClientRect().height ?? 0)
      )
    const before = await rowH()
    const divider = page.locator('.th-video .th-divider').first()
    assert(await divider.count(), '段見出しに境目が見つからない')
    await dragBy(divider, 0, 60) // 下へ＝太くなる
    await page.waitForTimeout(300)
    const after = await rowH()
    assert(after > before + 4, `境目を下へ引いても太くならない（${before} → ${after}）`)
    await dragBy(page.locator('.th-video .th-divider').first(), 0, -200) // 元の細さへ戻す
    await page.waitForTimeout(300)
  },
  // **タイムラインの高さが、手前の項目の残した状態で決まる。**
  // 低いままだと境目を掴んでも広げる余地が無く、`26 → 26` で必ず赤くなる
  //（通しでは緑。実際に stash して変更前と比べ、同じ数値で落ちるのを確かめた）。
  { orderDependent: true })

  // **既定を黙って書き換えない代わりの口。** 段の高さは1つずつ覚えているので、
  // 既定を変えても前に触った人の画面は前のまま。戻すかどうかは本人に決めてもらう
  //（`やること.md` の「段」で決めた形）。押す口が無いと、その決め方が成立しない。
  // ※ 上の「境目を掴んで高さを変えられる」と同じ手を使うので、
  //   あちらが順番の都合で赤いときは、こちらも同じ理由で赤くなる
  await check('段の高さは「既定へ戻す」で戻せる', async () => {
    const rowH = () =>
      page.evaluate(() =>
        Math.round(document.querySelector('.track-video')?.getBoundingClientRect().height ?? 0)
      )
    const base = await rowH()
    await dragBy(page.locator('.th-video .th-divider').first(), 0, 80)
    await page.waitForTimeout(300)
    const fat = await rowH()
    assert(fat > base + 4, `準備が成立していない（太くできていない ${base} → ${fat}）`)
    const reset = page.locator('button[title="段の高さを既定へ戻す"]').first()
    assert(await reset.count(), '「段の高さを既定へ戻す」の口が無い')
    await reset.click()
    await page.waitForTimeout(400)
    const back = await rowH()
    assert(back < fat - 4, `戻っていない（${fat} → ${back}）`)
  },
  // 上と同じ手（境目を掴んで太くする）を使うので、同じ理由で順番に依存する
  { orderDependent: true })

  await check('縦に送っても、秒数の目盛りは残る', async () => {
    const st = await timelineVScroll.tops('V1')
    const rulerAtTop = await page.evaluate(() => {
      const r = document.querySelector('.ruler')?.getBoundingClientRect()
      const s = document.querySelector('.track-scroll')?.getBoundingClientRect()
      return r && s ? Math.round(r.top - s.top) : null
    })
    assert(st.ruler != null, '目盛りが見つからない')
    near(rulerAtTop, 0, 2, `縦に送ったら目盛りが流れて消えた（枠の上端から ${rulerAtTop}px）`)
    await timelineVScroll.scrollTo(0)
  })

  await check('境目を動かして縮めると、上と下が一緒に小さくなる', async () => {
    // 素のままだと枠は下端だけが動く＝音声側から順に消えて、映像側は全部見えたまま。
    // それでは片側だけが減る動きになるので、映像と音声の境目を枠に残す。
    await timelineVScroll.squeeze()
    const st = await timelineVScroll.where()
    assert(st, 'タイムラインか音声の段が見つからない')
    assert(st.over > 0, `縮めたのに送り分が無い（はみ出し ${st.over}px）`)
    assert(
      st.rel > 0 && st.rel < st.view,
      `縮めたら映像と音声の境目が枠の外へ出た（枠 ${st.view}px / 境目 ${st.rel}px）`
    )
    near(
      st.rel,
      st.view / 2,
      st.view * 0.2,
      `境目が真ん中に残っていない（枠 ${st.view}px の中で ${st.rel}px）＝片側だけが減っている`
    )
  })

  await check('境目を戻して広げると、送り分が消えて全部見える', async () => {
    await dragBy(page.locator('.resizer-h').first(), 0, -400) // 上へ＝タイムラインを広げる
    await page.waitForTimeout(300)
    const st = await timelineVScroll.where()
    assert(st, 'タイムラインか音声の段が見つからない')
    assert(st.over <= 0, `広げたのにはみ出しが残っている（${st.over}px）`)
    assert(st.top === 0, `全部入るのに送ったままになっている（${st.top}px）`)
  })

  await check('鍵をかけると、そのトラックのクリップを動かせない', async () => {
    const btn = trackHead('V1').locator('button[title="ロック"]').first()
    assert(await btn.count(), 'V1 の鍵ボタンが見つからない')
    const before = await clipLayout()
    await btn.click()
    await page.waitForTimeout(300)
    await dragBy(v1Clips().nth(0), W * 1.2)
    const after = await clipLayout()
    near(after[0].x, before[0].x, 2, '鍵をかけたのにクリップが動いた')
    await btn.click() // 鍵を戻す
    await page.waitForTimeout(300)
    await dragBy(v1Clips().nth(0), 150)
    const after2 = await clipLayout()
    assert(after2[0].x > before[0].x + 5, '鍵を外しても動かせないままになっている')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  // =========================================================================
}
