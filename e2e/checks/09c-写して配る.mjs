// 動きを写して配る（項目コピー・見本帳から掴んで落とす・貼り付けの取り合い）
//
// 章: モーション（キーフレームで動かす）— **09-モーション.mjs の続き。章は分けていない**
//
// **09 から出しただけ。中身は1文字も変えていない**（2026-08-04）。
// あちらは1,131行に20項目あって、1つ足すたびに全部を読む羽目になっていた。
//
// ## 実行順を1ミリも変えないための決まり
//
// - **run.mjs の章一覧には足していない。** 09 の中から、元あった位置でそのまま呼ぶ。
//   一覧へ足すと、後から「番号順に並べ直そう」とされたときに実行順が黙って入れ替わる
//   （09b は末尾の塊だったので一覧へ足せた。ここは**途中の塊**なので足せない）。
// - **章の名前を付け直す `C.section()` を呼ばない。** 呼ぶと run.mjs が覚えている
//   章の名前が変わる。`--only` は「項目名か章の名前にその語が含まれるか」で選ぶ
//   （run.mjs の `check`）ので、**絞ったときに選ばれる顔ぶれが変わってしまう**。
//   章は 09 の1つのままにしてある。
//
// ## 順番への寄りかかり（この塊には無い）
//
// 6項目とも**頭と尻で `resetProject()` を呼ぶ**ので、手前が残した状態に
// 寄りかかっていない（`{ orderDependent: true }` は1つも無い）。
// だから 09 と 09d の境目に印を足す必要が無く、ここで切った。
//
// **末尾の `resetProject()` を消さないこと。** 次（09d の先頭）は
// まっさらな状態から始まる前提で書いてある。

import { makeDropChip } from '../lib/dropChip.mjs'

