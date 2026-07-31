// キーフレームで動かす（見本帳・コピー・書き出し）
//
// 章: モーション（キーフレームで動かす）
//
// **通しの本体は e2e/run.mjs から分けてある。** 1ファイル7,400行だと、
// 直したい章を探すのに毎回全部を読むことになり、足す場所も決まらないので
// 「仕上げ」に流れ込んでいた。道具（check・assert・素材づくり）は
// run.mjs 側に置いたままで、まとめて受け取る。

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export default async function (C) {
  const {
    RATIO,
    assert,
    avgColor,
    check,
    closeTransAccs,
    exactFrame,
    fx,
    grabFrame,
    outDir,
    page,
    resetProject,
    section,
    seekTo,
    setDialogFiles,
    similarity,
    skipHere,
    touchedRef,
    v1Clips,
  } = C
  section('モーション（キーフレームで動かす）')
  await resetProject()

  await check('テロップに動きを付けると、プレビューで本当に動く', async () => {
    // 「0秒でここ、あとでそこ」と置いたら、その間を流れる。
    // プレミアと同じ操作: ⏱ を押す → 再生ヘッドを動かす → 値を変える
    await page.locator('.telop-clip').first().click()
    await page.waitForTimeout(300)
    await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
    await page.waitForTimeout(300)
    const row = page.locator('.mo-row').filter({ hasText: '位置 X' }).first()
    assert(await row.count(), 'モーションタブに「位置 X」が無い')

    // テロップは 1〜3秒。頭で ⏱ を押し、いまの位置に印が置かれる
    await seekTo(1.2)
    await page.waitForTimeout(300)
    await row.locator('.mo-watch').click()
    await page.waitForTimeout(300)
    assert(
      (await row.locator('.mo-watch.on').count()) === 1,
      '⏱ を押しても動きが付いた状態にならない'
    )
    const xAt = async () =>
      (await page.locator('.telop-overlay .telop-textmain').first().boundingBox())?.x ?? null
    const x0 = await xAt()
    assert(x0 != null, '文字がプレビューに出ていない')

    // 後ろの時刻で値を変える → そこに印が置かれ、間が流れる
    await seekTo(2.6)
    await page.waitForTimeout(300)
    const val = row.locator('.mo-val')
    await val.fill('300')
    await val.press('Enter')
    await page.waitForTimeout(500)
    const x1 = await xAt()
    // 300px は元の位置（画面の真ん中＝960）より左なので、左へ動くのが正しい
    assert(x1 != null && x1 < x0 - 20, `後ろの時刻で左へ動いていない（${x0} → ${x1}）`)

    // 途中は「その間」にいる（＝なめらかにつながっている）
    await seekTo(1.9)
    await page.waitForTimeout(400)
    const xMid = await xAt()
    assert(
      xMid != null && xMid < x0 - 5 && xMid > x1 + 5,
      `間が流れていない（${x0} / ${xMid} / ${x1}）`
    )
    touchedRef.dirty = true
  })

  await check('「詳細設定」に、取り込んだ演出で使う項目が並んでいて打てる', async () => {
    // 位置・拡大・回転・不透明度だけでは、写し取った演出の半分も作れない
    // （横だけの拡大・3D回転・明るさ・切り抜き…）。
    // **畳まずに出しておく**（畳んだままだと、そこに何があるか忘れる）。
    // 見出しを押すのは「畳む」ではなく「その組をまとめて選ぶ」＝コピーの相手決め。
    const sec = page.locator('.mo-sec', { hasText: '詳細設定' }).first()
    assert(await sec.count(), 'モーションタブに「詳細設定」が無い')
    const row = page.locator('.mo-row').filter({ hasText: '横だけ拡大' }).first()
    assert(await row.count(), '「横だけ拡大」が出ていない')

    const wAt = async () =>
      (await page.locator('.telop-overlay .telop-textmain').first().boundingBox())?.width ?? null
    const w0 = await wAt()
    assert(w0 != null && w0 > 0, '文字がプレビューに出ていない')

    await row.locator('.mo-watch').click()
    await page.waitForTimeout(300)
    const val = row.locator('.mo-val')
    await val.fill('200')
    await val.press('Enter')
    await page.waitForTimeout(500)
    const w1 = await wAt()
    // 横だけ2倍。**プレビューに本当に効いているか**を幅で見る（値が入っただけでは意味が無い）
    assert(w1 != null && w1 > w0 * 1.6, `横に伸びていない（${w0} → ${w1}）`)

    // 片付ける。ここで残すと、このあとの書き出し確認まで横に伸びたままになる
    await row.locator('.mo-watch').click()
    await page.waitForTimeout(300)
    await sec.click()
    await page.waitForTimeout(200)
    const w2 = await wAt()
    assert(w2 != null && Math.abs(w2 - w0) < 4, `⏱ を消しても元に戻らない（${w0} → ${w2}）`)
  })

  await check('付けた動きは、保存して開き直しても残っている', async () => {
    // 保存の拾い忘れで動きだけ静かに消える、という事故を防ぐ
    await page.keyboard.press('Control+s')
    await page.waitForTimeout(1600)
    const data = JSON.parse(readFileSync(fx.gcproj, 'utf-8'))
    const withMotion = (data.cues ?? []).filter((c) => c.motion)
    assert(withMotion.length > 0, '保存した中身に動きが入っていない')
    assert(
      Array.isArray(withMotion[0].motion.tx) && withMotion[0].motion.tx.length >= 2,
      `印が2つ以上入っていない: ${JSON.stringify(withMotion[0].motion)}`
    )
  })

  await check('書き出した動画でも、テロップが同じように動く', async () => {
    // **ここが本番。** プレビューで動いても書き出しで動かなければ意味が無い
    // （ダッキングで「聴いた音と書き出した音が違う」を潰したのと同じ理由）。
    //
    // ※ 動きは自分で付ける。前の項目に寄りかかると、絞って回したときに
    //    「動きが無い状態で書き出して、動いていない」と赤くなる＝本物と紛れる。
    if (!(await page.locator('.telop-clip .kf-mark').count())) {
      await page.locator('.telop-clip').first().click()
      await page.waitForTimeout(300)
      await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
      await page.waitForTimeout(300)
      const trow = page.locator('.mo-row').filter({ hasText: '位置 X' }).first()
      assert(await trow.count(), 'テロップのモーションに「位置 X」が無い')
      await seekTo(1.2)
      if (!(await trow.locator('.mo-watch.on').count())) await trow.locator('.mo-watch').click()
      await page.waitForTimeout(300)
      await seekTo(2.6)
      await trow.locator('.mo-val').fill('1400')
      await trow.locator('.mo-val').press('Enter')
      await page.waitForTimeout(400)
      // 数値欄にカーソルが残っていると Ctrl+M が欄に吸われる（書き出しが始まらない）
      await page.locator('.mo-head').first().click()
      await page.waitForTimeout(200)
      touchedRef.dirty = true
    }
    const out = join(outDir, 'motion.mp4')
    await setDialogFiles(null, out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
    await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
    await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 240000 })
    assert(existsSync(out), '書き出しファイルができていない')
    // 動いている区間の前と後ろを1枚ずつ抜き、**違う絵になっている**ことを見る
    const a = join(outDir, 'motion-a.png')
    const b = join(outDir, 'motion-b.png')
    await grabFrame(out, 1.3, a)
    await grabFrame(out, 2.5, b)
    const same = await similarity(a, b)
    assert(same < 0.999, `書き出した動画でテロップが動いていない（一致度 ${same}）`)
  })

  await check('動画クリップにも動きを付けられる（時間で寄っていく）', async () => {
    // テロップと同じ操作で、動画そのものを動かせる（切り抜きの「話者にシュッと寄る」）。
    // **プレビューの transform を直に読む**。見た目の変化を絵で測ると、
    // 元動画の中身が動いただけでも通ってしまう。
    await resetProject()
    await v1Clips().nth(0).click() // 1つ目の切片（0〜5秒）
    await page.waitForTimeout(300)
    await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
    await page.waitForTimeout(300)
    const row = page.locator('.mo-row').filter({ hasText: '拡大' }).first()
    assert(await row.count(), 'モーションタブに「拡大」が無い（クリップ用の行が出ていない）')

    /** プレビューの動画に掛かっている拡大率（transform から読む） */
    const scaleNow = async () => {
      const tr = await page.evaluate(
        () => document.querySelector('.screen-video')?.style.transform ?? ''
      )
      const m = /scale\(([\d.]+)\)/.exec(tr)
      return m ? Number(m[1]) : 1
    }

    await seekTo(0.4)
    await row.locator('.mo-watch').click() // ⏱ ＝ いまの位置に印
    await page.waitForTimeout(300)
    assert(
      (await row.locator('.mo-watch.on').count()) === 1,
      '⏱ を押しても動きが付いた状態にならない'
    )
    const s0 = await scaleNow()
    assert(Math.abs(s0 - 1) < 0.02, `印を置いただけで拡大が変わっている（${s0}）`)

    // 後ろの時刻で 200% にする → そこに印が置かれ、間が寄っていく
    await seekTo(3)
    const val = row.locator('.mo-val')
    await val.fill('200')
    await val.press('Enter')
    await page.waitForTimeout(400)
    const s1 = await scaleNow()
    assert(Math.abs(s1 - 2) < 0.05, `後ろの時刻で2倍になっていない（${s1}）`)

    // 途中は「その間」にいる（＝なめらかにつながっている）
    await seekTo(1.7)
    await page.waitForTimeout(300)
    const sMid = await scaleNow()
    assert(sMid > s0 + 0.1 && sMid < s1 - 0.1, `間が寄っていない（${s0} / ${sMid} / ${s1}）`)

    // タイムラインの帯にも印が出ている（後から「どこに打ったか」を探せる）
    const marks = await v1Clips().nth(0).locator('.kf-mark').count()
    assert(marks === 2, `帯に出ている印が2つではない（${marks}個）`)
    touchedRef.dirty = true
  })

  await check('拡大の動きは1倍未満にできない（書き出せない値を画面から打たせない）', async () => {
    // zoompan は寄る方しか焼けない。**画面だけ引けてしまうと、書き出しでだけ絵が違う**
    // という一番たちの悪いズレになるので、入力の側で止める。
    //
    // ※ 前の項目の状態に寄りかからない。順番が変わるたびに落ちるようだと、
    //    落ちても「本物か並びのせいか」を毎回調べ直すことになる。
    //    **テロップが選ばれたままだと、モーションはテロップの物が出る**ので、
    //    まっさらにしてから動画の切片だけを選ぶ。
    await resetProject()
    await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
    await v1Clips().nth(0).click()
    await page.waitForTimeout(300)
    const row = page.locator('.mo-row').filter({ hasText: '拡大' }).first()
    assert(await row.count(), 'モーションに動画の「拡大」が出ていない')
    await seekTo(0.4)
    if (!(await row.locator('.mo-watch.on').count())) await row.locator('.mo-watch').click()
    await page.waitForTimeout(300)
    const val = row.locator('.mo-val')
    assert(
      (await val.getAttribute('min')) === '100',
      '動きが付いているのに、拡大の下限が100%になっていない'
    )
    await seekTo(2)
    await val.fill('50')
    await val.press('Enter')
    await page.waitForTimeout(400)
    const tr = await page.evaluate(
      () => document.querySelector('.screen-video')?.style.transform ?? ''
    )
    const s = Number(/scale\(([\d.]+)\)/.exec(tr)?.[1] ?? 1)
    assert(s >= 1, `1倍未満になってしまった（${s}）`)
    touchedRef.dirty = true
  })

  await check('プレビューのリセットは、選んでいる分すべてに効く（動きも消える）', async () => {
    // **付ける時は選択中の全部に効くのに、戻す時だけ1つでは対で使えない。**
    // さらに、拡大だけ等倍にしても印が残っていれば再生した瞬間にまた動きだす
    // ＝「戻っていない」ように見えるので、印も一緒に消えることまで見る。
    await resetProject()
    await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
    const row = () => page.locator('.mo-row').filter({ hasText: '拡大' }).first()

    // 1つ目には印を打つ（時間で動く方）
    await v1Clips().nth(0).click()
    await page.waitForTimeout(300)
    await seekTo(0.4)
    await row().locator('.mo-watch').click()
    await seekTo(3)
    await row().locator('.mo-val').fill('200')
    await row().locator('.mo-val').press('Enter')
    await page.waitForTimeout(400)
    assert((await v1Clips().nth(0).locator('.kf-mark').count()) > 0, '1つ目に印が付かない')

    // 2つ目は固定の拡大だけ（印なし）。**種類の違う2つが同時に戻ることを見る**
    await v1Clips().nth(1).click()
    await page.waitForTimeout(300)
    await row().locator('.mo-val').fill('150')
    await row().locator('.mo-val').press('Enter')
    await page.waitForTimeout(400)

    // 2つまとめて選ぶ
    await v1Clips().nth(0).click()
    await v1Clips().nth(1).click({ modifiers: ['Control'] })
    await page.waitForTimeout(400)
    const btn = page.locator('.reframe-btn').filter({ hasText: 'リセット' }).first()
    assert(await btn.count(), 'プレビューにリセットのボタンが出ていない')
    const label = await btn.innerText()
    assert(/2個/.test(label), `何個に効くかがボタンに出ていない（「${label}」）`)
    await btn.click()
    await page.waitForTimeout(500)

    assert(
      (await v1Clips().nth(0).locator('.kf-mark').count()) === 0,
      '1つ目の印が消えていない（動きが残ったまま）'
    )
    // 2つとも等倍に戻っている（固定値の方も）
    for (const i of [0, 1]) {
      await v1Clips().nth(i).click()
      await page.waitForTimeout(300)
      const v = await row().locator('.mo-val').inputValue()
      assert(Number(v) === 100, `${i + 1}つ目が等倍に戻っていない（${v}%）`)
    }
    touchedRef.dirty = true
    await resetProject()
  })

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

  /**
   * 見本帳のチップを、タイムラインの座標へ「掴んで落とす」。
   *
   * **トランジションは掴んで置く物なので、これが無いと一切自動化できない**
   * （クリックでは付かない）。マウス操作では HTML5 の掴み落としは起きないので、
   * その場で drag の一連を起こしてやる。
   */
  const dropChipAt = async (chipText, x, y) => {
    await page.evaluate(
      ({ chipText, x, y }) => {
        const chip = [...document.querySelectorAll('.fx-item')].find((el) =>
          (el.textContent ?? '').includes(chipText)
        )
        if (!chip) throw new Error(`見本帳に「${chipText}」が無い`)
        const dt = new DataTransfer()
        const ev = (t, el, more = {}) =>
          el.dispatchEvent(
            new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt, ...more })
          )
        ev('dragstart', chip)
        const target = document.elementFromPoint(x, y)
        if (!target) throw new Error('落とす先が見つからない')
        const at = { clientX: x, clientY: y }
        ev('dragenter', target, at)
        ev('dragover', target, at)
        ev('drop', target, at)
        ev('dragend', chip)
      },
      { chipText, x, y }
    )
    await page.waitForTimeout(500)
  }

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

    // そのあとテロップ本体を写して貼る＝1つ増えるはず
    const before = await telops.count()
    await telops.nth(0).click()
    await page.waitForTimeout(300)
    await page.keyboard.press('Control+c') // ← クリップを写す
    await page.waitForTimeout(300)
    await seekTo(6)
    await page.keyboard.press('Control+v')
    await page.waitForTimeout(600)
    const after = await telops.count()
    assert(
      after === before + 1,
      `クリップの貼り付けが効いていない（${before}個 → ${after}個）＝動きの貼り付けに取られたまま`
    )
    touchedRef.dirty = true
    await resetProject()
  })

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
  })

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
    await setDialogFiles(null, out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
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
  })

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
    await setDialogFiles(null, out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
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
    await setDialogFiles(null, out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
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
  })

  await check('Premiere のプリセットを取り込むと、見本帳に並んで実際に動く', async () => {
    // **本物の .prfpset はリポジトリに置かない**（再配布が許可されていない）。
    // 形は実物を読んで確かめてあるので、同じ形の小さな物をここで作って読ませる。
    //
    // 見るのは端から端まで: 選ぶ → 本体が読む → 保存される → 一覧に出る →
    // 押すとテロップが本当に動く。途中のどこが切れても気づけるようにする。
    const TICK = 254016000000 // 1秒ぶんの刻み
    const t0 = 3600 * TICK // Premiere は1時間から始まる
    const at = (sec) => Math.round(t0 + sec * TICK)
    // 位置は割合（0.5が中央）。0.6 → 0.5 ＝ 右から中央へ（フレーム幅の1割ぶん）
    const kfs = `${at(0)},0.6:0.5,5,0,0,0.3333,0,0.3333;${at(0.4)},0.5:0.5,5,0,0,0.3333,0,0.3333;`
    const one = (id, name, extra = '') => `
  <TreeItem ObjectID="${id}" ClassID="x" Version="4">
    <TreeItemBase Version="4"><Data ObjectRef="${id + 1}"/><Name>${name}</Name></TreeItemBase>
  </TreeItem>
  <FilterPresetItem ObjectID="${id + 1}" ClassID="x" Version="1">
    <FilterPresets Version="1"><FilterPreset Index="0" ObjectRef="${id + 2}"/>${
      extra ? `<FilterPreset Index="1" ObjectRef="${id + 5}"/>` : ''
    }</FilterPresets>
  </FilterPresetItem>
  <FilterPreset ObjectID="${id + 2}" ClassID="x" Version="1"><Component ObjectRef="${id + 3}"/></FilterPreset>
  <VideoFilterComponent ObjectID="${id + 3}" ClassID="x" Version="1">
    <MatchName>AE.ADBE Motion</MatchName>
    <Params Version="1"><Param Index="0" ObjectRef="${id + 4}"/></Params>
  </VideoFilterComponent>
  <PointComponentParam ObjectID="${id + 4}" ClassID="x" Version="3">
    <CurrentValue>0.5:0.5</CurrentValue><IsTimeVarying>true</IsTimeVarying>
    <Keyframes>${kfs}</Keyframes><Name>位置</Name>
  </PointComponentParam>${extra}`
    // 2つめは、こちらに無いエフェクト（波形ワープ）が混ざった物。
    // 「一部だけ再現できる」と分かる印が付くかを見る
    const wave = (id) => `
  <FilterPreset ObjectID="${id + 5}" ClassID="x" Version="1"><Component ObjectRef="${id + 6}"/></FilterPreset>
  <VideoFilterComponent ObjectID="${id + 6}" ClassID="x" Version="1">
    <MatchName>AE.ADBE Wave Warp</MatchName>
    <Params Version="1"><Param Index="0" ObjectRef="${id + 7}"/></Params>
  </VideoFilterComponent>
  <ComponentParam ObjectID="${id + 7}" ClassID="x" Version="3">
    <CurrentValue>10</CurrentValue><IsTimeVarying>true</IsTimeVarying>
    <Keyframes>${at(0)},10,5,0,0,0.3333,0,0.3333;${at(0.4)},0,5,0,0,0.3333,0,0.3333;</Keyframes>
    <Name>波の高さ</Name>
  </ComponentParam>`
    // 3つめは**動きが1つも取れない**物（こちらに無いエフェクトだけでできている）。
    // これも落とさず並ぶこと・押したら理由を言うことを見る
    const onlyWave = (id, name) => `
  <TreeItem ObjectID="${id}" ClassID="x" Version="4">
    <TreeItemBase Version="4"><Data ObjectRef="${id + 1}"/><Name>${name}</Name></TreeItemBase>
  </TreeItem>
  <FilterPresetItem ObjectID="${id + 1}" ClassID="x" Version="1">
    <FilterPresets Version="1"><FilterPreset Index="0" ObjectRef="${id + 5}"/></FilterPresets>
  </FilterPresetItem>${wave(id)}`
    const prfpset = join(outDir, 'e2e-test.prfpset')
    writeFileSync(
      prfpset,
      `<?xml version="1.0"?>\n<PremiereData Version="3">${one(100, 'E2E_右から')}${one(
        200,
        'E2E_一部だけ',
        wave(200)
      )}${onlyWave(300, 'E2E_動きなし')}\n</PremiereData>`,
      'utf-8'
    )

    await page.locator('.telop-clip').first().click()
    await page.waitForTimeout(300)
    // 見本帳は**右パネルのトランジションタブ**（05.飛び出し のような演出名なので、
    // 他の見本帳と並べてある）。左のモーションタブは、付けたあと数値を詰める所。
    await page.locator('.panel-tabs .tab', { hasText: 'トランジション' }).first().click()
    await page.waitForTimeout(300)
    const sec = page.locator('.tpl-acc', { hasText: '💫 動き' }).first()
    assert(await sec.count(), 'トランジションタブに「動き」が無い')
    assert(
      (await page.locator('.tpl-acc.open').count()) === 0,
      'トランジションタブの節が最初から開いている（既定は全部畳んでおく）'
    )
    await sec.click()
    await page.waitForTimeout(300)

    // **入口はファイルメニューだけ**（取り込みは一度きりなので、
    // 見本帳の中に常駐させると細いパネルで一覧の場所を食うだけになる）
    await setDialogFiles([prfpset], null)
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.waitForTimeout(300)
    await page.locator('.menu-drop-item', { hasText: 'Premiere の動きを取り込む' }).first().click()
    await page.waitForTimeout(1500)
    // **取り込んだ物だけを数える。** 標準の動きが20個並んでいるので、
    // 全部を数えると「取り込みが効いたか」が分からなくなる
    const list = page.locator('.mo-preset-imported')
    // 既定は**ちゃんと出る物だけ**。選ぶたびに当たり外れを引かせない
    assert(
      (await list.count()) === 1,
      `既定で出るのは「ちゃんと出る物」だけのはず（${await list.count()}件出ている）`
    )

    // **隠した物も辿れること。** 1つも落としてはいない（何が入っていたかは見たい）
    const showAll = page.locator('.mo-showall input')
    assert(await showAll.count(), '「まだ出ない物も」の切り替えが無い（隠した物へ辿れない）')
    await showAll.check()
    await page.waitForTimeout(400)
    assert((await list.count()) === 3, `全部出しても3件並ばない（${await list.count()}件）`)
    assert(
      (await page.locator('.mo-preset-part').count()) === 1,
      '「一部だけ再現できる（△）」印の付き方がおかしい'
    )
    assert(
      (await page.locator('.mo-preset-none').count()) === 1,
      '「動きなし（✕）」印の付き方がおかしい'
    )
    // 動きなしを押しても付かず、何が要るかを言う（黙って何も起きないのは罠）
    await page.locator('.mo-preset', { hasText: 'E2E_動きなし' }).first().click()
    await page.waitForTimeout(500)
    const why = (await page.locator('.toast').allTextContents()).join(' ')
    assert(
      why.includes('まだ付けられません') && why.includes('Wave Warp'),
      `動きなしを押しても理由が出ない: ${why}`
    )

    // 押したら本当に動くか。テロップは 1〜3秒
    const xAt = async () =>
      (await page.locator('.telop-overlay .telop-textmain').first().boundingBox())?.x ?? null
    await page.locator('.mo-preset', { hasText: 'E2E_右から' }).first().click()
    await page.waitForTimeout(600)
    // ちょうど頭（1.0秒）だとテロップが出ているか出ていないかの境目なので、少し中へ入る
    await seekTo(1.1)
    await page.waitForTimeout(400)
    const xStart = await xAt()
    await seekTo(1.6) // 動きは0.4秒で終わる＝ここでは元の位置に戻っている
    await page.waitForTimeout(400)
    const xEnd = await xAt()
    assert(xStart != null && xEnd != null, '文字がプレビューに出ていない')
    // 頭では右に居て、終わりでは元の位置に戻ってくる
    assert(xStart > xEnd + 10, `右から入ってこない（${xStart} → ${xEnd}）`)

    // 開き直しても残っているか（保存されるのは userData 側なので、
    // アプリを再起動しても一覧に出る＝毎回取り込み直さなくていい）
    const saved = join(fx.userData, 'motion-presets', 'e2e-test.json')
    assert(existsSync(saved), `取り込んだ物が保存されていない（${saved}）`)
    const items = JSON.parse(readFileSync(saved, 'utf-8'))
    assert(items.length === 3, `保存された件数がおかしい（${items.length}件。落とさず全部残すはず）`)
    assert(items[0].motion?.tx?.length === 2, '保存された中身に動きが入っていない')
    // 動きなしの物も、**何が足りないかを添えて**残っている（押したとき理由を言うため）
    const none = items.find((t) => t.name === 'E2E_動きなし')
    assert(
      // 足りない物の名前は「エフェクト名/項目名」まで入る（どの項目が無いかまで言うため）
      none &&
        Object.keys(none.motion).length === 0 &&
        none.partial?.some((s) => String(s).includes('AE.ADBE Wave Warp')),
      `動きなしの物が残っていない/理由が付いていない: ${JSON.stringify(none)}`
    )

    touchedRef.dirty = true
    await resetProject()
  })

  await check('見本帳の動きは動画・画像には付かない（当てても死ぬだけなので断る）', async () => {
    // 見本帳は右パネルにあるので、**何を選んでいても目には入る**。
    // 写し取った演出はテロップ用（横だけ拡大・3D回転・切り抜き…）で、映像側は
    // ffmpeg で焼くため拡大と位置しか手が無い。当てても効かないか、拡大が1倍未満に
    // なって書き出しが通らなくなる。**押しても付かず、そう言う**ことを見る。
    await page.locator('.panel-tabs .tab', { hasText: 'トランジション' }).first().click()
    await page.waitForTimeout(300)
    const sec = page.locator('.tpl-acc', { hasText: '💫 動き' }).first()
    if (!(await page.locator('.tpl-acc.open', { hasText: '💫 動き' }).count()))
      await sec.click()
    await page.waitForTimeout(300)

    for (const [what, sel] of [
      ['動画', '[data-tid="V1"] .video-clip'],
      ['画像', '.img-clip']
    ]) {
      await page.locator(sel).first().click()
      await page.waitForTimeout(400)
      await page.locator('.mo-preset', { hasText: 'E2E_右から' }).first().click()
      await page.waitForTimeout(500)
      const toast = (await page.locator('.toast').allTextContents()).join(' ')
      assert(
        toast.includes('先にテロップを選択'),
        `${what}を選んで押したのに断られない（テロップ用の動きが映像に付いてしまう）: ${toast}`
      )
    }
    // 何も付いていないので、状態は戻さない（戻す＝保存し直す方が、
    // 触っていない物まで書き換えて後ろの確認を狂わせる）
  })

  // =========================================================================
}
