// 仕上げ（3/3）: **見え方（色の保存・横位置・拡大バー）。**
//
// 章「仕上げ」を3つに割った3本目（2026-08-06。元は604行）。
// 順番は1行も変えていない（同じ章の中の項目どうしは順番に依存する）。
//
// ## 中身
//
//   色を付けたまま保存して開き直す
//   前回の続きで、タイムラインの横位置も戻る
//   下の拡大バー（掴んで移動／●で拡大縮小／全体表示へ戻す）
//   **Ctrl+ホイールで拡大したとき、バーが連れて動く**
//
// ※ 最後の1件は、**測り方を間違えると必ず赤くなる**。Playwright の
//   `mouse.wheel` は Ctrl を乗せないので、本物の WheelEvent を投げている
//   （中の説明を読むこと）。
//
// 道具は run.mjs の C から受け取る。**使う物だけ**
// （受け取り漏れは `node e2e/lint-checks.mjs` が走らせる前に名指しする）。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export default async function (C) {
  const { assert, check, clipLayout, fx, outDir, page, resetProject, setDialogFiles, v1Clips } = C

  /**
   * Ctrl+ホイールを送る（**3つの確認で使うので、外に出してある**）。
   *
   * **`page.mouse.wheel` は使えない。** Playwright のあれは修飾キーを乗せないので、
   * `keyboard.down('Control')` と組み合わせても `ctrlKey: false` で届き、
   * アプリ側はただの横スクロールとして扱う。
   * **アプリは無罪なのに「拡大していない」と出る**（実際に一度そう読んで、
   * アプリを疑って半時間を落とした）。だから本物の WheelEvent を投げる。
   */
  const ctrlWheel = async (deltaY, times) => {
    await page.evaluate(
      ({ deltaY, times }) => {
        const el = document.querySelector('.track-scroll')
        if (!el) throw new Error('.track-scroll が無い')
        const r = el.getBoundingClientRect()
        for (let i = 0; i < times; i++) {
          el.dispatchEvent(
            new WheelEvent('wheel', {
              deltaY,
              ctrlKey: true,
              clientX: r.left + r.width * 0.4,
              clientY: r.top + 20,
              bubbles: true,
              cancelable: true
            })
          )
        }
      },
      { deltaY, times }
    )
    await page.waitForTimeout(400)
  }

  await check('色を付けたまま保存して開き直すと、色が残っている', async () => {
    await resetProject()
    await v1Clips().nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const sw = page.locator('.ctx-swatch:not(.ctx-swatch-none)').first()
    const want = await sw.evaluate((e) => getComputedStyle(e).backgroundColor)
    await sw.click()
    await page.waitForTimeout(500)
    const saved = join(outDir, 'colored.gcproj')
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
    const got = await v1Clips().nth(0).evaluate((el) => getComputedStyle(el).backgroundColor)
    assert(got === want, `色が残っていない（${got} / 期待 ${want}）`)
  })

  // **再生ヘッドとタイムラインの横位置は、必ず一緒に戻る。**
  //
  // 前は横位置だけ起動直後に1回書いていた。その時点では中身の幅がまだ無いので
  // ブラウザが黙って0へ丸め、再生ヘッドだけ後から戻る＝
  // 「再生ヘッドは32秒、タイムラインは先頭」という食い違いが残っていた。
  // その状態だと、そこに置いた画像はプレビューに出るのにタイムラインには
  // 帯が無い（見えている範囲の帯しか作らないため）＝本人から上がった
  // 「タイムラインから消えている画像が、プレビューには出る」の正体。
  await check('前回の続きを開くと、タイムラインの横位置も戻る', async () => {
    await resetProject()
    const scroller = page.locator('.track-scroll').first()
    // 送れる幅が無いと、この確認は何も見ていないことになる。まず寄る
    const thumb = page.locator('.zoom-bar-thumb').first()
    const tb0 = await thumb.boundingBox()
    const knob = page.locator('.zbk-r').first()
    const kb = await knob.boundingBox()
    await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2)
    await page.mouse.down()
    await page.mouse.move(tb0.x + tb0.width * 0.4, kb.y + kb.height / 2, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(600)
    const room = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth)
    assert(room > 100, `準備が成立していない（送れる幅が ${Math.round(room)}px しかない）`)

    // 先頭から離れた所へ送る（スクロールの見張りが localStorage へ書く）
    const want = Math.round(room * 0.6)
    await scroller.evaluate((el, x) => el.scrollTo({ left: x }), want)
    await page.waitForTimeout(600)
    const sx0 = await scroller.evaluate((el) => Math.round(el.scrollLeft))
    assert(sx0 > 50, `送れていない（${sx0}）`)

    // **下書きを自分で置いてから開き直す。** 置かないと復元の箱が出ず、
    // 「テンプレートから始める」が出て中身が空になる（＝何も見ていないことになる）
    writeFileSync(
      join(fx.userData, 'giftcut-autosave.json'),
      readFileSync(fx.gcprojOrig, 'utf-8'),
      'utf-8'
    )
    await page.reload()
    await page.waitForSelector('.restore-btns', { timeout: 30000 })
    // **.first() を使わない。** 「1つ前の状態で復元」も『復元』を含むので、
    // それが出ている場面では先頭がそちらになる
    await page.locator('.restore-btns button', { hasText: '復元' }).last().click()
    // **クリップの帯を待ってはいけない。** 帯は見えている範囲にしか作らないので、
    // 横位置を戻した先に帯が無ければ永遠に出ない（それで30秒待って落ちた）。
    // 待つのは段そのもの
    await page.waitForSelector('[data-tid="V1"]', { timeout: 30000 })
    await page.waitForTimeout(2500) // 中身の幅が育つのを待つ（そこで初めて戻せる）
    const after = await page
      .locator('.track-scroll')
      .first()
      .evaluate((el) => ({
        sx: Math.round(el.scrollLeft),
        room: Math.round(el.scrollWidth - el.clientWidth)
      }))
    assert(
      Math.abs(after.sx - sx0) < 40,
      `横位置が戻っていない（${sx0} → ${after.sx}／送れる幅 ${room} → ${after.room}）`
    )
  })

  await check('下の拡大バーで、拡大縮小と移動ができる', async () => {
    // **拡大のつまみと横スクロールを1本にまとめた。**
    // 真ん中を掴めば移動、左右の●で拡大・縮小（プレミアと同じ形）。
    //
    // 見るのは3つ: 寄れる／戻せる（位置がずれない）／掴んで動かすと見る所が変わる。
    await resetProject()
    const bar = page.locator('.zoom-bar').first()
    const thumb = page.locator('.zoom-bar-thumb').first()
    assert(await bar.count(), '下の拡大バーが無い')
    assert((await page.locator('.tl-zoom input[type="range"]').count()) === 0,
      '古い拡大のつまみが残っている（2か所で操れる状態）')

    const innerX = async () => (await page.locator('.track-inner').boundingBox()).x
    const xs = async () => {
      const ix = await innerX()
      return (await clipLayout()).map((c) => Math.round(c.x - ix))
    }
    const before = await xs()
    const w0 = (await thumb.boundingBox()).width

    // 右の●を左へ引く＝見える範囲が狭まる＝寄る。
    // **いまの幅から相対で狭める。** ここへ来るまでの拡大率は前の項目次第なので、
    // 「バーの40%」のような決め打ちだと、元の方が狭いときに逆に広げてしまう
    // （実際にそれで赤くなった）。
    const tb0 = await thumb.boundingBox()
    const knob = page.locator('.zbk-r').first()
    const kb = await knob.boundingBox()
    const target = tb0.x + tb0.width * 0.5 // いまの半分の幅にする
    await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2)
    await page.mouse.down()
    await page.mouse.move(target, kb.y + kb.height / 2, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(600)
    const w1 = (await thumb.boundingBox()).width
    assert(w1 < w0 - 2, `寄れていない（つまみ ${Math.round(w0)} → ${Math.round(w1)}px）`)
    const zoomed = await xs()
    assert(
      zoomed.every((x, i) => i === 0 || x > zoomed[i - 1]),
      '拡大したら順序が崩れた'
    )

    // 真ん中を掴んで右へ＝見る所が動く（拡大率は変わらない）
    const tb = await thumb.boundingBox()
    const wBefore = tb.width
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2)
    await page.mouse.down()
    await page.mouse.move(tb.x + tb.width / 2 + 60, tb.y + tb.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(600)
    const moved = await page.locator('.zoom-bar-thumb').first().boundingBox()
    assert(moved.x > tb.x + 10, `掴んで動かしても見る所が変わらない（${Math.round(tb.x)} → ${Math.round(moved.x)}）`)
    assert(
      Math.abs(moved.width - wBefore) < 3,
      `移動なのに拡大率まで変わった（${Math.round(wBefore)} → ${Math.round(moved.width)}px）`
    )

    // 全体表示へ戻すと、元の位置関係に戻る
    await page.locator('.tool', { hasText: '↔' }).first().click()
    await page.waitForTimeout(600)
    const after = await xs()
    assert(after.length === before.length, 'クリップの数が変わった')
    assert(
      after.every((x, i) => i === 0 || x > after[i - 1]),
      `戻したら順序が崩れた（${after}）`
    )
  })

  await check('**Ctrl+ホイールで拡大すると、下の拡大バーも連れて動く**', async () => {
    // 拡大の入口は3つある（ホイール／バー／キーボード）が、
    // **見ている所を表しているのはバー1本だけ**。どの入口で寄っても
    // バーがそれを映していないと、「いまどこを見ているか」が読めなくなる。
    //
    // ここまで、バーは**自分を掴んだときしか**見られていなかった。
    // ホイールで寄ってもバーが動かない、は誰にも気づけない状態だった（本人が発見）。
    await resetProject()
    const thumb = page.locator('.zoom-bar-thumb').first()
    const inner = page.locator('.track-inner').first()
    const box = await inner.boundingBox()
    assert(box, 'タイムラインが見つからない')

    // **中身の幅も測る。**「つまみが動かない」だけでは、
    //   ・拡大はできているが、バーが映していない
    //   ・そもそも拡大していない
    // のどちらか分からない。**区別できない検査は、直す場所を教えてくれない**
    const innerW = async () => (await inner.boundingBox()).width

    const w0 = (await thumb.boundingBox()).width
    const iw0 = await innerW()
    await ctrlWheel(-120, 5)
    const w1 = (await thumb.boundingBox()).width
    const iw1 = await innerW()
    assert(
      iw1 > iw0 + 2,
      `そもそも拡大していない（中身の幅 ${Math.round(iw0)} → ${Math.round(iw1)}px）`
    )
    // 寄る＝見えている範囲が狭くなる＝つまみが細くなる
    assert(
      w1 < w0 - 2,
      `拡大はしたのにバーが映していない` +
        `（中身 ${Math.round(iw0)}→${Math.round(iw1)}px ／ つまみ ${Math.round(w0)}→${Math.round(w1)}px）`
    )

    // 引く方も見る。**寄る側だけ見ると、下限の食い違いを取り逃がす**
    await ctrlWheel(120, 8)
    const w2 = (await thumb.boundingBox()).width
    assert(
      w2 > w1 + 2,
      `ホイールで引いてもバーが戻らない（つまみ ${Math.round(w1)} → ${Math.round(w2)}px）`
    )
  })

  await check('**つまみの太さ ＝ いま見えている割合**（どの拡大率でも）', async () => {
    // ## なぜ「動いたか」ではなく「合っているか」を見るか
    //
    // 上の確認は「寄ったら細くなる」しか見ていない。**向きが合っていれば通る**ので、
    // 割合が半分でも倍でも気づけない。
    //
    // バーは「タイムライン全体のうち、いまどこを見ているか」を表す唯一の物なので、
    // **数が合っていないと読み違える**——本人が「拡大してもバーが伸び切ってるのは
    // おかしい」と言えたのは絵を見比べたからで、機械は何も言っていなかった。
    //
    // 見えている割合（表示幅 ÷ 中身の幅）と、つまみの割合（つまみ ÷ バー）を
    // **3つの拡大率で突き合わせる**。
    await resetProject()
    const 実測 = async () =>
      await page.evaluate(() => {
        const sc = document.querySelector('.track-scroll')
        const bar = document.querySelector('.zoom-bar')
        const th = document.querySelector('.zoom-bar-thumb')
        return {
          見え: sc.clientWidth / Math.max(1, sc.scrollWidth),
          つまみ: th.getBoundingClientRect().width / bar.getBoundingClientRect().width
        }
      })

    for (const [名, 回数] of [
      ['そのまま', 0],
      ['少し寄る', 4],
      ['もっと寄る', 8]
    ]) {
      if (回数) await ctrlWheel(-120, 回数)
      const r = await 実測()
      // **つまみには下限（28px）がある**ので、うんと寄せると割合は合わなくなる。
      // 下限に当たっていない範囲だけを見る（当たっていたら、そこは見ない）
      const 下限割合 = await page.evaluate(
        () => 28 / document.querySelector('.zoom-bar').getBoundingClientRect().width
      )
      if (r.つまみ <= 下限割合 + 0.005) continue
      const 差 = Math.abs(r.つまみ - r.見え)
      assert(
        差 < 0.03,
        `${名}: つまみの割合が実際と合っていない` +
          `（見えている ${(r.見え * 100).toFixed(1)}% / つまみ ${(r.つまみ * 100).toFixed(1)}%）`
      )
    }
  })

  await check('**バーで引き切ると、ホイールで引き切るのと同じ所まで行く**', async () => {
    // 入口が違っても行き着く先は同じでなければならない。
    // 2026-08-06 まで**バーだけ手前で止まっていた**（バーは 0〜1 に丸めていたので
    // 「全体がちょうど1画面」までしか行かず、ホイールは下限まで引けた）。
    // 動くので気づけない——**片方でしか行けない場所がある**のは読めない
    await resetProject()
    const 中身 = async () =>
      await page.evaluate(() => document.querySelector('.track-scroll').scrollWidth)

    await ctrlWheel(120, 30) // ホイールで引き切る
    const ホイール = await 中身()

    await ctrlWheel(-120, 10) // いったん寄せてから、今度はバーで引き切る
    const bar = await page.locator('.zoom-bar').first().boundingBox()
    const knob = await page.locator('.zbk-r').first().boundingBox()
    await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2)
    await page.mouse.down()
    // **バーの外まで引く。** 端で止めると「全体が1画面」までしか行かない
    await page.mouse.move(bar.x + bar.width + 400, knob.y + knob.height / 2, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(600)
    const バー = await 中身()

    assert(
      Math.abs(バー - ホイール) < 8,
      `行き着く先が違う（ホイール ${Math.round(ホイール)}px / バー ${Math.round(バー)}px）`
    )
  })
}