export default async function (C) {
  const {
    assert,
    check,
    closeTransAccs,
    page,
    resetProject,
    seekTo,
    touchedRef,
    v1Clips,
  } = C

  await check('モーションは項目を選んでコピーでき、種類の違う物には入らない', async () => {
    // プレミアの「エフェクトコントロール」と同じ。項目（や組）を選んでコピーし、
    // 別のクリップを選んで貼ると、その項目だけが移る。
    //
    // **種類を跨がないことまで見る。** テロップの動きを写して動画へ貼っても
    // 入らない（項目そのものが別物なので、入ると壊れる）。
    await resetProject()
    await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()

    // 1つ目の切片に「拡大」の動きを打つ
    await v1Clips().nth(0).click()
    await page.waitForTimeout(300)
    const row = () => page.locator('.mo-row').filter({ hasText: '拡大' }).first()
    await seekTo(0.4)
    await row().locator('.mo-watch').click()
    await seekTo(3)
    await row().locator('.mo-val').fill('180')
    await row().locator('.mo-val').press('Enter')
    await page.waitForTimeout(400)
    assert((await v1Clips().nth(0).locator('.kf-mark').count()) > 0, '1つ目に印が付かない')

    // 項目名を押して選ぶ → コピー
    await row().locator('.mo-label').click()
    await page.waitForTimeout(200)
    assert(
      (await page.locator('.mo-row.mo-picked').count()) === 1,
      '項目を押しても選ばれた見た目にならない'
    )
    await page.keyboard.press('Control+c')
    await page.waitForTimeout(300)

    // 2つ目の切片へ貼り付け
    await v1Clips().nth(1).click()
    await page.waitForTimeout(300)
    assert(
      (await v1Clips().nth(1).locator('.kf-mark').count()) === 0,
      '貼り付ける前から2つ目に印がある'
    )
    await page.keyboard.press('Control+v')
    await page.waitForTimeout(500)
    const marks = await v1Clips().nth(1).locator('.kf-mark').count()
    assert(marks > 0, `貼り付けても2つ目に印が入らない（${marks}個）`)

    // テロップの動きは、動画には入らない
    await page.locator('.telop-clip').first().click()
    await page.waitForTimeout(300)
    const trow = page.locator('.mo-row').filter({ hasText: '位置 X' }).first()
    assert(await trow.count(), 'テロップのモーションに「位置 X」が無い')
    await seekTo(0.2)
    await trow.locator('.mo-watch').click()
    await page.waitForTimeout(300)
    await trow.locator('.mo-label').click()
    await page.waitForTimeout(200)
    await page.keyboard.press('Control+c')
    await page.waitForTimeout(300)
    // 動画の切片へ貼っても入らない（項目が別物なので）
    await v1Clips().nth(2).click()
    await page.waitForTimeout(300)
    await page.keyboard.press('Control+v')
    await page.waitForTimeout(500)
    assert(
      (await v1Clips().nth(2).locator('.kf-mark').count()) === 0,
      'テロップの動きが動画クリップに入ってしまった'
    )
    touchedRef.dirty = true
    await resetProject()
  })

  await check('テロップの動きを、別のテロップへコピーできる', async () => {
    // **いちばんよく使う向き。** 1つ作り込んで、残りに配る。
    // 前の項目では「動画→動画」と「テロップ→動画に入らない」しか見ておらず、
    // **本命のテロップ→テロップを見ていなかった**。
    await resetProject()
    await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()

    const telops = page.locator('.telop-clip')
    assert((await telops.count()) >= 2, 'テロップが2つ以上ない（この項目は2つ要ります）')

    // 1つ目に「位置 X」の動きを打つ
    await telops.nth(0).click()
    await page.waitForTimeout(300)
    const row = () => page.locator('.mo-row').filter({ hasText: '位置 X' }).first()
    assert(await row().count(), 'テロップのモーションに「位置 X」が無い')
    const t0 = await telops.nth(0).evaluate((el) => ({
      l: el.getBoundingClientRect().left,
      w: el.getBoundingClientRect().width
    }))
    void t0
    await seekTo(1.2)
    await row().locator('.mo-watch').click()
    await page.waitForTimeout(300)
    await seekTo(2.6)
    await row().locator('.mo-val').fill('1400')
    await row().locator('.mo-val').press('Enter')
    await page.waitForTimeout(400)
    const marks0 = await telops.nth(0).locator('.kf-mark').count()
    assert(marks0 >= 2, `1つ目に印が2つ入らない（${marks0}個）`)

    // 項目名を押して選ぶ → コピー
    await row().locator('.mo-label').click()
    await page.waitForTimeout(200)
    assert(
      (await page.locator('.mo-row.mo-picked').count()) === 1,
      '項目を押しても選ばれた見た目にならない'
    )
    await page.keyboard.press('Control+c')
    await page.waitForTimeout(400)

    // 2つ目へ貼り付け
    await telops.nth(1).click()
    await page.waitForTimeout(300)
    assert(
      (await telops.nth(1).locator('.kf-mark').count()) === 0,
      '貼り付ける前から2つ目に印がある'
    )
    await page.keyboard.press('Control+v')
    await page.waitForTimeout(600)
    // **テロップが増えていないこと。** コピーが空振りしていると、
    // Ctrl+V が「クリップの貼り付け」に流れてテロップが増える（黙って別の事が起きる）
    const n = await telops.count()
    assert(n === 2, `貼り付けでテロップの数が変わった（${n}個）＝クリップの貼り付けに流れている`)
    const marks1 = await telops.nth(1).locator('.kf-mark').count()
    assert(marks1 >= 2, `貼り付けても2つ目に印が入らない（${marks1}個）`)
    touchedRef.dirty = true
    await resetProject()
  })

  await check('見本帳で付けた動きを、組ごと選んで複数のテロップへ配れる', async () => {
    // 実際の使い方はこちら: 見本帳から選んで付ける → 組の見出しでまとめて選ぶ →
    // 配りたいテロップを複数選んで貼る。手で1項目ずつ打つ流れしか見ていなかった。
    await resetProject()
    const telops = page.locator('.telop-clip')
    await telops.nth(0).click()
    await page.waitForTimeout(300)
    // 見本帳（右パネル）から標準の動きを1つ付ける
    await page.locator('.panel-tabs .tab', { hasText: 'トランジション' }).first().click()
    await page.waitForTimeout(300)
    const sec = page.locator('.tpl-acc', { hasText: '💫 動き' }).first()
    if (!(await page.locator('.tpl-acc.open', { hasText: '💫 動き' }).count())) {
      await sec.click()
      await page.waitForTimeout(400)
    }
    const preset = page.locator('.mo-preset').first()
    assert(await preset.count(), '見本帳に標準の動きが並んでいない')
    await preset.click()
    await page.waitForTimeout(600)
    assert(
      (await telops.nth(0).locator('.kf-mark').count()) > 0,
      '見本帳の動きを付けても印が出ない'
    )

    // 組の見出しでまとめて選ぶ → コピー
    await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
    await page.waitForTimeout(300)
    const head = page.locator('.mo-sec', { hasText: '簡単な設定' }).first()
    assert(await head.count(), '「簡単な設定」の見出しが無い')
    await head.click()
    await page.waitForTimeout(200)
    const picked = await page.locator('.mo-row.mo-picked').count()
    assert(picked > 1, `見出しを押しても組がまとめて選ばれない（${picked}行）`)
    await page.keyboard.press('Control+c')
    await page.waitForTimeout(400)

    // 2つ目へ貼る
    await telops.nth(1).click()
    await page.waitForTimeout(300)
    await page.keyboard.press('Control+v')
    await page.waitForTimeout(600)
    assert((await telops.count()) === 2, 'テロップが増えた＝クリップの貼り付けに流れている')
    assert(
      (await telops.nth(1).locator('.kf-mark').count()) > 0,
      '組ごと貼り付けても2つ目に印が入らない'
    )
    await closeTransAccs() // 開けた節は畳んで返す（開閉は保存されるため）
    touchedRef.dirty = true
    await resetProject()
  })

  // 見本帳のチップを掴んで落とす道具は ./lib/dropChip（**中身は動かしていない**）。
  // つなぎ目の演出を測る確認は 17b にもあるので、書き写さず1か所から借りる。
  const dropChipAt = makeDropChip(page)

  await check('カット間トランジションは、帯に描いてある区間で実際に掛かる', async () => {
    // 報告: 「貼ってある所より早く動く」。
    // 実際は**効果が早いのではなく、帯が半分後ろに描かれていた**。
    //   帯:       カットを中心に [cut-d/2, cut+d/2]
    //   プレビュー: カットの手前  [cut-d,   cut)
    //   書き出し:  offset = 累計 - d ＝プレビューと同じ
    // 見た目だけが食い違っていたので、帯を実際の区間へ合わせた。
    //
    // ここでは**帯の位置**と**効果が出ている時刻**の両方を測って、揃っているかを見る。
    await resetProject()
    // まずカットを作る（切片が1つだとカット間トランジションは置けない）
    const n0 = await v1Clips().count()
    if (n0 < 2) {
      await page.keyboard.press('c') // カッター
      await v1Clips().nth(0).click({ position: { x: 60, y: 8 } })
      await page.waitForTimeout(500)
      await page.keyboard.press('v') // 選択に戻す
      await page.waitForTimeout(200)
    }
    assert((await v1Clips().count()) >= 2, 'カットが増えていない')

    await page.locator('.panel-tabs .tab', { hasText: 'トランジション' }).first().click()
    await page.waitForTimeout(300)
    // 見本帳の節は既定で畳んである。動画クリップ用を開く
    if (!(await page.locator('.tpl-acc.open', { hasText: '動画クリップ' }).count())) {
      await page.locator('.tpl-acc', { hasText: '動画クリップ' }).first().click()
      await page.waitForTimeout(400)
    }
    const b0 = await v1Clips().nth(0).boundingBox()
    assert(b0, '1つ目のクリップが見つからない')
    await dropChipAt('ディゾルブ', b0.x + b0.width - 2, b0.y + b0.height / 2)
    const band = page.locator('.ttrans-xfade').first()
    assert(await band.count(), 'カットの境目に落としてもトランジションが付かない')

    // 帯の左右端を秒に直す（トラックの左端＝0秒、幅は zoom 倍）
    const geo = await page.evaluate(() => {
      const el = document.querySelector('.ttrans-xfade')
      const inner = document.querySelector('.track-inner')
      if (!el || !inner) return null
      const a = el.getBoundingClientRect()
      const b = inner.getBoundingClientRect()
      return { left: a.left - b.left, width: a.width }
    })
    assert(geo, '帯の位置を測れない')
    const clipEndPx = await page.evaluate(() => {
      const c = document.querySelectorAll('[data-tid="V1"] .clip:not(.se-ghost)')[0]
      const inner = document.querySelector('.track-inner')
      if (!c || !inner) return null
      return c.getBoundingClientRect().right - inner.getBoundingClientRect().left
    })
    assert(clipEndPx != null, '1つ目のクリップの右端を測れない')
    // **帯の右端＝カット**（手前 d 秒に掛かるので、はみ出さない）
    assert(
      Math.abs(geo.left + geo.width - clipEndPx) < 4,
      `帯の右端がカットに合っていない（帯右端 ${Math.round(geo.left + geo.width)}px / カット ${Math.round(clipEndPx)}px）`
    )

    // **帯の中では本当に混ざっていること。** 位置が合っていても効いていなければ意味が無い。
    // 混ざり具合は2本目の映像の透け具合（opacity）で見る。
    //
    // 時刻は決め打ちにしない。**画素から秒へ直す**（1秒あたりの画素＝帯の幅÷長さ）。
    const dur = Number(/([\d.]+)s/.exec((await band.innerText()) ?? '')?.[1] ?? '0')
    assert(dur > 0.05, `帯から長さを読めない（「${await band.innerText()}」）`)
    const pxPerSec = geo.width / dur
    const cutT = clipEndPx / pxPerSec
    const bOpacity = async (t) => {
      await seekTo(t)
      await page.waitForTimeout(350)
      return page.evaluate(() => {
        const el = document.querySelector('.screen-video-b')
        return el ? Number(getComputedStyle(el).opacity) : null
      })
    }
    const before = await bOpacity(Math.max(0.05, cutT - dur - 0.4)) // 帯より前
    const mid = await bOpacity(cutT - dur / 2) // 帯の真ん中
    assert(before != null && mid != null, '2本目の映像が見つからない')
    assert(before < 0.05, `帯の外なのに混ざっている（透け具合 ${before}）`)
    assert(
      mid > 0.2 && mid < 0.95,
      `帯の真ん中（${(cutT - dur / 2).toFixed(2)}秒）で混ざっていない（透け具合 ${mid}）`
    )
    await closeTransAccs() // 開けた節は畳んで返す（開閉は保存されるため）
    touchedRef.dirty = true
    await resetProject()
  })

  await check('見本帳の動きは、かけたクリップの頭から始まって、終われば元の姿に座る', async () => {
    // 報告: 「かけてある所より早く動いて見える」。
    // 原因は2つ考えられ、**見ただけでは区別が付かない**:
    //   (1) 絵が再生ヘッドから遅れている（文字は再生ヘッドの時刻で動くので先行して見える）
    //   (2) 動きがクリップの頭に入っていない（設計側の話）
    // ここで見るのは (2)。文字の位置を時刻ごとに測って、置き場所そのものを確かめる。
    //
    // 標準の動きはどれも**クリップの先頭から 0.3〜0.9 秒**の「出るときの演出」。
    // なので: 頭の手前では出ていない / 頭の直後はズレている / 演出が終われば定位置。
    await resetProject()
    const telops = page.locator('.telop-clip')
    await telops.nth(0).click()
    await page.waitForTimeout(300)
    await page.locator('.panel-tabs .tab', { hasText: 'トランジション' }).first().click()
    await page.waitForTimeout(300)
    if (!(await page.locator('.tpl-acc.open', { hasText: '💫 動き' }).count())) {
      await page.locator('.tpl-acc', { hasText: '💫 動き' }).first().click()
      await page.waitForTimeout(400)
    }
    const slide = page.locator('.mo-preset', { hasText: 'すべり込む（右から）' }).first()
    assert(await slide.count(), '見本帳に「すべり込む（右から）」が無い')
    await slide.click()
    await page.waitForTimeout(500)

    /** プレビューに出ている文字の左端（出ていなければ null） */
    const xAt = async (t) => {
      await seekTo(t)
      await page.waitForTimeout(350)
      const el = page.locator('.telop-overlay .telop-textmain').first()
      if (!(await el.count())) return null
      return (await el.boundingBox())?.x ?? null
    }

    // テロップは 1〜3秒。動きは頭から 0.3 秒
    const before = await xAt(0.7) // 頭より前
    const head = await xAt(1.05) // 頭の直後＝右にズレているはず
    const done = await xAt(1.5) // 演出のあと＝定位置
    const later = await xAt(2.4) // そのまま座っているはず

    assert(before === null, `クリップの頭より前なのに文字が出ている（x=${before}）`)
    assert(head != null && done != null && later != null, '文字がプレビューに出ていない')
    assert(
      head > done + 20,
      `頭の直後に右へズレていない（頭 ${Math.round(head)} / 演出後 ${Math.round(done)}）` +
        '＝動きがクリップの頭に入っていない'
    )
    assert(
      Math.abs(done - later) < 3,
      `演出が終わっても座らない（${Math.round(done)} → ${Math.round(later)}）`
    )
    await closeTransAccs() // 開けた節は畳んで返す（開閉は保存されるため）
    touchedRef.dirty = true
    await resetProject()
  })

  await check('動きをコピーしたあとでも、クリップのコピー＆貼り付けは普通に効く', async () => {
    // **一度モーションを写すと、以降の Ctrl+V がずっとモーション側に取られる**
    // という壊れ方をしていた。貼り付けは「最後に写した物」に従うのが正しい。
    await resetProject()
    await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
    const telops = page.locator('.telop-clip')
    await telops.nth(0).click()
    await page.waitForTimeout(300)
    const row = page.locator('.mo-row').filter({ hasText: '位置 X' }).first()
    await seekTo(1.2)
    await row.locator('.mo-watch').click()
    await page.waitForTimeout(300)
    await row.locator('.mo-label').click()
    await page.waitForTimeout(200)
    await page.keyboard.press('Control+c') // ← 動きを写す
    await page.waitForTimeout(400)

    // **帯は見えている範囲にしか作らない**（TelopBands の inView）。
    // 数えるときは必ず左端へ戻す——戻さないと「貼ったのに増えない」と
    // 「送った先に居るだけ」の区別が付かない（2026-08-04 に実際に混同した）。
    const toLeft = async () => {
      await page.evaluate(() => {
        const el = document.querySelector('.track-scroll')
        if (el) el.scrollLeft = 0
      })
      await page.waitForTimeout(200)
    }
    // そのあとテロップ本体を写して貼る＝1つ増えるはず
    await toLeft()
    const before = await telops.count()
    await telops.nth(0).click()
    await page.waitForTimeout(300)
    // **成立の assert。** モーションの枠の外を触ったら項目の選択は解ける決まり
    //（MotionTab の pointerdown）。ここが解けていないと、次の Ctrl+C は
    // クリップではなく**また動きを写す**ので、この確認は「貼り付けの不具合」に
    // 見えて実は別の話になる。どちらなのかをここで分ける。
    const stillSel = await page.locator('.mo-row.mo-picked').count()
    assert(
      stillSel === 0,
      `枠の外を触っても項目の選択が解けていない（${stillSel}行）＝この後の Ctrl+C は動き側に取られる`
    )
    // **成立の assert その2。** 写す物が選ばれていなければ `copySelected` は
    // 何も控えずに帰る（しかも `lastCopyRef` は 'clip' に書き換わる）ので、
    // 貼り付けは空振りする。「貼り付けが壊れている」と見分けが付かない。
    const selCount = await page.locator('.telop-clip.clip-selected').count()
    assert(selCount === 1, `写す前にテロップが選ばれていない（${selCount}個）`)
    await page.keyboard.press('Control+c') // ← クリップを写す
    await page.waitForTimeout(300)
    // **貼る場所は「空いている所」でなければならない。**
    //
    // 下書きのテロップは 1.0-3.0 と 6.0-8.0。写したのは 1.0-3.0（長さ2秒）なので、
    // 6秒で貼ると **6.0-8.0 にぴったり重なって、負けた側が丸ごと消える**
    //（`shared/overwrite` の決まりどおり）＝**数が増えない**。
    // それを「貼り付けが効いていない」と読んで丸一日追った（2026-08-04）。
    //
    // 上書きが入る前は数が増えていたので、この確認は
    // **「貼り付けは上書きしない」に黙って寄りかかっていた**。3.5秒なら
    // 3.5-5.5 で、どちらとも重ならない。
    await seekTo(3.5)
    await page.keyboard.press('Control+v')
    await page.waitForTimeout(600)
    await toLeft()
    const after = await telops.count()
    // **増えていればよい**（＝クリップの貼り付けが走った）。
    // 何個になるかは貼る場所しだいで変わる（上書きで負けた側が割れれば2個増える）。
    // ここが見たいのは「動き側に取られていないか」なので、増減だけを見る。
    assert(
      after > before,
      `クリップの貼り付けが効いていない（${before}個 → ${after}個）＝動きの貼り付けに取られたまま`
    )
    touchedRef.dirty = true
    await resetProject()
  })
}
