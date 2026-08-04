// 打った動きが、保存と書き出しに本当に乗るか（＋プレビューで手で動かしたとき）
//
// 章: モーション（キーフレームで動かす）— **09-モーション.mjs の続き。章は分けていない**
//
// **09 から出しただけ。中身は1文字も変えていない**（2026-08-04）。
// 実行順を変えないための決まり（run.mjs の一覧へ足さない／章の名前を付け直さない）は
// e2e/checks/09c-写して配る.mjs の頭に書いてある。同じ理由でここも 09 から呼んでいる。
//
// ## ここは順番への寄りかかりが濃い。並べ替える前に必ず読むこと
//
// 印の付いている3つ（`{ orderDependent: true }`。理由は各項目の下）:
//   - 数値欄にカーソルを残したままでも、Ctrl+S で保存できる
//   - 書き出した動画でも、クリップが本当に寄っている
//   - 動きを付けた画像が、書き出しでも置いた場所から動かない
// **手前の項目を消す・順番を入れ替えると、絞った確認は緑のまま通しでだけ落ちる。**
//
// ここから下は 2026-08-04 に**印が無いまま見つけた**寄りかかり。
// どちらも中身は直していない（直すと判定そのものを見直すことになるため）。
//
// ### 先頭の「クリップの動きも、保存して開き直せば残っている」が `dirty` を立てない
//
// `resetProject()` は **`touchedRef.dirty` が false なら中身を戻さずに帰る**
// （e2e/run.mjs）。この項目は頭と尻で `resetProject()` を呼んでいるのに
// `touchedRef.dirty = true` を立てないので、**どちらの呼び出しも空振りしている。**
// 結果、Ctrl+S で動きを書き込んだ `fx.gcproj` を**開いたまま**次へ渡す。
// 次の「数値欄にカーソルを残したままでも…」に印が付いているのは、まさにこれが理由。
// **`dirty` を立てるなら、次の項目の判定ごと見直すこと**（勝手に立てると、
// 手前が残した中身を当てにしている側が黙って別の物を見る）。
//
// ### 末尾の「印を打った物をプレビューで動かすと…」も後始末をしない
//
// `touchedRef.dirty = true` を立てず、終わりに `resetProject()` もしない。
// 打った印と掴んで動かした位置は、そのまま e2e/checks/09b-Premiere取り込み.mjs の
// 1件目へ流れる（あちらは頭で戻さない）。**この塊を 09b より後ろへ動かさないこと。**

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export default async function (C) {
  const {
    RATIO,
    assert,
    avgColor,
    check,
    exactFrame,
    fillExportName,
    fx,
    outDir,
    page,
    resetProject,
    seekTo,
    setDialogFiles,
    setExportTarget,
    similarity,
    skipHere,
    touchedRef,
    v1Clips,
  } = C

  await check('クリップの動きも、保存して開き直せば残っている', async () => {
    // 読み込みは1項目ずつ拾う作りなので、**書き忘れると開いた瞬間に動きだけ消える**。
    // テロップの色で実際にやらかしている型の事故。
    //
    // ※ 欄から離れてから保存しているのは、**この項目を単独でも回せるようにするため**
    //    （直前の項目が数値欄にカーソルを残したまま終わる）。
    //    欄にカーソルを残したままでも保存できることは、別の項目で見ている
    //    （「数値欄にカーソルを残したままでも、Ctrl+S で保存できる」）。
    //
    // ※ ここも前の項目に寄りかからず、自分で動きを付けてから保存する。
    await resetProject()
    await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
    await v1Clips().nth(0).click()
    await page.waitForTimeout(300)
    const scRow = page.locator('.mo-row').filter({ hasText: '拡大' }).first()
    assert(await scRow.count(), 'モーションに動画の「拡大」が出ていない')
    await seekTo(0.4)
    if (!(await scRow.locator('.mo-watch.on').count())) await scRow.locator('.mo-watch').click()
    await page.waitForTimeout(300)
    await seekTo(3)
    await scRow.locator('.mo-val').fill('200')
    await scRow.locator('.mo-val').press('Enter')
    await page.waitForTimeout(400)
    await page.locator('.mo-head').first().click()
    await page.waitForTimeout(200)
    await page.keyboard.press('Control+s')
    await page.waitForTimeout(1600)
    const data = JSON.parse(readFileSync(fx.gcproj, 'utf-8'))
    const withMotion = (data.segments ?? []).filter((s) => s.motion)
    assert(withMotion.length > 0, '保存した中身にクリップの動きが入っていない')
    assert(
      Array.isArray(withMotion[0].motion.sc) && withMotion[0].motion.sc.length >= 2,
      `印が2つ以上入っていない: ${JSON.stringify(withMotion[0].motion)}`
    )
    // 開き直して、画面にも残っているか（保存はできていても読めていない、が起きる）
    await setDialogFiles([fx.gcproj], null)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(2500)
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) {
      await cont.click()
      await page.waitForTimeout(1500)
    }
    const marks = await v1Clips().nth(0).locator('.kf-mark').count()
    assert(marks >= 2, `開き直したら帯の印が消えた（${marks}個）`)
    // 保存したファイルを開いた状態で終わると、以降の項目が別の中身を見る
    await resetProject()
  })

  await check('数値欄にカーソルを残したままでも、Ctrl+S で保存できる', async () => {
    // 報告された不具合: 値を入れた直後の Ctrl+S が効かず、欄の外を1回
    // クリックしてからでないと保存できなかった。
    // **「保存したつもり」を作る**ので、作業が消える事故に直結する。
    //
    // どのキーを受けるかの判断そのものは src/shared/keymap.test.ts で見ている。
    // ここで見るのは**アプリに繋がっているか**（画面側に別の関門が残っていないか）。
    await v1Clips().nth(0).click()
    await page.waitForTimeout(300)
    await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
    await page.waitForTimeout(300)
    const row = page.locator('.mo-row').filter({ hasText: '拡大' }).first()
    await seekTo(1)
    await row.locator('.mo-watch').click()
    await page.waitForTimeout(300)
    await seekTo(3)
    const val = row.locator('.mo-val')
    await val.fill('150')
    await val.press('Enter')
    await page.waitForTimeout(400)
    // ★ここで欄から出ない。カーソルを残したまま保存する
    const focused = await page.evaluate(
      () => (document.activeElement)?.className ?? ''
    )
    assert(focused.includes('mo-val'), `数値欄にカーソルが残っていない（${focused}）`)
    await page.keyboard.press('Control+s')
    await page.waitForTimeout(1800)
    const data = JSON.parse(readFileSync(fx.gcproj, 'utf-8'))
    assert(
      (data.segments ?? []).some((s) => s.motion),
      '欄にカーソルを残したまま保存しても、中身が書かれていない'
    )
    touchedRef.dirty = true
    await resetProject()
  },
  // **手前の項目が残した状態（開いてあるプロジェクトと打った値）に寄りかかっている。**
  // 自分では resetProject を呼ばないので、絞って回すと保存する中身が無い。
  { orderDependent: true })

  await check('書き出した動画でも、クリップが本当に寄っている', async () => {
    // 縦長では**元動画（横長）と直接比べられない**（上下に黒帯が入るため）。
    // 寄せの計算そのものは比率に依らないので、ここは 16:9 で見る。
    if (RATIO !== '16:9') skipHere('元動画（横長）と直接比べる作りなので、縦長では成り立たない')
    // **ここが本番。** プレビューで寄っても、書き出しで寄らなければ意味が無い。
    //
    // 「前と後ろの絵が違う」だけでは通ってしまう（元動画の中身が動いているので、
    // 寄っていなくても違う絵になる）。そこで**元動画のその瞬間を自分で2倍に寄せた物**を
    // 作り、書き出した絵がそちらに近いか、寄せていない物に近いかで判定する。
    //
    // 測る場所は**何も重なっていない所**にする。1つ目の切片（0〜5秒）は画像（1〜5秒）と
    // テロップ（1〜3秒）が乗っていて、元動画と比べられない。2つ目（5〜10秒）の
    // 後半なら、テロップ（6〜8秒）も終わっていて元動画の絵がそのまま出ている。
    await v1Clips().nth(1).click() // 2つ目の切片（タイムライン 5〜10秒 ＝ 元動画の 5〜10秒）
    await page.waitForTimeout(300)
    await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
    await page.waitForTimeout(300)
    const row = page.locator('.mo-row').filter({ hasText: '拡大' }).first()
    await seekTo(5.2)
    await row.locator('.mo-watch').click() // 5.2秒に 100% の印
    await page.waitForTimeout(300)
    await seekTo(9)
    await row.locator('.mo-val').fill('200') // 9秒に 200% の印
    await row.locator('.mo-val').press('Enter')
    await page.waitForTimeout(400)
    await page.locator('.mo-head').first().click() // 数値欄から出る（出ないとキーが通らない）
    await page.waitForTimeout(200)

    const out = join(outDir, 'clip-motion.mp4')
    await setExportTarget(out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
    await fillExportName(out)
    await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
    await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 240000 })
    assert(existsSync(out), '書き出しファイルができていない（zoompan の式が通っていない可能性）')

    const T = 9 // 2倍まで寄りきった時刻（この切片は 元動画の時刻＝タイムラインの時刻）
    const small = 'scale=320:180'
    const got = await exactFrame(out, T, join(outDir, 'cm-got.png'), small)
    const want2x = await exactFrame(
      fx.video,
      T,
      join(outDir, 'cm-2x.png'),
      `crop=iw/2:ih/2,${small}`
    )
    const want1x = await exactFrame(fx.video, T, join(outDir, 'cm-1x.png'), small)
    const s2 = await similarity(got, want2x)
    const s1 = await similarity(got, want1x)
    assert(
      s2 > s1 + 0.05,
      `書き出した絵が寄っていない（2倍に寄せた物との一致 ${s2} / 寄せていない物との一致 ${s1}）`
    )
    touchedRef.dirty = true
    await resetProject()
  },
  // **手前の項目が残した拡大の状態に寄りかかっている。**
  // 絞って回すと寄っていない絵を書き出すので、一致がひっくり返って必ず赤くなる
  //（通しでは緑。stash して変更前と比べ、同じ数値 0.181423 / 0.190236 で落ちるのを確かめた）。
  { orderDependent: true })

  await check('色調整を掛けたクリップが、書き出しでも明るくなる', async () => {
    // **配布物でだけ書き出しが止まっていた所。** 色調整に GPL 専用の eq を
    // 使っていて、同梱の LGPL 版には入っていなかった。
    // 開発機は PATH の GPL 版を拾うので、画面でも書き出しでも気づけない。
    //
    // ここでは「エラーにならない」だけでなく、**本当に明るくなったか**まで見る。
    // 通っただけなら、フィルタが黙って無視されていても合格してしまう。
    await resetProject()
    await v1Clips().nth(1).click() // 2つ目の切片（5〜10秒。重なる物が無い区間がある）
    await page.waitForTimeout(400)
    const bright = page.locator('.sp-row').filter({ hasText: '明るさ' }).locator('input[type="range"]').first()
    assert(await bright.count(), '「明るさ」のつまみが見つからない')
    await bright.fill('1.6')
    await page.waitForTimeout(500)

    const out = join(outDir, 'adjust.mp4')
    await setExportTarget(out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
    await fillExportName(out)
    await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
    await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 240000 })
    assert(existsSync(out), '書き出しファイルができていない（色調整のフィルタが通っていない）')

    // 同じ時刻の「元動画そのまま」と比べて、明るくなっているか
    const T = 9
    const got = await exactFrame(out, T, join(outDir, 'adj-got.png'), 'scale=320:180')
    const src = await exactFrame(fx.video, T, join(outDir, 'adj-src.png'), 'scale=320:180')
    const a = await avgColor(got)
    const b = await avgColor(src)
    assert(
      a.y > b.y + 5,
      `書き出した絵が明るくなっていない（元 ${b.y} → 書き出し ${a.y}）＝色調整が効いていない`
    )
    touchedRef.dirty = true
    await resetProject()
  })

  await check('動きを付けた画像が、書き出しでも置いた場所から動かない', async () => {
    // ここも元動画（横長）と直接比べる作り。縦長では黒帯が入って必ず食い違う
    if (RATIO !== '16:9') skipHere('元動画（横長）と直接比べる作りなので、縦長では成り立たない')
    // 画像は元が1枚しか無いので、書き出しでは**尺のぶんだけ増やしてから**動かす。
    // 増やしたものは時刻0から並ぶので、置いた時刻へずらし直す必要がある。
    // ずらし忘れると「重なる窓が開く頃には最後の1枚で止まっている」＝
    // 動かないのに書き出しは成功する、という気づけない壊れ方をする。
    await page.locator('.img-clip').first().click() // 画像は 1〜5秒（V3）
    await page.waitForTimeout(300)
    await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
    await page.waitForTimeout(300)
    const row = page.locator('.mo-row').filter({ hasText: '拡大' }).first()
    assert(await row.count(), '画像を選んでもモーションタブに「拡大」が出ない')
    await seekTo(1.2)
    await row.locator('.mo-watch').click()
    await page.waitForTimeout(300)
    await seekTo(4.5)
    await row.locator('.mo-val').fill('200')
    await row.locator('.mo-val').press('Enter')
    await page.waitForTimeout(400)
    await page.locator('.mo-head').first().click()
    await page.waitForTimeout(200)

    const out = join(outDir, 'img-motion.mp4')
    await setExportTarget(out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
    await fillExportName(out)
    await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
    await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 240000 })
    assert(existsSync(out), '書き出しファイルができていない')

    const small = 'scale=320:180'
    // その時刻の「元動画そのまま」とどれだけ同じか。画像が乗っていれば大きく下がる。
    const bare = async (t) => {
      const a = await exactFrame(out, t, join(outDir, `im-got-${t}.png`), small)
      const b = await exactFrame(fx.video, t, join(outDir, `im-src-${t}.png`), small)
      return similarity(a, b)
    }
    const before = await bare(0.5) // 画像が出る前（1秒より手前）
    const during = await bare(4) // 画像が出ている最中（寄りきる手前）
    const after = await bare(5.5) // 画像が終わった後
    assert(before > 0.9, `画像が出る前なのに元動画と違う（${before}）＝前へはみ出している`)
    assert(after > 0.9, `画像が終わった後なのに元動画と違う（${after}）＝後ろへはみ出している`)
    assert(during < 0.9, `画像が出ている最中なのに元動画と同じ（${during}）＝画像が写っていない`)
    touchedRef.dirty = true
    await resetProject()
  },
  // **手前の項目が付けた動きに寄りかかっている**（自分では付け直さない）。
  // 絞って回すと動いていない絵を書き出すので、比べた結果がひっくり返る。
  { orderDependent: true })

  // **印を打った物を、プレビューで手で動かしたらどうなるか。**
  //
  // ここが逆だと「動きが消える」。印を打ってある項目を手で動かしたとき、
  // 固定値の方を書き換えてしまうと、**打った印が全部無視される**
  // （画面では動かしたつもりなのに、流すと元の道すじへ戻る）。
  // 正しくは「**いまの時刻に印を打ち直す**」。
  //
  // 仕組みは state/usePreviewManip に書いてあるが、**確認が1つも無かった**
  // （やること.md の「連動を確認」。2026-08-03 に足した）。
  await check('印を打った物をプレビューで動かすと、その時刻に印が付く', async () => {
    await resetProject()
    await page.locator('.telop-clip').first().click()
    await page.waitForTimeout(300)
    await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
    await page.waitForTimeout(300)
    const row = page.locator('.mo-row').filter({ hasText: '位置 X' }).first()
    assert(await row.count(), 'モーションタブに「位置 X」が無い')

    // テロップは 1〜3秒。頭で ⏱ を押して、印のある状態にする
    await seekTo(1.2)
    await page.waitForTimeout(300)
    await row.locator('.mo-watch').click()
    await page.waitForTimeout(400)
    // **印の数は画面に出ていない。** ◆ は「いまの時刻に印があるか」の1つだけ
    // （点いていれば有る）。なので「その時刻に印が付いたか」で見る。
    const hasKeyHere = async () => (await row.locator('.mo-diamond.on').count()) === 1
    assert(await hasKeyHere(), '⏱ を押しても、その時刻に印が付かない')

    // 別の時刻へ行って、**プレビューの文字を掴んで動かす**
    await seekTo(2.4)
    await page.waitForTimeout(400)
    const tel = page.locator('.telop-overlay .telop-textmain').first()
    assert(await tel.count(), '文字がプレビューに出ていない')
    const b = await tel.boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(b.x + b.width / 2 - i * 8, b.y + b.height / 2)
      await page.waitForTimeout(10)
    }
    await page.mouse.up()
    await page.waitForTimeout(500)

    // **動かした時刻に印が付いている**のが正しい（固定値を書き換えたなら付かない）
    assert(
      await hasKeyHere(),
      '手で動かしても、その時刻に印が付かない＝固定値の方を書き換えている'
    )

    // **打った所へ戻ると、打った位置に居る**（＝印が効いている）
    const xAt = async () =>
      (await page.locator('.telop-overlay .telop-textmain').first().boundingBox())?.x ?? null
    const xNow = await xAt()
    await seekTo(1.2)
    await page.waitForTimeout(500)
    const xHead = await xAt()
    assert(
      xHead != null && xNow != null && Math.abs(xHead - xNow) > 20,
      `頭へ戻っても位置が変わらない（${xHead} / ${xNow}）＝印が効いていない`
    )
  })
}
