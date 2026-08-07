// 負荷チェックの**「触ったときのもたつき」を測る7項目**。
//
// ## なぜ本体から出したか（2026-08-04）
//
// `bench.mjs` が上限（1,250行）に当たった。話題は3つに分かれていて、
// ここは**触って測る**だけを持つ。素材づくり・記録・まとめは本体に残す。
//
// ## 道具は ctx で1つだけ受け取る
//
// 個別に受け取ると17個になる。**1つの束にすれば、足すときに
// この行を書き換えなくて済む**（`useAppWiring` を剥がしたときと同じ形）。
//
// ## ここの項目が「測れていない」を出しやすい理由
//
// **掴めていないと「何も起きない＝軽い」に見える。** 2026-08-04 に
// 4項目が測れていないまま「重い」「不具合」と報告していた。
// だから**成立しなければ落ちる**に倒してある（掴めた／動いた／進んだ）。
//
// ## 中身
//
// - `runOpsChecks` … 7項目を順に測る
export async function runOpsChecks(ctx) {
  const {
    measure, page, fmt, MINUTES, totalSec,
    visL, visR, visMid, visY, inner, clip,
    zoomIn, seekTo0, scrollToFirst, zoomUntilGrabbable, headX, timelineWidth
  } = ctx
  await measure('クリップを掴んで動かす', async () => {
    // **入口を自分で決める。** 全体表示だと帯が1本も無い——引いた状態では
    // 段まるごと1枚の絵になる（`components/timeline/TrackSummary`）。
    // 2026-08-05、絵を入れた日に「掴める帯が画面に無い」で落ちた。
    // **これは仕様どおり**（2px の帯は掴めないので、掴む前に寄せるのが本来の流れ）。
    await zoomUntilGrabbable('[data-tid="V1"] .video-clip', 20)
    // 端のクリップは磁石で元の位置へ戻る。真ん中あたりを掴む。
    const all = page.locator('[data-tid="V1"] .video-clip')
    // ★「真ん中の帯」ではなく「画面に見えている帯」を選ぶ。
    //   見えない帯は作らない作りなので、並び順の真ん中が窓の外にあることがある
    //   （実際 x=1764 の画面外を掴んで、何も起きていなかった）。
    const vwA = (page.viewportSize() ?? { width: 1280 }).width
    const iA = await all.evaluateAll((els, w) => {
      const hit = []
      for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect()
        if (r.x > 200 && r.x + r.width < w - 200) hit.push(i)
      }
      if (hit.length) return hit[Math.floor(hit.length / 2)]
      for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect()
        if (r.x < w - 250 && r.x + r.width > 250) return i
      }
      return -1
    }, vwA)
    if (iA < 0) throw new Error('掴める帯が画面に無い')
    const t = all.nth(iA)
    let b = await t.boundingBox()
    // 細いクリップは掴めない。人と同じで、掴める幅まで拡大してから動かす。
    for (let g = 0; g < 12 && b.width < 24; g++) {
      await zoomIn(b.x + b.width / 2, b.y + b.height / 2, 1)
      await t.scrollIntoViewIfNeeded().catch(() => {})
      b = (await t.boundingBox()) ?? b
    }
    // 動かせたかは「並び全体が変わったか」で見る。n番目を見張ると、
    // ずれた別のクリップが同じ番号に来て「動いていない」ことになる。
    const layout = () =>
      all.evaluateAll((els) =>
        els
          .map((e) => {
            const r = e.getBoundingClientRect()
            return Math.round(r.x) + ':' + Math.round(r.width)
          })
          .join(',')
      )
    const l0 = await layout()
    const x0 = b.x + b.width / 2
    const dx = Math.max(3, Math.min(8, (b.width * 1.5) / 40))
    await page.mouse.move(x0, b.y + b.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 40; i++) {
      await page.mouse.move(x0 + i * dx, b.y + b.height / 2)
      await page.waitForTimeout(8)
    }
    await page.mouse.up()
    await page.waitForTimeout(300)
    const l1 = await layout()
    if (l1 === l0)
      throw new Error(
        `掴んで動かせていない（掴んだ所 x=${Math.round(x0)} 幅=${Math.round(b.width)} 1回=${dx}px×40 / 帯 ${l0.split(',').length}本）`
      )
    await page.keyboard.press('Control+z') // 元に戻しておく
    await page.waitForTimeout(500)
  },
  // わざと間違える: 掴まずに0pxだけ動かす（＝何も起きない）
  async () => {
    const all = page.locator('[data-tid="V1"] .video-clip')
    const t = all.nth(Math.floor((await all.count()) / 2))
    const b = await t.boundingBox()
    const layout = () =>
      all.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)).join(','))
    const l0 = await layout()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.up()
    await page.waitForTimeout(300)
    if ((await layout()) === l0) throw new Error('掴んで動かせていない')
  })
  void clip

  /** 拡大・縮小を測るときの入口の幅（記録の外で作る。下の setup が埋める） */
  let 拡大の入口W = 0
  await measure('タイムラインを拡大・縮小する', async () => {
    const w0 = 拡大の入口W
    await zoomIn(visMid, visY(40), 10)
    const w1 = await timelineWidth()
    if (w1 <= w0 * 1.2) throw new Error(`拡大できていない（${w0} → ${w1}px）`)
    await page.keyboard.down('Control')
    await page.mouse.move(visMid, visY(40))
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 120)
      await page.waitForTimeout(120)
    }
    await page.keyboard.up('Control')
    await page.waitForTimeout(200)
    const w2 = await timelineWidth()
    if (w2 >= w1 * 0.9) throw new Error(`縮小できていない（${w1} → ${w2}px）`)
  },
  // わざと間違える: Ctrl を押さずにホイールする（＝横スクロールするだけ）
  async () => {
    const w0 = await timelineWidth()
    await page.mouse.move(visMid, visY(40))
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, -120)
      await page.waitForTimeout(80)
    }
    const w1 = await timelineWidth()
    if (w1 <= w0 * 1.2) throw new Error(`拡大できていない（${w0} → ${w1}px）`)
  },
  // **入口づくり（記録の外）。** 全体表示から10ノッチ寄せて10ノッチ戻す、と
  // 決めれば毎回同じ道を通る（2026-08-04）。
  //
  // **ここを記録に入れてはいけない**（2026-08-07）。全体表示へ戻す手の重さは
  // 「どこから戻るか」で変わるので、混ぜると同じコードで 16.6ms と 54.1ms に割れる。
  //
  // **入口が作れなければ落とす。** 前は
  //   `if (await fit.count()) await fit.click().catch(() => {})`
  // で、押せなくても・押しても効かなくても黙って進んでいた
  //（CLAUDE.md 7番「測る側は成立しなければ落ちるに倒す」）。
  async () => {
    const fit = page.locator('.tl-zoom button').first()
    if (!(await fit.count())) throw new Error('全体表示のボタンが無い（入口が作れない）')
    await fit.click()
    await page.waitForTimeout(500)
    拡大の入口W = await timelineWidth()
    // **本当に全体表示になったか。** 押せたことと効いたことは別
    const 窓 = (await page.locator('.track-scroll').first().boundingBox()).width
    if (Math.abs(拡大の入口W - 窓) > 窓 * 0.25)
      throw new Error(
        `全体表示になっていない（中身 ${Math.round(拡大の入口W)}px / 窓 ${Math.round(窓)}px）`
      )
  })

  /** 再生ヘッドの画面上の位置（動いたかを確かめるのに使う） */
  /**
   * 再生ヘッドの位置。**タイムライン上の位置（style.left）で読む。**
   *
   * 前は画面上の座標（`boundingBox()?.x ?? NaN`）だった。寄せていると
   * 再生ヘッドは**画面の外へ出る**ので `null` → `NaN` になり、
   * `Math.abs(NaN - x0) < 5` は **false ＝「動いた」** で素通りする。
   * CLAUDE.md 7番の「消えた物を `?? ''` で守らない」そのもの。
   *
   * **無ければ落とす。** 再生ヘッドが無い画面は、そもそも測る意味が無い。
   */
  await measure(
    '再生ヘッドを掴んで動かす',
    async () => {
      // **入口を自分で決める。** 前の項目（拡大・縮小）が残した倍率のまま掴むと、
      // 全体表示のときに再生ヘッドが動かず「動いていない」で落ちる
      //（2026-08-04、拡大の項目を全体表示から始めるよう直した途端に壊れた）。
      // **bench は項目どうしが状態を引き継ぐ**ので、直した先の次が壊れる。
      // 触る項目は、掴める太さまで自分で寄せてから始めること。
      await zoomUntilGrabbable('[data-tid="V1"] .video-clip', 20)
      await seekTo0()
      const rb = await page.locator('.ruler').boundingBox()
      const step = (visR - visL) / 40
      const x0 = await headX()
      await page.mouse.move(visL, rb.y + rb.height / 2)
      await page.mouse.down()
      for (let i = 1; i <= 40; i++) {
        await page.mouse.move(visL + i * step, rb.y + rb.height / 2)
        await page.waitForTimeout(8)
      }
      await page.mouse.up()
      await page.waitForTimeout(300)
      if (Math.abs((await headX()) - x0) < 10) throw new Error('再生ヘッドが動いていない')
    },
    // わざと間違える: 押して離すだけで動かさない
    async () => {
      const rb = await page.locator('.ruler').boundingBox()
      const x0 = await headX()
      await page.mouse.move(visL, rb.y + rb.height / 2)
      await page.mouse.down()
      await page.mouse.up()
      await page.waitForTimeout(300)
      if (Math.abs((await headX()) - x0) < 10) throw new Error('再生ヘッドが動いていない')
    }
  )

  /** テロップ全部の画面上の位置（一緒に動いたかを確かめるのに使う） */
  const telopPos = () =>
    page
      .locator('.telop-clip')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)).join(','))
  /** 一番左のクリップの画面上の位置（横スクロールしたかを確かめるのに使う） */
  const firstClipX = async () =>
    (await page.locator('[data-tid="V1"] .video-clip').first().boundingBox())?.x ?? NaN
  /**
   * 送れなかったときに、**なぜ送れないのかを言う**（2026-08-07）。
   *
   * 「横にスクロールしていない」だけだと、
   *   ・ホイールが効いていない（アプリの不具合）
   *   ・そもそも送る余地が無い（引き切っていて中身が収まっている＝測る前提が崩れている）
   * のどちらか分からない。前者はアプリを直す話、後者は入口を作る話で、**直す先が違う**。
   * 実際、この赤を見て最初に立てた見立ては後者だったが、確かめずに直しにいくと外す。
   */
  const なぜ送れないか = async () => {
    const s = await page.locator('.track-scroll').first().evaluate((el) => ({
      left: Math.round(el.scrollLeft),
      w: Math.round(el.scrollWidth),
      c: Math.round(el.clientWidth)
    }))
    const 余地 = s.w - s.c
    return (
      `横にスクロールしていない（scrollLeft ${s.left} / 中身 ${s.w}px / 窓 ${s.c}px` +
      `＝送れる余地 ${余地}px）` +
      (余地 <= 0 ? ' ← **送る余地が無い**。引き切っている＝測る前提が崩れている' : '')
    )
  }
  await measure(
    'タイムラインを横にスクロールする',
    async () => {
      // **往復を5回する**（2026-08-07）。1往復（約2秒・470コマ）だと 95% が
      // 24.9〜33.3ms に散り、**追いたい差（1〜2割）より測定のばらつきの方が大きい**。
      // 道具の分解能が足りないと、何を直しても「効いたかどうか分からない」になる。
      // 標本が5倍なら、ばらつきは約 √5＝2.2倍 細くなる。
      const x0 = await firstClipX()
      await page.mouse.move(visMid, visY(60))
      for (let 回 = 0; 回 < 5; 回++) {
        for (let i = 0; i < 20; i++) {
          await page.mouse.wheel(160, 0)
          await page.waitForTimeout(25)
        }
        if (回 === 0 && Math.abs((await firstClipX()) - x0) < 10)
          throw new Error(await なぜ送れないか())
        for (let i = 0; i < 20; i++) await page.mouse.wheel(-160, 0) // 戻す
        await page.waitForTimeout(300)
      }
    },
    // わざと間違える: タイムラインの外（プレビューの上）でホイールする。
    // ※縦にホイールしても横に動くので、それでは「間違い」にならない
    //   （このアプリはただのホイール＝横スクロール）。
    async () => {
      const pv = await page.locator('.monitor-stage').first().boundingBox()
      const x0 = await firstClipX()
      await page.mouse.move(pv.x + pv.width / 2, pv.y + pv.height / 2)
      for (let i = 0; i < 20; i++) {
        await page.mouse.wheel(160, 0)
        await page.waitForTimeout(25)
      }
      if (Math.abs((await firstClipX()) - x0) < 10) throw new Error('横にスクロールしていない')
    }
  )

  await measure('テロップを掴んで動かす', async () => {
    const tel = page.locator('.telop-clip')
    const n = await tel.count()
    if (!n) throw new Error('テロップが1つも出ていない')
    // テロップの帯は最低12pxで描かれるので、拡大率が低いと隣どうしが重なり、
    // 狙った帯ではなく手前の帯を掴んでしまう。まず拡大してから、
    // 「いま画面に見えていて掴める幅のもの」を選び直す。
    // （拡大すると狙った帯が画面外へ出るので、先に決めておくと空振りする）
    await zoomUntilGrabbable('.telop-clip')
    // **寄せたあと、テロップの所まで送る。**
    //
    // テロップは尺全体（1時間）に散らばるので、寄せるほど画面に入らなくなる。
    // 基準 light（3600秒に200枚＝18秒に1枚）だと**1枚も入らず**、
    // 「掴める幅のテロップが画面に無い」で落ちていた。
    // **これは負荷のせいではなく測定側**——tv でも light でも同じように落ちる、
    // で見分けが付いた（2026-08-04）。`bench-limits` の probe と同じ穴。
    await scrollToFirst('.telop-clip')
    const vw = (page.viewportSize() ?? { width: 1280 }).width
    const idx = await tel.evaluateAll((els, w) => {
      for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect()
        if (r.width >= 20 && r.x > 80 && r.x + r.width < w - 120) return i
      }
      return -1
    }, vw)
    if (idx < 0) throw new Error(`掴める幅のテロップが画面に無い（${n}枚あるのに選べなかった）`)
    const t = tel.nth(idx)
    let b = await t.boundingBox()
    await t.click() // 掴む前に選んでおく
    await page.waitForTimeout(200)
    b = (await t.boundingBox()) ?? b
    const shot0 = await tel.evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().x)).join(',')
    )
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 30; i++) {
      await page.mouse.move(b.x + b.width / 2 + i * 8, b.y + b.height / 2)
      await page.waitForTimeout(8)
    }
    await page.mouse.up()
    await page.waitForTimeout(300)
    const shot1 = await tel.evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().x)).join(',')
    )
    if (shot0 === shot1)
      throw new Error(`テロップを動かせていない（幅 ${Math.round(b.width)}px・${n}枚）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  },
  // わざと間違える: 拡大せず、重なって細いままの帯を掴もうとする
  async () => {
    const tel = page.locator('.telop-clip')
    const t = tel.nth(Math.floor((await tel.count()) / 2))
    const b = await t.boundingBox()
    const pos = () => tel.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)).join(','))
    const p0 = await pos()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.up()
    await page.waitForTimeout(300)
    if ((await pos()) === p0) throw new Error('テロップを動かせていない')
  })

  await measure('テロップの文字を打ち直す', async () => {
    // 1文字打つたびに画面全体が作り直されると、長い動画ほど入力が遅れる
    //
    // テロップが出ている時刻へ移る。**帯の真ん中を押してはいけない**。
    // 帯は細くなりすぎないよう最低12pxで描かれるので、引いた状態では
    // 「帯の真ん中」と「テロップが出ている時刻」がずれる（60分だと数秒ぶん）。
    // ずれた所へ再生ヘッドを置くと、プレビューに文字が出ず、
    // アプリの不具合のように見える（実際にそう報告してしまった）。
    // 帯そのものを押して選び、その中身の時刻へ移る。
    const band = page.locator('.telop-clip').nth(1)
    await page.keyboard.press('Escape')
    // **押す前に、その帯が見える所まで送る。**
    // 手前の項目が寄せた／送った状態を引き継ぐので、帯が画面の外にいることがある。
    // 外にいると押せず、そのあと「プレビューに文字が出ていない」で落ちる
    // ——**負荷ではなく測定側**（light でも同じように落ちていた。2026-08-04）。
    // ※ 帯は見えている範囲にしか作られないので、まず先頭へ戻してから探す
    //   （`scrollIntoViewIfNeeded` は、その帯が**作られていない**と効かない）。
    // ※ 幅も要る。細い帯の真ん中を押すと、ずれた時刻へ再生ヘッドが行って
    //   「プレビューに文字が出ていない」になる（60分だと数秒ぶんずれる）。
    await zoomUntilGrabbable('.telop-clip')
    await band.scrollIntoViewIfNeeded()
    await page.waitForTimeout(150)
    await band.click()
    await page.waitForTimeout(400)
    // 選んだテロップの開始時刻＋わずかに後ろ（確実に表示される所）へ。
    // 時刻は帯の left（＝開始秒×拡大率）から割り戻す。
    // アプリ側にテスト用の属性は足さない（本番のコードに仕掛けを入れない）。
    const at = await page.evaluate(() => {
      const el = document.querySelector('.telop-clip.clip-selected')
      if (!el) return null
      const left = parseFloat(el.style.left || '0')
      return Number.isFinite(left) ? left : null
    })
    const rr = await page.locator('.ruler').boundingBox()
    // **帯そのものの箱から押す所を決める。** 前は拡大スライダー
    // （`.tl-zoom input[type=range]`）の値で秒→pxを換算していたが、
    // 2026-08-03 に拡大UIが下のバーへ移ってスライダーが**消えた**ため、
    // ここは20秒待って必ず落ちていた（＝この項目は測れていなかった）。
    // 帯の真ん中は必ずその文字が出ている時刻なので、換算そのものが要らない。
    void at
    const bb = await band.boundingBox()
    if (!bb) throw new Error('選んだ帯が画面に無い')
    await page.mouse.click(bb.x + bb.width / 2, rr.y + rr.height / 2)
    await page.waitForTimeout(700)
    const tel = page.locator('.telop-overlay > *').first()
    if (!(await tel.count())) throw new Error('プレビューに文字が出ていない')
    await tel.dblclick()
    await page.waitForTimeout(400)
    const ed = page.locator('.telop-editor textarea, .telop-editor input').first()
    if (!(await ed.count())) throw new Error('打ち直す欄が出ない')
    const before = await ed.inputValue()
    for (const ch of 'あいうえおかきくけこ') {
      await page.keyboard.type(ch)
      await page.waitForTimeout(12)
    }
    const after = await ed.inputValue()
    if (after === before) throw new Error('文字が入っていない')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
  },
  // わざと間違える: 打ち直す欄を開かずに打つ（どこにも入らない）
  async () => {
    const tel = page.locator('.telop-overlay > *').first()
    const before = (await tel.textContent()) ?? ''
    await page.keyboard.type('あいうえお')
    await page.waitForTimeout(400)
    const after = (await tel.textContent()) ?? ''
    if (after === before) throw new Error('文字が入っていない')
  })

  await measure('全部選んでまとめて動かす', async () => {
    // **決まった見え方から始める。** 手前の項目（拡大・横送り）が残した倍率と
    // 位置のまま掴むと、同じ px を動かしても意味する秒数が毎回変わり、
    // 磁石に吸い戻されたりはみ出したりして「動かせていない」と出る。
    // 「↔ 全体表示」を押して基準へ戻す（2026-08-03）。
    const fit = page.locator('.tl-zoom button').first()
    if (await fit.count()) await fit.click().catch(() => {})
    await page.waitForTimeout(500)
    await page.keyboard.press('Escape')
    // **戻したあと、掴める太さまで寄せる。**
    //
    // 全体表示は「基準」としては正しいが、**そのままでは掴めない**。
    // 60分・カット600 だと 0.33px/秒しかなく、1本の帯が **約2px**。
    // 2px の真ん中を押しても帯に当たらず、下地から範囲選択が始まって
    // **選択が消える**＝何も動かない。それが「まとめて動かせていない」の正体だった
    //（2026-08-04。`light` はカット1本＝画面いっぱいなので、ここだけ通っていた）。
    //
    // CLAUDE.md 7番の同型が、これで4件目。**細さで測定が死ぬ**ことを毎回忘れている。
    await zoomUntilGrabbable('[data-tid="V1"] .video-clip', 20)
    const all = page.locator('[data-tid="V1"] .video-clip')
    // 画面に見えていて掴める幅のものを選ぶ（拡大率は前の項目で変わっている）
    const vw2 = (page.viewportSize() ?? { width: 1280 }).width
    // 拡大していると1つが画面より広いこともある。画面に見えている部分があれば掴める。
    //
    // **縦も見る。** 横だけで選んでいたので、段が多い（実データは11本）と
    // V1 が縦にはみ出していても「見えている」と数えてしまい、画面の外を掴んで
    // 「まとめて動かせていない」と出ていた（2026-08-03。前の項目で拡大が
    // 効くようになって初めて表に出た）。
    const i2 = await all.evaluateAll((els, w) => {
      const sc = document.querySelector('.track-scroll')?.getBoundingClientRect()
      for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect()
        const yOk = !sc || (r.y + r.height / 2 > sc.top + 8 && r.y + r.height / 2 < sc.bottom - 8)
        if (r.x < w - 200 && r.x + r.width > 200 && yOk) return i
      }
      return -1
    }, vw2)
    if (i2 < 0) throw new Error('掴めるクリップが画面に無い')
    const t = all.nth(i2)
    const tp0 = await telopPos()
    await page.keyboard.press('Control+a')
    await page.waitForTimeout(400)
    const b = await t.boundingBox()
    const l0 = await all.evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().x)).join(',')
    )
    // **動かす量は「秒」で決める。** 150px 固定にしていたので、拡大が効いた状態だと
    // 1秒未満になり、**磁石で元の位置へ吸い戻されて「動かせていない」**と出ていた
    // （2026-08-03。前の項目の拡大が直って初めて表に出た）。
    const pps =
      (await page.locator('.track-inner').evaluate((e) => parseFloat(e.style.width || '0'))) /
      Math.max(1, totalSec)
    const dist = Math.max(150, Math.round(2 * pps)) // 2秒ぶん（最低150px）
    const stepN = 30
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= stepN; i++) {
      await page.mouse.move(b.x + b.width / 2 + (i * dist) / stepN, b.y + b.height / 2)
      await page.waitForTimeout(8)
    }
    await page.mouse.up()
    await page.waitForTimeout(400)
    const l1 = await all.evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().x)).join(',')
    )
    if (l0 === l1) throw new Error('まとめて動かせていない')
    // 「まとめて」なので、テロップも一緒に動いていること
    if ((await telopPos()) === tp0) throw new Error('クリップだけ動いてテロップが残っている')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
    await page.keyboard.press('Escape')
  },
  // わざと間違える: 全選択せずに動かす（クリップだけ動いてテロップは残る）
  async () => {
    await page.keyboard.press('Escape')
    const all = page.locator('[data-tid="V1"] .video-clip')
    const t = all.nth(Math.floor((await all.count()) / 2))
    const b = await t.boundingBox()
    const tp0 = await telopPos()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(b.x + b.width / 2 + i * 5, b.y + b.height / 2)
      await page.waitForTimeout(8)
    }
    await page.mouse.up()
    await page.waitForTimeout(400)
    if ((await telopPos()) === tp0) throw new Error('クリップだけ動いてテロップが残っている')
  })

  await measure(
    '再生してみる（3秒）',
    async () => {
      // **自分で見え方を決める（全体表示）。**
      //
      // 再生の重さは「同時に何本の帯が見えているか」で決まる。前の項目が残した
      // 拡大率に任せると、**アプリを1行も変えていないのに 104.2ms → 25.1ms** になる
      //（2026-08-04、前の項目を寄せた状態で終わるよう直したとき実際にそうなった）。
      // ここは**いちばん重い側＝全部見えている状態**で測る。編集し終えて
      // 全体を見ながら流す、という実際によくやる形でもある。
      const fit = page.locator('.tl-zoom button').first()
      if (await fit.count()) await fit.click().catch(() => {})
      await page.waitForTimeout(500)
      await seekTo0()
      // **Space を押す前に、文字入力から手を離す。**
      // 直前の項目でテロップの文字を打ち直しているので、focus が入力欄に
      // 残っていると Space は**空白を打つだけ**で再生が始まらない。
      // 「再生が進んでいない」＝アプリの不具合、と読み違える所だった
      //（light でも同じように落ちていた。2026-08-04）。
      await page.evaluate(() => document.activeElement?.blur?.())
      await page.waitForTimeout(150)
      const x0 = await headX()
      await page.keyboard.press('Space')
      await page.waitForTimeout(3000)
      await page.keyboard.press('Space')
      await page.waitForTimeout(300)
      const moved = (await headX()) - x0
      // **「何px 動いたか」で判定しない。** 引いた状態だと 3秒＝1.2px にしかならず、
      // 5px のしきい値に届かない。**再生は動いているのに「進んでいない」と出て、
      // アプリの不具合に見えた**（2026-08-04。light でも同じように落ちていた）。
      // 動くはずの量（3秒 × 拡大率）に対する割合で見れば、拡大率に左右されない。
      const zoom = await page.evaluate(() => {
        const inner = document.querySelector('.track-inner')
        return inner ? parseFloat(inner.style.width || '0') : 0
      })
      const want = (zoom / Math.max(1, MINUTES * 60)) * 3 // 3秒ぶんの px
      if (!(want > 0)) throw new Error('拡大率が読めない（測れていない）')
      if (moved < want * 0.5)
        throw new Error(
          `再生が進んでいない（${fmt(moved)}px しか動かなかった。3秒なら ${fmt(want)}px のはず）`
        )
    },
    // わざと間違える: 再生を始めずに待つだけ
    async () => {
      await seekTo0()
      const x0 = await headX()
      await page.waitForTimeout(3000)
      if (Math.abs((await headX()) - x0) < 5) throw new Error('再生が進んでいない')
    }
  )
}
