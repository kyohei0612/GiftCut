// Premiere のプリセット（.prfpset）を取り込む。
//
// 章: モーション（キーフレームで動かす）
//
// **09-モーション.mjs から出しただけ。中身は1文字も変えていない**（2026-08-03）。
// あちらは1,205行に21項目が入っていて、確認を1つ足すたびに全部を読む羽目になっていた。
//
// **末尾の2件を選んだのは、実行順が1ミリも変わらないから。** run.mjs の並びで
// 09 の直後に置けば、前後の項目から見た状態はいままでと同じ。途中の塊を出すと、
// 印の付いていない順番依存（手前の項目が残した状態に寄りかかる所）が静かにずれる。
//
// ※ この2件は**必ず一緒に動かすこと**。後の1件は、前の1件が取り込んだ見本に寄りかかる
//   （だから { orderDependent: true } が付いている）。

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export default async function (C) {
  const { assert, check, fx, outDir, page, resetProject, section, seekTo, setDialogFiles, touchedRef } = C
  section('モーション（Premiere の取り込み）')

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
    // **開いている節は自分で畳んでから始める。**
    //
    // ここには「節が1つも開いていないこと」を確かめる行があった。
    // ところが**右パネルは開閉を覚える**（`やること.md`。組み立て直すたびに
    // 既定へ戻ると、選ぶ物を変えるたびに開き直す羽目になるので、そうした）。
    // つまりこの確認は「自分より前に誰も節を開いていない」でしか成り立たず、
    // **並び順が変わった瞬間に落ちる。**
    //
    // 2026-08-05、章を束ねて1つのアプリで回す形にしたら実際に落ちた
    // （直列の並びではたまたま閉じた状態で来ていた）。**並列の負荷ではない**
    // ——単独で同じ順に並べても同じように落ちる。
    //
    // 「既定は畳んでおく」の確認は 08-右パネル の持ち場なので、ここでは持たない。
    // **ここが要るのは「動きの節が開いている」状態だけ**なので、それを自分で作る。
    for (const el of await page.locator('.tpl-acc.open').all()) {
      await el.click().catch(() => {})
      await page.waitForTimeout(120)
    }
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
  },
  // **手前の項目が作った見本帳の中身（E2E_右から）に寄りかかっている。**
  // 絞って回すとその見本が無いので、押す物が見つからず必ず時間切れになる。
  { orderDependent: true })
}
