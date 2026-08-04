// プレビューの**変形・拡大**と、重ねた動画まわり。
//
// `12-プレビュー.mjs` が 721行あったので出した（決まり: 600超は500以下に割る）。
//
// ## 順番の話
//
// **`12-プレビュー.mjs` の最後から呼ばれる。** 章の宣言はしない。
// 手前の「上書き」（12b）が置いたテロップが残っている前提の項目がある。

export default async function (C) {
  const {
    assert, avgColor, check, clipLayout, clipW, dragBy, outDir, page, placePiP,
    resetProject, seekTo, setDialogFiles, touchedRef, trackHead, v1Clips
  } = C
  await check('打ち直しの欄は、左右のパネルを押しても消えない（タイムラインでは消える）', async () => {
    // **打ちながら色やフォントを直しに行くのは、同じ一続きの作業。**
    // そこで閉じると、打ちかけの文字と「変えたかった選択そのもの」が消える
    // （左パネルの「その文字だけ変える」は、まさにその選択を見ている）。
    //
    // ただし**閉じる方も一緒に見る。** 片方だけ見ると「どこを押しても消えない」
    // ようにしてしまっても気づけない（＝Enter を押すまで終われない状態に戻る）。
    await resetProject()
    await seekTo(2)
    const tel = page.locator('.telop-overlay > *').first()
    assert(await tel.count(), 'プレビューに文字が出ていない')
    const editor = page.locator('.telop-editor')
    const open = async () => {
      await tel.dblclick()
      await page.waitForTimeout(400)
      assert(await editor.count(), '打ち直しの欄が出ない')
    }

    await open()
    // 右パネル → 消えない
    await page.locator('[data-editor-safe]').last().click({ position: { x: 8, y: 60 } })
    await page.waitForTimeout(400)
    assert(await editor.count(), '右パネルを押しただけで打ち直しの欄が消えた')
    // 左パネル → 消えない
    await page.locator('[data-editor-safe]').first().click({ position: { x: 8, y: 60 } })
    await page.waitForTimeout(400)
    assert(await editor.count(), '左パネルを押しただけで打ち直しの欄が消えた')

    // タイムラインのクリップ → 消える（ここは今までどおり「外」）
    await v1Clips().nth(0).click()
    await page.waitForTimeout(400)
    assert((await editor.count()) === 0, 'タイムラインを押しても打ち直しの欄が消えない')
    await resetProject()
  })

  await check('拡大の中心を決めると、そこへ向かって寄る', async () => {
    // **基準点は画面だけの道具で、絵に残るのは今までどおりの位置（x/y）だけ。**
    // だから確かめるのは「基準点を置いて拡大したら、位置が計算どおりに入るか」。
    // 式は shared/clipMotion の zoomOffsetForAnchor:  x = (0.5 - 基準点) * (拡大 - 1)
    //
    // 拡大は**モーションタブの数値欄**から変える。四隅を掴んだときだけ効く作りだと、
    // 数値で拡大した人には「基準点が効かない」ままなので、そちらの道で見る。
    await resetProject()
    await v1Clips().nth(0).click()
    await page.waitForTimeout(400)

    const anchorBtn = page.locator('.reframe-btn').filter({ hasText: '拡大の中心' }).first()
    assert(await anchorBtn.count(), 'プレビューに「拡大の中心」のボタンが出ていない')
    assert((await page.locator('.zoom-anchor').count()) === 0, '押す前からマーカーが出ている')
    await anchorBtn.click()
    await page.waitForTimeout(300)
    assert(await page.locator('.zoom-anchor').count(), '押してもマーカーが出ない')

    // 画面の 25% / 75% の所へマーカーを持っていく
    const scr = await page.locator('.screen').first().boundingBox()
    const mark = await page.locator('.zoom-anchor').first().boundingBox()
    const to = { x: scr.x + scr.width * 0.25, y: scr.y + scr.height * 0.75 }
    await page.mouse.move(mark.x + mark.width / 2, mark.y + mark.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(400)

    // 拡大を 200% に（基準点を置いた道とは別の道から変える）
    await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
    const row = () => page.locator('.mo-row').filter({ hasText: '拡大' }).first()
    await row().locator('.mo-val').fill('200')
    await row().locator('.mo-val').press('Enter')
    await page.waitForTimeout(600)

    const tr = await page.evaluate(
      () => document.querySelector('.screen-video')?.style.transform ?? ''
    )
    const m = /translate\((-?[\d.]+)%,\s*(-?[\d.]+)%\)\s*scale\(([\d.]+)\)/.exec(tr)
    assert(m, `プレビューの変換が読めない（「${tr}」）`)
    const [x, y, s] = [Number(m[1]), Number(m[2]), Number(m[3])]
    assert(Math.abs(s - 2) < 0.01, `拡大が 200% になっていない（${s}）`)
    // 基準点(0.25, 0.75)・拡大2倍 → x = +25% / y = -25%
    // **ここが 0 のままなら、基準点が効かず真ん中へ寄っている**（＝直す前の状態）
    assert(Math.abs(x - 25) < 3, `横の寄り先が違う（${x}%。25% のはず）`)
    assert(Math.abs(y + 25) < 3, `縦の寄り先が違う（${y}%。-25% のはず）`)

    // もう一度押せばしまえる（出しっぱなしだと絵の確認の邪魔になる）
    await anchorBtn.click()
    await page.waitForTimeout(200)
    assert((await page.locator('.zoom-anchor').count()) === 0, 'もう一度押してもしまえない')
    touchedRef.dirty = true
    await resetProject()
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
  },
  // **左パネルに拡大のつまみが出ている状態**が要る。それを作るのは手前の章
  //（クリップを選び、プロパティを開いた状態）で、この章だけ絞って回すと
  // 何も選ばれておらず `.sp-row` が1つも無い＝「つまみが出ていない」で必ず落ちる。
  // ここで自分で選び直すと、確かめたい所（上限が 800% か）から遠くなる。
  { orderDependent: true })

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

  // **画面が先回りして出さない。** 前は「先頭が 0.5秒 以内から始まるなら
  // 頭の隙間を埋める」ために画面側だけ 0秒 から出していた。書き出しは
  // 引き延ばしていないので、**プレビューに出ている物が製品に無い**状態だった
  //（本人から「まだ来ていないテロップが動画の頭で出ている」と上がった）。
  // 判定を1つに寄せた経緯は src/shared/cueWindow.ts の頭。
  await check('動画の頭で、まだ始まっていないテロップは出ない', async () => {
    await resetProject()
    // 文字は 1〜3秒。**0.5秒より手前**へ運ぶ（そこが引き延ばされていた範囲）
    const pxPerSec = (await clipW()) / 5
    await dragBy(page.locator('.telop-clip').nth(0), -0.7 * pxPerSec)
    await page.waitForTimeout(400)
    // 準備が成立しているか先に見る。0秒ちょうどへ吸い付いていたら
    // 「出ないこと」を確かめても意味が無い（本当に出るのが正しいので）
    const x0 = (await clipLayout())[0].x // V1 の1本目の左端＝時刻0
    const bx = (await page.locator('.telop-clip').nth(0).boundingBox()).x
    const startSec = (bx - x0) / pxPerSec
    assert(
      startSec > 0.05 && startSec < 0.5,
      `準備が成立していない（文字の開始 ${startSec.toFixed(2)}秒。0.05〜0.5秒に置きたい）`
    )
    await seekTo(0)
    await page.waitForTimeout(400)
    const shown = await page.locator('.telop-overlay .telop-textmain').count()
    assert(shown === 0, `始まる前なのに ${shown} 枚出ている（開始 ${startSec.toFixed(2)}秒）`)
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
