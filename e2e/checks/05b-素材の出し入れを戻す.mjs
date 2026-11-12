// 素材（置き場）の出し入れ・動画の差し替えを、元に戻す・やり直すで行き来できる。
//
// 章「12. 元に戻す・やり直す」を名乗るのは ./05-カットと色.mjs。ここはその続き。
//
// 本人（2026-11-12）「プロジェクトの動画とか入れた奴、戻すで戻らない」「アプリを
// 開きっぱなしなら、保存しようが、戻し続ければ開いた状態まで戻れるのが理想」。
//
// 前は置き場（mediaItems）と元動画（sources）が履歴の外に居た。置き場から消すと
// 元動画の登録ごと捨てていたので、戻しても**指す先の無い切片**だけが帰ってきた
// （直した所: state/useHistory・state/useMedia・state/useMainSource）。
//
// **札の数だけでなく、戻した先で映像が実際に流れること**まで見る。札と切片が
// 帰ってきても、元動画が生き返っていなければ何も映らない。

import { copyFileSync } from 'node:fs'
import { join } from 'node:path'

export default async function (C) {
  const {
    assert, binCardReady, check, dndFromBin, fx, page, resetProject, setDialogFiles,
    touchedRef, v1Clips
  } = C

  const cards = (name) => page.locator('.media-card', { hasText: name }).count()
  /** いまの保存の中身（原本のパスと元動画の一覧を見る） */
  const saved = () =>
    page.evaluate(() => {
      const d = JSON.parse(window.__gcProjectJson())
      return {
        videoPath: d.videoPath ?? null,
        sources: (d.sources ?? []).map((s) => s.path),
        // 映像のある切片の数。**帯の数（画面）では数えない**——遠くへ置いた物は
        // 画面の外で、帯が作られない
        segs: (d.segments ?? []).filter((s) => !s.gap).length
      }
    })
  const undo = async () => {
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(700)
  }
  const redo = async () => {
    await page.keyboard.press('Control+Shift+z')
    await page.waitForTimeout(700)
  }
  /** 2本目の動画（中身は同じ。名前だけ違う）を置き場へ足す */
  const second = join(fx.dir, 'second_clip.mp4')
  const addSecond = async () => {
    copyFileSync(fx.video, second)
    await page.locator('.panel-tabs-strip').last().locator('.tab', { hasText: 'プロジェクト' }).first().click()
    await page.waitForTimeout(300)
    await setDialogFiles([second], null)
    await page.locator('button', { hasText: 'ファイル追加' }).first().click()
    await page.waitForTimeout(900)
    await binCardReady('second_clip')
  }
  /** 映像の要素が読み込まれるのを待つ（元動画が生き返ると要素は作り直しになる） */
  const videoReady = () =>
    page.waitForFunction(
      () => [...document.querySelectorAll('video')].some((v) => v.readyState >= 2),
      null,
      { timeout: 15000 }
    )
  /** 再生して、映像の時計が実際に何秒進むか */
  const plays = async () => {
    const t = () =>
      page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('video')].map((v) => v.currentTime)))
    await page.keyboard.press('Home')
    await page.waitForTimeout(500)
    const t0 = await t()
    await page.keyboard.press('Space')
    await page.waitForTimeout(1500)
    const t1 = await t()
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    return t1 - t0
  }

  await check('置き場へ足した素材は Ctrl+Z で消えて、やり直すで戻る', async () => {
    await resetProject()
    touchedRef.dirty = true
    assert((await cards('second_clip')) === 0, '始める前から2本目が置き場に在る（準備が成立していない）')
    await addSecond()
    assert((await cards('second_clip')) === 1, '置き場に足せていない（準備が成立していない）')
    await page.waitForTimeout(600) // 履歴は 450ms で1手にまとまる
    await undo()
    assert((await cards('second_clip')) === 0, 'Ctrl+Z しても、足した素材が置き場に残っている')
    await redo()
    assert((await cards('second_clip')) === 1, 'やり直しても、足した素材が置き場へ戻らない')
  })

  await check('使っている動画を置き場から消しても、Ctrl+Z で札・切片・映像が戻る', async () => {
    await resetProject()
    touchedRef.dirty = true
    const n = await v1Clips().count()
    assert(n > 0, '本編に切片が無い（準備が成立していない）')
    const card = await binCardReady('test_video')
    await card.hover()
    await card.locator('.media-del').click()
    await page.waitForTimeout(900)
    assert(
      (await cards('test_video')) === 0 && (await v1Clips().count()) === 0,
      '置き場から消せていない（準備が成立していない）'
    )
    assert((await saved()).videoPath === null, '最後の1本を消したのに、原本のパスが残っている')

    await undo()
    assert((await cards('test_video')) === 1, 'Ctrl+Z しても、消した素材の札が置き場へ戻らない')
    assert((await v1Clips().count()) === n, `Ctrl+Z しても切片が戻らない（${await v1Clips().count()} / ${n}）`)
    const s = await saved()
    assert(
      s.videoPath?.endsWith('test_video.mp4') && s.sources.length === 1,
      `戻したのに元動画が帰ってきていない（原本 ${s.videoPath} / 一覧 ${s.sources.length}本）`
    )
    await videoReady()
    const moved = await plays()
    assert(moved > 0.3, `戻した動画が流れない（1.5秒流して、映像の時計は ${moved.toFixed(2)}秒しか進まない）`)

    await redo()
    assert(
      (await cards('test_video')) === 0 && (await v1Clips().count()) === 0,
      'やり直しても、消した状態に戻らない'
    )
    await undo()
    assert((await v1Clips().count()) === n, 'もう一度 Ctrl+Z で切片が戻らない')
  })

  await check('主の動画を置き場から消すと、残った動画が主になる（保存しても元動画を失わない）。戻すと元の主へ戻る', async () => {
    await resetProject()
    touchedRef.dirty = true
    const n = (await saved()).segs
    await addSecond()
    // 本編の後ろの空いた所へ置く（画面の外になるので、数は保存の中身で見る）
    const row = await page.locator('[data-tid="V1"]').first().boundingBox()
    await dndFromBin('second_clip', '[data-tid="V1"]', { x: Math.round(row.width * 0.9), y: 10 })
    await page.waitForTimeout(1500)
    const before = await saved()
    assert(before.segs === n + 1, `2本目が本編に並んでいない（${before.segs}本。準備が成立していない）`)
    assert(
      before.videoPath?.endsWith('test_video.mp4') && before.sources.length === 2,
      '元動画が2本になっていない（準備が成立していない）'
    )

    const card = await binCardReady('test_video')
    await card.hover()
    await card.locator('.media-del').click()
    await page.waitForTimeout(900)
    const after = await saved()
    assert(
      after.videoPath?.endsWith('second_clip.mp4'),
      `主を消したら、残った動画が主になっていない（原本 ${after.videoPath}）。` +
        'このまま保存すると、開き直したとき元動画の一覧ごと失う'
    )
    assert(after.sources.length === 1, `消した動画が元動画の一覧に残っている（${after.sources.length}本）`)
    assert(after.segs === 1, `消した動画の切片が残っている／残すべき2本目まで消えた（${after.segs}本）`)

    await undo()
    const back = await saved()
    assert(
      back.videoPath?.endsWith('test_video.mp4') &&
        back.sources[0]?.endsWith('test_video.mp4') &&
        back.sources.length === 2,
      `戻しても元の主へ戻らない（原本 ${back.videoPath} / 一覧 ${back.sources.join(' , ')}）`
    )
    assert((await cards('test_video')) === 1, '戻しても、消した素材の札が置き場へ戻らない')
    assert(back.segs === n + 1, `戻しても切片が揃わない（${back.segs} / ${n + 1}）`)
  })

  await check('動画の差し替えも Ctrl+Z で前の動画とカットへ戻れる（履歴を捨てない）', async () => {
    await resetProject()
    touchedRef.dirty = true
    const n = await v1Clips().count()
    assert(n >= 2, `カットが無い（${n}本。差し替えで作り直しになったかを区別できない）`)
    copyFileSync(fx.video, second)
    await setDialogFiles([second], null)
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.locator('.menu-drop-item', { hasText: '差し替え' }).first().click()
    await page.waitForTimeout(700)
    await page.locator('.modal-btn.danger', { hasText: '差し替える' }).first().click()
    await page.waitForTimeout(2500)
    const now = await saved()
    assert(
      now.videoPath?.endsWith('second_clip.mp4') && (await v1Clips().count()) === 1,
      `差し替わっていない（原本 ${now.videoPath} / 本編 ${await v1Clips().count()}本。準備が成立していない）`
    )
    await undo()
    const back = await saved()
    assert((await v1Clips().count()) === n, `Ctrl+Z しても前のカットへ戻らない（${await v1Clips().count()} / ${n}）`)
    assert(
      back.videoPath?.endsWith('test_video.mp4') && back.sources[0]?.endsWith('test_video.mp4'),
      `Ctrl+Z しても前の動画へ戻らない（原本 ${back.videoPath}）`
    )
    await videoReady()
    const moved = await plays()
    assert(moved > 0.3, `戻した動画が流れない（映像の時計が ${moved.toFixed(2)}秒しか進まない）`)
    await redo()
    assert((await saved()).videoPath?.endsWith('second_clip.mp4'), 'やり直しても、差し替えた動画へ進まない')
    await resetProject()
  })
}
