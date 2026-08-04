// キーフレームを打つ（テロップと動画クリップに動きを付ける）
//
// 章: モーション（キーフレームで動かす）
//
// **通しの本体は e2e/run.mjs から分けてある。** 1ファイル7,400行だと、
// 直したい章を探すのに毎回全部を読むことになり、足す場所も決まらないので
// 「仕上げ」に流れ込んでいた。道具（check・assert・素材づくり）は
// run.mjs 側に置いたままで、まとめて受け取る。
//
// ## この章は3ファイルに分かれている（2026-08-04・1,131行 → 415行）
//
// ここに残したのは**打つところ**の8項目（テロップに付ける／詳細設定／印を消す／
// 保存に残る／書き出しに乗る／動画クリップに付ける／下限／まとめてリセット）。続きは:
//
//   e2e/checks/09c-写して配る.mjs       写して配る（項目コピー・見本帳・貼り付けの取り合い）6項目
//   e2e/checks/09d-保存と書き出し.mjs   保存と書き出しに本当に乗るか＋手で動かす      6項目
//   e2e/checks/09b-Premiere取り込み.mjs Premiere のプリセット取り込み                 2項目
//
// **09c と 09d は run.mjs の章一覧へ足していない。** 途中の塊なので、一覧へ足すと
// 後から「番号順に並べ直そう」とされたときに実行順が黙って入れ替わる
// （この章には順番に寄りかかっている項目が5つある）。下の方で、元あった位置から呼ぶ。
//
// 切る場所は**両側が `resetProject()` で閉じている所**を選んだ。境目に
// 新しい寄りかかりが生まれないので、印を足さずに切れる。

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import copyAndShareChecks from './09c-写して配る.mjs'
import saveAndExportChecks from './09d-保存と書き出し.mjs'

