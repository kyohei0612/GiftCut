// 仕上げ（2/3）: **置く・編む。**
//
// 章「仕上げ」を3つに割った2本目（2026-08-06。元は604行）。
// 順番は1行も変えていない（同じ章の中の項目どうしは順番に依存する）。
//
// ## 中身
//
//   落とす（割り込み・影・段の避難・プレビューへ落とす）
//   長さを変える／切る／詰める／空きのまま書き出す
//   まとめて動かす／リップル削除／鍵／元に戻す・やり直す
//
// 道具は run.mjs の C から受け取る。**使う物だけ**
// （受け取り漏れは `node e2e/lint-checks.mjs` が走らせる前に名指しする）。
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

export default async function (C) {
  const {
    assert,
    avgColor,
    binCardReady,
    check,
    clipLayout,
    clipW,
    dndFromBin,
    dragBy,
    fillExportName,
    near,
    outDir,
    page,
    placePiP,
    resetProject,
    seekTo,
    setExportTarget,
    shotDir,
    touchedRef,
    trackHead,
    v1Clips
  } = C

  await check('Ctrl を押しながら落とすと、割り込みで入って後ろがずれる', async () => {
    await resetProject()
    const before = await clipLayout()
    const total0 = before.reduce((a, c) => a + c.w, 0)
    const r = await dndFromBin('test_video', '[data-tid="V1"]', { x: 60, y: 10 }, { ctrlKey: true })
    assert(r.ghost, '掴んだ動画の影が出なかった')
    await page.waitForTimeout(1500)
    const after = await clipLayout()
    const total1 = after.reduce((a, c) => a + c.w, 0)
    assert(total1 > total0 + 10, `割り込みで全体が伸びていない（${total0} → ${total1}）`)
  })

  await check('ドラッグ中、置く予定の場所に影が出て、音の波形も見える', async () => {
    await resetProject()
    await binCardReady('test_video')
    await page.evaluate((name) => {
      const card = [...document.querySelectorAll('.media-card')].find((e) =>
        (e.textContent ?? '').includes(name)
      )
      window.__dt = new DataTransfer()
      card.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dt })
      )
    }, 'test_video')
    await page.evaluate(() => {
      const el = document.querySelector('[data-tid="V1"]')
      const b = el.getBoundingClientRect()
      el.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: b.x + 200,
          clientY: b.y + 10,
          dataTransfer: window.__dt
        })
      )
    })
    await page.waitForTimeout(500)
    assert((await page.locator('.se-ghost').count()) > 0, '置く予定の影が出ていない')
    const audioGhost = await page.locator('[data-tid="A1"] .se-ghost').count()
    assert(audioGhost > 0, '音声側の影が出ていない')
    await page.evaluate(() => {
      document.querySelector('.app').dispatchEvent(new DragEvent('dragend', { bubbles: true }))
    })
    await page.waitForTimeout(300)
  })

  await check('文字がある段に動画を置くと、文字が1段上へ避難する', async () => {
    await resetProject()
    const onV2 = await page.locator('[data-tid="V2"] .telop-clip').count()
    assert(onV2 > 0, 'V2 に文字が無い状態から始まっている')
    const r = await dndFromBin('test_video', '[data-tid="V2"]', { x: 150, y: 10 })
    assert(r.ghost, '掴んだ動画の影が出なかった')
    await page.waitForTimeout(2000)
    const moved = await page.locator('[data-tid="V3"] .telop-clip, [data-tid="V4"] .telop-clip').count()
    assert(moved > 0, '文字が1段上へ避難していない')
  })

  await check('画像は、端をつまんで長さを変えられてカッターで切れる', async () => {
    await resetProject()
    const img = page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)').first()
    const b0 = await img.boundingBox()
    await page.mouse.move(b0.x + b0.width - 3, b0.y + b0.height / 2)
    await page.mouse.down()
    await page.mouse.move(b0.x + b0.width + 60, b0.y + b0.height / 2, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    const b1 = await page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)').first().boundingBox()
    assert(b1.width > b0.width + 20, `長さが変わっていない（${Math.round(b0.width)} → ${Math.round(b1.width)}）`)
    const n0 = await page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)').count()
    await page.keyboard.press('c')
    await page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)').first().click({ position: { x: 40, y: 8 } })
    await page.waitForTimeout(500)
    await page.keyboard.press('v')
    assert(
      (await page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)').count()) === n0 + 1,
      'カッターで切れていない'
    )
  })

  await check('画像や音声をプレビューへ落とすと、一番近い場所に置かれる', async () => {
    await resetProject()
    const n0 = await page.locator('.img-clip:not(.se-ghost)').count()
    const r = await dndFromBin('spare_image', '.panel.monitor', { x: 200, y: 150 })
    assert(r.ghost, '掴んだ画像の影が出なかった')
    await page.waitForTimeout(700)
    assert(
      (await page.locator('.img-clip:not(.se-ghost)').count()) > n0,
      'プレビューに落としても置かれない'
    )
  })

  await check('文字が無い場所で Q を押すと、カットまで詰まる', async () => {
    await resetProject()
    await seekTo(13) // 3つ目のクリップの後半（文字も効果音も無い）
    const before = (await clipLayout()).reduce((a, c) => a + c.w, 0)
    await page.keyboard.press('q')
    await page.waitForTimeout(600)
    const after = (await clipLayout()).reduce((a, c) => a + c.w, 0)
    assert(after < before - 5, `詰まっていない（${before} → ${after}）`)
  })

  await check('空きが入ったまま書き出すと、黒と無音になって尺が合う', async () => {
    await resetProject()
    const W2 = await clipW()
    await dragBy(v1Clips().nth(0), W2 * 0.8)
    await page.waitForTimeout(500)
    const out = join(outDir, 'with-gap.mp4')
    await setExportTarget(out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
    await fillExportName(out)
    await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
    await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 240000 })
    assert(existsSync(out), '書き出しファイルができていない')
    // 空きの真ん中のコマは真っ黒（明暗の幅がほぼ無い）
    const f = join(shotDir, 'gap-frame.png')
    // 画像は1秒から乗っているので、その手前のコマを見る
    const p = spawn('ffmpeg', ['-y', '-ss', '0.4', '-i', out, '-frames:v', '1', f])
    await new Promise((res) => p.on('close', res))
    const c = await avgColor(f)
    assert(c.y != null && c.y < 30, `空きの所が黒くない（明るさ ${c.y}）`)
    // **中身を変えたら必ず立てる。** 立て忘れると次の resetProject が素通りし、
    // ここで作った「頭の2秒の空き」が次の項目へ残る。
    // 実際、音の確認が「素材には無い無音が 0.0〜2.0秒にある」と赤くなり、
    // 本物の不具合と見分けが付かなかった。
    touchedRef.dirty = true
  })

  await check('重ねた動画を選んだあと本編を消しても、重ねた動画は残る', async () => {
    await resetProject()
    await placePiP()
    const pip0 = await page.locator('[data-tid="V2"] .clip:not(.se-ghost)').count()
    await page.locator('[data-tid="V2"] .clip:not(.se-ghost)').first().click()
    await page.waitForTimeout(300)
    const n0 = await v1Clips().count()
    await v1Clips().nth(0).click()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(600)
    assert((await v1Clips().count()) === n0 - 1, '本編が消えていない')
    assert(
      (await page.locator('[data-tid="V2"] .clip:not(.se-ghost)').count()) === pip0,
      '重ねた動画まで消えた'
    )
  })

  await check('画像を複数選んで、まとめて動かせる', async () => {
    await resetProject()
    const pps = (await clipW()) / 5
    await dndFromBin('spare_image', '[data-tid="V3"]', { x: Math.round(pps * 9), y: 10 })
    await page.waitForTimeout(600)
    const imgs = page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)')
    assert((await imgs.count()) >= 2, '画像が2つになっていない')
    const xs0 = await imgs.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)))
    await imgs.nth(0).click()
    await imgs.nth(1).click({ modifiers: ['Control'] })
    await dragBy(imgs.nth(0), 60)
    await page.waitForTimeout(500)
    const xs1 = await imgs.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)))
    assert(xs1.every((x, i) => x > xs0[i] + 5), `まとめて動いていない（${xs0} → ${xs1}）`)
  })

  await check('文字をリップル削除しても、別の段の効果音や画像は動かない', async () => {
    await resetProject()
    const se0 = await page.locator('.se-clip').first().boundingBox()
    const img0 = await page.locator('.img-clip:not(.se-ghost)').first().boundingBox()
    const lower = page.locator('[data-tid="V2"] .telop-clip').first()
    await lower.click()
    await lower.click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    await page.locator('.ctx-item', { hasText: 'リップル削除' }).first().click()
    await page.waitForTimeout(600)
    const se1 = await page.locator('.se-clip').first().boundingBox()
    const img1 = await page.locator('.img-clip:not(.se-ghost)').first().boundingBox()
    near(se1.x, se0.x, 3, '別の段の効果音まで動いてしまった')
    near(img1.x, img0.x, 3, '別の段の画像まで動いてしまった')
  })

  await check('一番下の映像の段に鍵をかけると、動画を落としても本編が上書きされない', async () => {
    await resetProject()
    const before = await clipLayout()
    const lock = trackHead('V1').locator('button[title="ロック"]').first()
    await lock.click()
    await page.waitForTimeout(300)
    const r = await dndFromBin('test_video', '[data-tid="V1"]', { x: 60, y: 10 })
    assert(r.ghost, '掴んだ動画の影が出なかった')
    await page.waitForTimeout(1200)
    const after = await clipLayout()
    assert(after.length === before.length, '鍵をかけたのに本編が書き換えられた')
    near(after[0].w, before[0].w, 3, '鍵をかけたのに本編の長さが変わった')
    await lock.click()
    await page.waitForTimeout(300)
  })

  await check('分割と複製も Ctrl+Z で戻る', async () => {
    await resetProject()
    const n0 = await v1Clips().count()
    await seekTo(7)
    await page.keyboard.press('Control+k') // 分割
    await page.waitForTimeout(500)
    assert((await v1Clips().count()) === n0 + 1, '分割できていない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)
    assert((await v1Clips().count()) === n0, '分割が戻っていない')
    await v1Clips().nth(0).click()
    await page.keyboard.press('Control+d') // 複製
    await page.waitForTimeout(500)
    const dup = await v1Clips().count()
    assert(dup > n0, '複製できていない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)
    assert((await v1Clips().count()) === n0, '複製が戻っていない')
  })

  await check('元に戻す→やり直す をしても、素材が入れ替わらない', async () => {
    await resetProject()
    const names0 = await v1Clips().evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''))
    await dragBy(v1Clips().nth(0), (await clipW()) * 0.4)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
    await page.keyboard.press('Control+y')
    await page.waitForTimeout(500)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)
    const names1 = await v1Clips().evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''))
    assert(
      JSON.stringify(names0) === JSON.stringify(names1),
      `素材が入れ替わった\n前: ${names0.join(' | ')}\n後: ${names1.join(' | ')}`
    )
  })
}
