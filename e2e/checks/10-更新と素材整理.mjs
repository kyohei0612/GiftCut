// 自動更新・範囲選択・素材ごと書き出し
//
// 章: 更新（アプリが自動で新しくなる） / 5. 範囲選択（投げ縄）とビンの片付け / 2. 素材ごと持ち出す（別のPCへ渡す）
//
// **通しの本体は e2e/run.mjs から分けてある。** 1ファイル7,400行だと、
// 直したい章を探すのに毎回全部を読むことになり、足す場所も決まらないので
// 「仕上げ」に流れ込んでいた。道具（check・assert・素材づくり）は
// run.mjs 側に置いたままで、まとめて受け取る。

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export default async function (C) {
  const {
    app,
    assert,
    check,
    clipLayout,
    clipW,
    dragBy,
    fx,
    page,
    resetProject,
    section,
    setDialogFiles,
    touchedRef,
    v1Clips,
    zipNames,
    zipRead,
  } = C
  section('更新（アプリが自動で新しくなる）')
  await resetProject()

  await check('更新の再起動をしても、作業していた内容が消えない', async () => {
    // 更新そのもの（GitHub から落とす所）は本物のリリースが要るので、ここでは
    // **落とす直前から後** ＝ いちばん壊れると困る所だけを見る。
    // 本体が「落とすぞ」と声を掛ける → 画面側が下書きを書く → 開き直すと続きが出る。
    await dragBy(v1Clips().nth(0), (await clipW()) * 0.35) // 保存していない編集を作る
    await page.waitForTimeout(700)
    const before = await clipLayout()

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('update:flush')
    })
    await page.waitForTimeout(1500)
    const flagged = await page.evaluate(() => localStorage.getItem('giftcut.resumeAfterUpdate'))
    assert(flagged === '1', '再起動前の印が付いていない（次の起動で続きから開けない）')
    assert(existsSync(join(fx.userData, 'giftcut-autosave.json')), '下書きが書かれていない')

    // 開き直す（実際の再起動と同じ道を通る）
    await page.reload()
    await page.waitForSelector('.app', { timeout: 20000 })
    await page.waitForTimeout(2500)
    // 「復元しますか？」とは聞かない（自分で落としておいて聞くのは筋が通らない）
    assert(
      (await page.locator('.restore-box').count()) === 0,
      '更新の再起動なのに「復元しますか？」と聞いている'
    )
    const after = await clipLayout()
    assert(after.length === before.length, `クリップが減っている（${before.length} → ${after.length}）`)
    assert(
      Math.abs(after[0].x - before[0].x) < 6,
      `動かした位置が戻っていない（${before[0].x} → ${after[0].x}）`
    )
    // 印は消えている（次の普通の起動で勝手に復元しない）
    const cleared = await page.evaluate(() => localStorage.getItem('giftcut.resumeAfterUpdate'))
    assert(!cleared, '印が残っている（次の起動でも黙って復元してしまう）')
    touchedRef.dirty = true
  })

  // =========================================================================
  section('5. 範囲選択（投げ縄）とビンの片付け')
  await resetProject()

  // 投げ縄を引いて、囲んだクリップが選ばれた数を返す。
  // 始める場所を変えて呼べるようにしてある（レーンの中／外の違いを見るため）。
  async function lasso(from, to) {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(from.x + ((to.x - from.x) * i) / 6, from.y + ((to.y - from.y) * i) / 6)
    }
    await page.mouse.up()
    await page.waitForTimeout(400)
    return page.locator('.clip-selected, .video-clip.sel, .seg-sel').count()
  }

  await check('レーンの外（レーンの無い余白）からドラッグしても、範囲選択できる', async () => {
    const top = await page.locator('.track-pad').first().boundingBox() // ルーラーと一番上のレーンの間
    const v1 = await page.locator('[data-tid="V1"]').boundingBox()
    const n = await lasso(
      { x: v1.x + 20, y: top.y + top.height / 2 },
      { x: v1.x + v1.width * 0.4, y: v1.y + v1.height - 4 }
    )
    assert(n > 0, `レーンの外から囲んでも何も選ばれない（選択 ${n} 件）`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  })

  await check('レーンの中から始めた範囲選択は、今まで通り効く', async () => {
    const v1 = await page.locator('[data-tid="V1"]').boundingBox()
    // レーン（A2）の空いている所から引く。クリップの上から始めると移動になる。
    // レーンは画面より広く、下のレーンは画面から切れていることもあるので、
    // 掴む点は必ず「見えている範囲」に収める（画面の外はクリックできない）。
    const a2 = await page.locator('[data-tid="A2"]').boundingBox()
    const scroll = await page.locator('.track-scroll').boundingBox()
    const n = await lasso(
      { x: scroll.x + scroll.width * 0.5, y: a2.y + a2.height / 2 },
      { x: scroll.x + scroll.width * 0.2, y: v1.y + 4 }
    )
    assert(n > 0, `レーンの中から囲んでも何も選ばれない（選択 ${n} 件）`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  })

  await check('タイムラインから消した素材は、ビンからも消せる', async () => {
    // 報告された不具合: クリップを全部消しても「使用中です」と言われて消せなかった。
    // 使用中の判定が「元動画として登録されているか」を見ていたため。
    await resetProject()
    touchedRef.dirty = true
    // まず、使用中のものは守られている（ここが緩むと、映っている素材が消える）
    const used = page.locator('.media-card', { hasText: 'test_video.mp4' }).first()
    await used.hover()
    await used.locator('.media-del').click()
    await page.waitForTimeout(500)
    const toast = (await page.locator('.toast').allTextContents()).join(' ')
    assert(toast.includes('使用中'), `使用中の素材が警告なしで消えた: ${toast}`)
    assert(
      (await page.locator('.media-card', { hasText: 'test_video.mp4' }).count()) > 0,
      '使っている動画がビンから消えた'
    )
    // 画像のクリップをタイムラインから全部消す
    let guard = 0
    while ((await page.locator('.img-clip').count()) > 0 && guard++ < 8) {
      await page.locator('.img-clip').first().click()
      await page.keyboard.press('Delete')
      await page.waitForTimeout(350)
    }
    assert((await page.locator('.img-clip').count()) === 0, '画像クリップを消しきれていない')
    // 消したのだから、ビンからも消せるはず（ここが直った所）
    const before = await page.locator('.media-card').count()
    const card = page.locator('.media-card', { hasText: 'test_image.png' }).first()
    await card.hover()
    await card.locator('.media-del').click()
    await page.waitForTimeout(500)
    const after = await page.locator('.media-card').count()
    assert(
      after === before - 1,
      `クリップを消したのにビンから消せない（${before} → ${after}）: ` +
        (await page.locator('.toast').allTextContents()).join(' ')
    )
  })

  // =========================================================================
  section('2. 素材ごと持ち出す（別のPCへ渡す）')
  await resetProject()

  // 受け取り側の展開先は「ドキュメント」の下。本物のドキュメントを汚さないよう、
  // アプリには手を入れず、テストの間だけ行き先を差し替える（ダイアログと同じやり方）。
  const packHome = join(fx.dir, 'ドキュメント')
  mkdirSync(packHome, { recursive: true })
  await app.evaluate(({ app: a }, home) => {
    const orig = a.getPath.bind(a)
    a.getPath = (name) => (name === 'documents' ? home : orig(name))
  }, packHome)
  const packZip = join(fx.dir, '持ち出し.zip')

  await check('素材ごとまとめると、使っている素材が全部入った ZIP ができる', async () => {
    await page.keyboard.press('Control+s') // 未保存の確認を挟まないように
    await page.waitForTimeout(900)
    await setDialogFiles(null, packZip)
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.waitForTimeout(250)
    await page.locator('.menu-drop-item', { hasText: '素材ごとまとめて書き出す' }).first().click()
    // 「ファイルができた」ではまだ書き途中。終わりのお知らせを待つ
    // （ここを存在確認だけで済ませると、書きかけの ZIP を読んで落ちる）
    await page.locator('.toast', { hasText: 'まとめました' }).first().waitFor({ timeout: 120000 })
    assert(existsSync(packZip), 'ZIP ができていない')
    const names = await zipNames(packZip)
    assert(names.includes('プロジェクト.gcproj'), `プロジェクトが入っていない: ${names.join(', ')}`)
    assert(
      names.some((n) => n.startsWith('素材/')),
      `素材が入っていない: ${names.join(', ')}`
    )
    // 元動画は必ず入っている（これが無いと渡された側は何もできない）
    assert(
      names.some((n) => n.startsWith('素材/') && /\.(mp4|mov|mkv)$/i.test(n)),
      `元動画が入っていない: ${names.join(', ')}`
    )
  }, { setup: true })

  await check('ZIP の中のプロジェクトは、ZIP の中の場所を指している', async () => {
    // 絶対パスのまま入れると、渡した先で全部「見つかりません」になる
    const json = await zipRead(packZip, 'プロジェクト.gcproj')
    const p = JSON.parse(json)
    assert(
      typeof p.videoPath === 'string' && p.videoPath.startsWith('素材/'),
      `元動画のパスが書き換わっていない: ${p.videoPath}`
    )
    assert(!/[A-Za-z]:\\/.test(JSON.stringify(p.sources ?? [])), '元PCの絶対パスが残っている')
    assert(p.projectPath === null, '前のPCの保存先が残っている')
  })

  await check('受け取って開くと、素材が繋がった状態で続きから編集できる', async () => {
    const before = await clipLayout()
    await setDialogFiles([packZip], null)
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.waitForTimeout(250)
    await page.locator('.menu-drop-item', { hasText: 'まとめたプロジェクトを開く' }).first().click()
    // **2分も待たない。** 開けないときは開けないので、待っても結果は変わらず、
    // 絞って回したときに「作る側」を飛ばしていると、ただ2分固まって見える
    await page.locator('.toast', { hasText: 'まとめを開きました' }).first().waitFor({ timeout: 45000 })
    await page.waitForTimeout(1200) // 素材の読み込み（プロキシ生成の開始）まで待つ
    // 展開先に素材が実体として置かれている
    const dir = join(packHome, 'GiftCut', '受け取ったプロジェクト', '持ち出し')
    assert(existsSync(join(dir, '素材')), `展開先に素材が無い: ${dir}`)
    // 中身が戻っている（クリップの数と並びが元と同じ）
    const after = await clipLayout()
    assert(
      after.length === before.length,
      `クリップの数が変わった（${before.length} → ${after.length}）`
    )
    // 繋ぎ直したパスが展開先を指し、動画が本当に読めている（プレビューが出る）
    const proj = JSON.parse(readFileSync(join(dir, '持ち出し.gcproj'), 'utf-8'))
    assert(
      proj.videoPath.startsWith(dir),
      `パスが展開先を指していない: ${proj.videoPath}`
    )
    assert(existsSync(proj.videoPath), `繋ぎ直した先に動画が無い: ${proj.videoPath}`)
  })

  // =========================================================================
}