export default async function (C) {
  const {
    assert,
    check,
    fillExportName,
    setExportTarget,
    fx,
    grabFrame,
    outDir,
    page,
    resetProject,
    section,
    seekTo,
    similarity,
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
  },
  // **手前の項目が開いたモーションタブに寄りかかっている**（自分では選び直さない）。
  // 絞って回すとタブが開いておらず「詳細設定が無い」で必ず赤くなる。
  { orderDependent: true })

  await check('タイムラインの印を右クリックすると、その印だけ消える', async () => {
    // **消す手段が無かった。** 打つのは ⏱ と打ち込みでできるのに、消すのは
    // 「その項目ごと捨てる」しか無く、1つ打ち間違えると全部やり直しだった。
    if (!(await page.locator('.telop-clip .kf-mark').count())) {
      await page.locator('.telop-clip').first().click()
      await page.waitForTimeout(300)
      await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
      await page.waitForTimeout(300)
      const trow = page.locator('.mo-row').filter({ hasText: '位置 X' }).first()
      assert(await trow.count(), 'テロップのモーションに「位置 X」が無い')
      await seekTo(1.2)
      await page.waitForTimeout(300)
      if (!(await trow.locator('.mo-watch.on').count())) await trow.locator('.mo-watch').click()
      await page.waitForTimeout(300)
      await seekTo(2.6)
      await page.waitForTimeout(300)
      await trow.locator('.mo-val').fill('300')
      await trow.locator('.mo-val').press('Enter')
      await page.waitForTimeout(500)
      await trow.locator('.mo-val').evaluate((el) => el.blur())
      await page.waitForTimeout(200)
      touchedRef.dirty = true
    }
    const marks = page.locator('.telop-clip .kf-mark')
    const before = await marks.count()
    assert(before >= 2, `印が2つ以上ないと消す確認にならない（${before}個）`)
    await marks.first().click({ button: 'right' })
    await page.waitForTimeout(400)
    const after = await marks.count()
    assert(after === before - 1, `印が1つだけ減っていない（${before} → ${after}）`)
    // **全部消えていないこと**まで見る（「その項目ごと捨てる」と区別が付かないため）
    assert(after > 0, '押した印だけでなく、全部消えている')
    // **消したぶんを戻す。** ここは章の途中で、後ろの項目はこの印が
    // 2つ揃っている前提で動く（消したままだと次が「印が1つしかない」で落ちる）
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
    assert(
      (await marks.count()) === before,
      `戻していない（${before} → ${await marks.count()}）。後ろの項目が巻き添えになる`
    )
  })

  await check('付けた動きは、保存して開き直しても残っている', async () => {
    // 保存の拾い忘れで動きだけ静かに消える、という事故を防ぐ
    //
    // ※ 動きは自分で付ける。前の項目に寄りかかっていたので、絞って回すと
    //    「動きが無い状態で保存して、保存に動きが入っていない」と赤くなり、
    //    **本物の保存漏れと見分けが付かなかった**（実際に一度、
    //    `やること.md` へ「保存する側で拾えていない」と誤って控えられた）。
    //    すぐ下の「書き出した動画でも…」は同じ理由で既に自分で付けている。
    if (!(await page.locator('.telop-clip .kf-mark').count())) {
      await page.locator('.telop-clip').first().click()
      await page.waitForTimeout(300)
      await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
      await page.waitForTimeout(300)
      const trow = page.locator('.mo-row').filter({ hasText: '位置 X' }).first()
      assert(await trow.count(), 'テロップのモーションに「位置 X」が無い')
      await seekTo(1.2)
      await page.waitForTimeout(300)
      if (!(await trow.locator('.mo-watch.on').count())) await trow.locator('.mo-watch').click()
      await page.waitForTimeout(300)
      assert(
        (await trow.locator('.mo-watch.on').count()) === 1,
        '⏱ を押しても動きが付いた状態にならない'
      )
      await seekTo(2.6)
      await page.waitForTimeout(300)
      await trow.locator('.mo-val').fill('300')
      await trow.locator('.mo-val').press('Enter')
      await page.waitForTimeout(500)
      // 数値欄にカーソルが残っていると Ctrl+S が欄に吸われる（保存が始まらない）。
      // **手を離すのに「どこかを押す」をしない。** `.mo-head` を押すと、そこは
      // 「動きを消す」ボタンを抱えた入れ物なので真ん中がボタンに当たり、
      // **いま打った印が全部消える**（打った→消した→保存 で「保存に動きが
      // 入っていない」と出て、本物の保存漏れと見分けが付かない。実際にそれで
      // `やること.md` へ誤った原因が控えられた）。blur なら当たり所が無い。
      await trow.locator('.mo-val').evaluate((el) => el.blur())
      await page.waitForTimeout(200)
      assert(
        (await page.locator('.telop-clip .kf-mark').count()) > 0,
        '準備の段階で印が付いていない（この確認は保存を見る前に印が要る）'
      )
      touchedRef.dirty = true
    }
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
      // 数値欄にカーソルが残っていると Ctrl+M が欄に吸われる（書き出しが始まらない）。
      // **`.mo-head` を押して抜けない**（「動きを消す」ボタンに当たり、打った印が
      // 全部消える）。このまとまりは通しでは通らない道なので、当たっても
      // 気づけなかった。上の「保存して開き直しても残っている」と同じ理由。
      await trow.locator('.mo-val').evaluate((el) => el.blur())
      await page.waitForTimeout(200)
      touchedRef.dirty = true
    }
    const out = join(outDir, 'motion.mp4')
    await setExportTarget(out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
    await fillExportName(out)
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

  // ここから先の6項目「写して配る」は e2e/checks/09c-写して配る.mjs へ出した。
  // **run.mjs の章一覧には足していない**——足すと、後から「番号順に並べ直そう」と
  // されたときに実行順が黙って入れ替わる。元あった位置でそのまま呼ぶ。
  // 章（`section`）も分けていないので、`--only` で選ばれる顔ぶれも変わらない。
  await copyAndShareChecks(C)

  // 続く6項目「保存と書き出しに乗るか」は e2e/checks/09d-保存と書き出し.mjs へ。
  // **あちらは順番への寄りかかりが濃い**（印付き3件＋印の無い寄りかかり2件）。
  // 並べ替える前に、あのファイルの頭を読むこと。
  await saveAndExportChecks(C)

  // Premiere のプリセット取り込み（2件）は e2e/checks/09b-Premiere取り込み.mjs へ出した。
  // 末尾の塊なので、run.mjs の並びで直後に置けば実行順は変わらない。

  // =========================================================================
}
