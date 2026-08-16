// プレビューの**変形・拡大**と、重ねた動画まわり。
//
// `12-プレビュー.mjs` が 721行あったので出した（決まり: 600超は500以下に割る）。
//
// ## 順番の話
//
// **`12-プレビュー.mjs` の最後から呼ばれる。** 章の宣言はしない。
// 手前の「上書き」（12b）が置いたテロップが残っている前提の項目がある。

import { join } from 'node:path'

export default async function (C) {
  const {
    assert, avgColor, check, clipLayout, clipW, dragBy, outDir, page, placePiP,
    resetProject, seekTo, setDialogFiles, shotDir, touchedRef, trackHead, v1Clips
  } = C

  await check('**反転した映像を掴むと、掴んだ向きへ動く**', async () => {
    // 2026-08-17 まで**逆に動いていた**（右へ掴むと左へ行く）。
    //
    // ## なぜ今まで捕まらなかったか
    //
    // 掴む確認（12a の1件目）は `transform` の**文字列が変わったか**しか見て
    // いなかった。逆向きでも文字列は変わるので、**必ず緑になる**。
    // 反転を入れてから掴む道が、この確認群のどこにも無かった。
    //
    // ## 何で判定するか
    //
    // **絵が画面のどこへ出たか**（`getBoundingClientRect`）。transform を読むと
    // 「掛かっている物の一覧」しか分からず、**掛ける順番の間違いが見えない**
    // ——今回の不具合はまさに順番だった。矩形なら合成後の結果が出る。
    //
    // ## わざと壊して赤を見た（2026-08-17）
    //
    // `lib/clipXform` の `parts.push` の順を、translate が**後**に来るよう入れ替える。
    // → `右へ 120px 掴んで -120px。途中 -60px`（きれいに鏡映し）で落ちる。
    //
    // **最初に選んだ壊し方は効かなかった。** `usePreviewFrame` の
    // `moveThen(trans.move, curSegXform)` を逆にしても**緑のまま**だった——
    // 演出（slide）が掛かっていない場面では片方が undefined で、
    // 繋ぐ順が結果に出ない。**順番の本体は `clipXform` の中**にある。
    // ここを取り違えると「効くと確かめた」つもりの見張りが残る（QA の 4e）。
    // つなぎ目の演出と反転を重ねる道は、まだ機械で見ていない。
    await resetProject()
    await seekTo(12) // 画像（1〜5秒）と重ねた動画を外した所

    // **反転するのは「再生ヘッドの下にある切片」。** 先頭の切片を反転すると、
    // 画面に出ているのが別の切片のときに何も起きず、
    // 「左右反転が掛かっていない」で落ちる（実際に1回そうなった）。
    // クリップは3つあり、12秒の所に居るのが先頭とは限らない。
    const headX = await page
      .locator('.playhead')
      .first()
      .evaluate((el) => el.getBoundingClientRect().x)
    const clips = v1Clips()
    const n = await clips.count()
    assert(n, 'V1 に映像クリップが無い')
    let clip = null
    for (let i = 0; i < n; i++) {
      const b = await clips.nth(i).boundingBox()
      if (b && headX >= b.x - 1 && headX <= b.x + b.width + 1) {
        clip = clips.nth(i)
        break
      }
    }
    assert(clip, `再生ヘッド（x=${Math.round(headX)}）の下に V1 のクリップが無い`)
    await clip.click()
    await page.waitForTimeout(400)

    const flip = page.locator('button[title="左右反転"]').first()
    assert(await flip.count(), '「左右反転」のボタンが無い（切片を選べていない）')
    await flip.click()
    await page.waitForTimeout(400)

    const vid = page.locator('.screen-video').first()
    // **先に成立を確かめる。** 反転が入っていなければ、この項目は
    // ただの「掴んだら動く」になり、何も試さないまま緑になる
    const tf = await vid.evaluate((el) => el.style.transform || '')
    assert(tf.includes('scaleX(-1)'), `左右反転が掛かっていない（transform: ${tf || '空'}）`)

    const stage = await page.locator('.monitor-stage').first().boundingBox()
    const shot = (name) =>
      page.screenshot({
        path: join(shotDir, `flip-drag-${name}.png`),
        clip: {
          x: Math.round(stage.x),
          y: Math.round(stage.y),
          width: Math.round(stage.width),
          height: Math.round(stage.height)
        }
      })

    const rectX = () => vid.evaluate((el) => el.getBoundingClientRect().x)
    const box = await vid.boundingBox()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const x0 = await rectX()
    await shot('1-掴む前')

    // **右へ 120px。** 掴んでいる途中も1枚撮る（止め絵だけだと、
    // 「動いた結果」は見えても「どちらへ流れたか」を人が確かめられない）
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 60, cy, { steps: 5 })
    await page.waitForTimeout(150)
    await shot('2-動かしている最中')
    const xMid = await rectX()
    await page.mouse.move(cx + 120, cy, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    const x1 = await rectX()
    await shot('3-離した後')

    const 動いた = Math.round(x1 - x0)
    assert(
      Math.abs(動いた) > 20,
      `反転した映像を右へ 120px 掴んだのに、絵がほとんど動いていない（${動いた}px）`
    )
    assert(
      動いた > 0,
      `**反転した映像が、掴んだ向きと逆へ動いた**（右へ 120px 掴んで ${動いた}px。` +
        `途中 ${Math.round(xMid - x0)}px）。掛ける順番が逆＝反転した座標系の中で` +
        `動かしている（lib/clipXform の moveThen を見ること）`
    )
    // 途中の1枚も同じ向きであること（行って戻る動きになっていないか）
    assert(
      xMid - x0 > 0,
      `動かしている最中は逆へ流れている（途中 ${Math.round(xMid - x0)}px / 最後 ${動いた}px）`
    )
    touchedRef.dirty = true
    await resetProject()
  })
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
