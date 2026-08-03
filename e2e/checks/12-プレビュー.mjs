// プレビューでの直接操作・上書き・重ね順
//
// 章: 6-8. プレビュー操作・文字・重ねた動画
//
// **通しの本体は e2e/run.mjs から分けてある。** 1ファイル7,400行だと、
// 直したい章を探すのに毎回全部を読むことになり、足す場所も決まらないので
// 「仕上げ」に流れ込んでいた。道具（check・assert・素材づくり）は
// run.mjs 側に置いたままで、まとめて受け取る。

import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export default async function (C) {
  const {
    placePiP,
    assert,
    avgColor,
    check,
    trackHead,
    clipLayout,
    clipW,
    dragBy,
    outDir,
    page,
    resetProject,
    section,
    seekTo,
    setDialogFiles,
    touchedRef,
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

  await check('プレビューで動かした文字を、その場で元へ戻せる', async () => {
    // **動かす手段はあるのに戻す手段が無かった。** 動画・画像には枠のバーに
    // リセットがあるのに、テロップにだけ無く、行き過ぎたら手で戻すしかなかった
    // （元の位置は誰も覚えていない）。
    await resetProject()
    await seekTo(2)
    const t0 = page.locator('.telop-box').first()
    assert(await t0.count(), 'プレビューに文字が出ていない')
    const yOf = async () => (await t0.boundingBox())?.y ?? null
    const before = await yOf()
    assert(before != null, '文字の位置が測れない')
    // 掴んで上へ動かす
    const b = await t0.boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - (80 * i) / 5)
    await page.mouse.up()
    await page.waitForTimeout(400)
    const moved = await yOf()
    assert(moved != null && before - moved > 20, `動かせていない（${before} → ${moved}）`)
    // バーの「戻す」を押す
    const btn = page.locator('button', { hasText: '位置と動きを戻す' }).first()
    assert(await btn.count(), 'テロップのバーに戻すボタンが無い')
    await btn.click()
    await page.waitForTimeout(400)
    const after = await yOf()
    assert(
      after != null && Math.abs(after - before) < 6,
      `元の位置に戻っていない（元 ${before} / 動かした後 ${moved} / 戻した後 ${after}）`
    )
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

  await check('スクショが保存でき、映像がちゃんと写っている', async () => {
    // **保存されない、が実際に起きていた。** しかも例外なので保存の窓すら出ず、
    // 押しても何も起きないように見える（映像を描いた回だけ、キャンバスが
    // 「汚れた」扱いになって toDataURL() が投げていた）。
    //
    // **「ファイルができた」だけでは足りない。** 映像を描き損ねて真っ黒でも
    // ファイルはできるので、**中身が黒一色でないこと**まで見る。
    await resetProject()
    await seekTo(1)
    await page.waitForTimeout(600)
    const out = join(outDir, 'shot-check.png')
    if (existsSync(out)) rmSync(out)
    await setDialogFiles(null, out)
    const btn = page.locator('button', { hasText: '📷' }).first()
    assert(await btn.count(), 'スクショのボタンが見つからない')
    await btn.click()
    await page.waitForTimeout(2500)
    assert(existsSync(out), 'スクショのファイルができていない（黙って失敗している）')
    // **明るさ（YAVG）と明暗の幅（range）の両方を見る。**
    // 真っ黒なら明るさが出ないし、テロップだけ写って映像が抜けていても
    // 平均は上がりうるので、模様があること（range）まで確かめる
    const c = await avgColor(out)
    assert(c.y != null && c.y > 8, `スクショが真っ黒（映像が写っていない）: 明るさ ${c.y}`)
    assert(c.range != null && c.range > 40, `スクショに模様が無い: 明暗の幅 ${c.range}`)
  })

  // **スクショは「いま見えている物」を撮る。** 本編の映像だけを描いていたので、
  // 画像や重ねた動画で作っている画面は真っ黒で保存されていた
  //（本人から「画像のみだとスクショできない」）。
  // ここでは本編を👁で隠して、**画像しか出ていない状態**で撮る。
  await check('本編の映像を隠しても、画像はスクショに写る', async () => {
    await resetProject()
    await seekTo(4) // 画像は 1〜5秒。文字は 1〜3 と 6〜8 なので、ここには出ない
    const eye = () => trackHead('V1').locator('button[title="表示/非表示"]').first()
    await eye().click()
    await page.waitForTimeout(600)
    const out = join(outDir, 'shot-img.png')
    if (existsSync(out)) rmSync(out)
    await setDialogFiles(null, out)
    await page.locator('button', { hasText: '📷' }).first().click()
    await page.waitForTimeout(2500)
    assert(existsSync(out), 'スクショのファイルができていない')
    // 本編を隠しているので、画像を描けていなければ真っ黒になる
    const c = await avgColor(out)
    assert(c.y != null && c.y > 8, `真っ黒＝画像が写っていない: 明るさ ${c.y}`)
    assert(c.range != null && c.range > 40, `模様が無い＝画像が写っていない: 明暗の幅 ${c.range}`)
    await eye().click() // 元に戻す（次の項目が真っ黒から始まらないように）
    await page.waitForTimeout(300)
  })

  // **映像の枠の縦横比は、モニタ区画の形に関わらず保たれること。**
  // 崩れると、中の映像だけ小さくなって（object-fit: contain）枠の中に余白ができる。
  // テロップは**枠の高さ**を基準に置いているので、そのぶん大きく・外側に出る
  //（本人「プレビューの枠を大きくし過ぎるとテロップがズレる／右へはみ出して切れる」）。
  await check('モニタを細くしても、映像の枠の縦横比は保たれる', async () => {
    await resetProject()
    const got = await page.evaluate(() => {
      const st = document.querySelector('.monitor-stage')
      const sc = document.querySelector('.screen')
      if (!st || !sc) return null
      const keep = st.style.width
      const out = []
      for (const w of ['1200px', '600px', '320px']) {
        st.style.width = w
        const b = sc.getBoundingClientRect()
        out.push({ w, r: b.height > 0 ? +(b.width / b.height).toFixed(3) : null })
      }
      st.style.width = keep
      return out
    })
    assert(got, 'モニタ区画が見つからない')
    const want = 16 / 9
    const bad = got.filter((g) => g.r == null || Math.abs(g.r - want) > 0.02)
    assert(
      bad.length === 0,
      `縦横比が崩れている（欲しい ${want.toFixed(3)}／` +
        got.map((g) => `${g.w}→${g.r}`).join('、') +
        '）'
    )
  })

  // **プレビューだけの拡大。** 細かい所（縁の太さ・アイコンの縁）を見るための物で、
  // 書き出しにも保存にも関わらない。等倍へ戻せることまで見る
  //（片道だけ効くと、寄せたまま戻れなくなる）。
  await check('プレビューを寄せられて、等倍に戻せる', async () => {
    await resetProject()
    const screenW = async () =>
      Math.round((await page.locator('.screen').first().boundingBox()).width)
    const base = await screenW()
    assert(base > 0, '映像の枠が見つからない')
    const group = page.locator('.pz-group')
    assert(await group.count(), 'プレビューの拡大の口が無い')
    await group.locator('.chip', { hasText: '＋' }).first().click()
    await page.waitForTimeout(400)
    const zoomed = await screenW()
    assert(zoomed > base + 4, `寄せられていない（${base} → ${zoomed}）`)
    // 真ん中の割合表示が「全体表示に戻す」を兼ねている
    await group.locator('.chip', { hasText: '%' }).first().click()
    await page.waitForTimeout(400)
    const back = await screenW()
    assert(Math.abs(back - base) <= 2, `等倍に戻せない（${zoomed} → ${back}／元 ${base}）`)
  })

  // **縦書き。** プレビューも書き出しも同じ `buildTelopSVG` を通るので、
  // ここで縦になっていれば書き出しも縦になる（画面と書き出しで別々の式を持たない）。
  // 見るのは**実際に描かれた形**——縦に組めていれば、横長だった文字の箱が縦長になる。
  await check('横書き／縦書きを切り替えると、文字の並びが縦になる', async () => {
    await resetProject()
    await seekTo(2)
    await page.waitForSelector('.telop-overlay .telop-textmain', { timeout: 8000 })
    const shape = async () => {
      const b = await page.locator('.telop-overlay .telop-textmain').first().boundingBox()
      return b ? { w: Math.round(b.width), h: Math.round(b.height) } : null
    }
    const yoko = await shape()
    assert(yoko && yoko.w > yoko.h, `横書きなのに横長でない（${JSON.stringify(yoko)}）`)

    // 文字を選んでから切り替える（選んでいる物にも当たる作りにしてある）
    await page.locator('.telop-clip').first().click()
    await page.waitForTimeout(300)
    const tate = page.locator('.chip', { hasText: '縦書き' }).first()
    assert(await tate.count(), '「縦書き」の切り替えが無い')
    await tate.click()
    await page.waitForTimeout(700)
    const got = await shape()
    assert(got && got.h > got.w, `縦書きにしたのに縦長にならない（${JSON.stringify(got)}）`)

    // 戻せること（片道だけ効く状態に気づけない）
    await page.locator('.chip', { hasText: '横書き' }).first().click()
    await page.waitForTimeout(700)
    const back = await shape()
    assert(back && back.w > back.h, `横書きへ戻せない（${JSON.stringify(back)}）`)
  })

  await check('テロップを重ねて置くと、重なった分が消える（上書き）', async () => {
    // **動画クリップは元から上書きされるのに、テロップだけ重なったまま残っていた。**
    // 画面では前後に重なって見えるだけで、どちらが出ているのか分からない。
    //
    // 判定そのものは shared/overwrite の試験で見ているので、ここは
    // 「掴んで落としたときに、本当にその道を通るか」だけを見る。
    await resetProject()
    const bands = () => page.locator('.telop-clip')
    assert((await bands().count()) >= 2, 'テロップが2つ以上ないと重ねられない')
    const box = async (i) => await bands().nth(i).boundingBox()
    const a = await box(0)
    const b = await box(1)
    const wBefore = b.width
    assert(wBefore > 20, `2つ目が細すぎて確かめられない（${wBefore}px）`)

    // 1つ目を右へ運んで、2つ目の頭へ食い込ませる（2つ目の幅の3割ほど）
    const bite = Math.round(b.width * 0.3)
    const toX = b.x + bite - a.width / 2
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(toX, a.y + a.height / 2, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(600)

    // 2つ目は、食い込まれた分だけ頭が削れて短くなっているはず
    const after = await page.locator('.telop-clip').nth(1).boundingBox()
    assert(after, '2つ目のテロップが消えてしまった（削りすぎ）')
    assert(
      after.width < wBefore - 4,
      `重ねても2つ目が短くなっていない（${Math.round(wBefore)} → ${Math.round(after.width)}px）`
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
