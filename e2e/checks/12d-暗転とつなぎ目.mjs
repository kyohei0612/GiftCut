// 暗転（黒フェード）とつなぎ目——**流しているときの絵**を毎コマ見る。
//
// 章「12. プレビュー」を名乗るのは ./12-プレビュー.mjs。ここはその4つ目。
//
// 本人（2026-11-12）「暗転フェードが終わったら、後ろにシーンがあると一回復活する」。
// 書き出しは切片ごとに fade=t=out で焼くので復活しない。**プレビューだけの話**。
//
// ## 測り方
//
// 再生中に rAF で毎コマ、(1) 黒い覆い（.trans-overlay）の濃さ と (2) **いま見えている
// 映像の面**（opacity 1 の <video>）が映している元動画の時刻、を記録する。
// 1本目は元動画の 0〜5秒、2本目は 5〜10秒（e2e/lib/e2eFixture）なので、
// **覆いが薄いのに、見えている面がまだ 1本目の尻（4〜5秒）を映している**コマ＝復活。
// 一度暗くなりきってから（覆い 0.9 以上を見てから）のコマだけ数える。

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export default async function (C) {
  const { assert, check, fx, page, resetProject, seekTo, setDialogFiles, touchedRef, v1Clips } = C

  /** 1本目の尻に暗転（dur 秒）を付けたプロジェクトを開く */
  const openWithTailDip = async (type, dur) => {
    const proj = JSON.parse(readFileSync(fx.gcprojOrig, 'utf-8'))
    proj.segments[0] = { ...proj.segments[0], transOut: { type, dur } }
    const p = join(fx.dir, `tail-${type}.gcproj`)
    writeFileSync(p, JSON.stringify(proj), 'utf-8')
    await setDialogFiles([p], null)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(400)
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) await cont.click()
    await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 15000 })
    await page.waitForTimeout(1200)
    touchedRef.dirty = true
    assert((await v1Clips().count()) === 3, '暗転を付けたプロジェクトが開けていない（準備が成立していない）')
  }

  /** 再生しながら毎コマ記録して、復活したコマを返す */
  const playAndRecord = async (from, ms) => {
    await seekTo(from)
    await page.waitForTimeout(500)
    await page.evaluate(() => {
      window.__dipRec = []
      const loop = () => {
        const ov = document.querySelector('.trans-overlay')
        const op = ov ? Number(getComputedStyle(ov).opacity) : 0
        const shown = [...document.querySelectorAll('video.screen-video')].filter(
          (v) => Number(getComputedStyle(v).opacity) > 0.5
        )
        window.__dipRec.push({ op, t: shown.map((v) => +v.currentTime.toFixed(3)) })
        window.__dipRaf = requestAnimationFrame(loop)
      }
      loop()
    })
    await page.keyboard.press('Space')
    await page.waitForTimeout(ms)
    await page.keyboard.press('Space')
    return page.evaluate(() => {
      cancelAnimationFrame(window.__dipRaf)
      const r = window.__dipRec
      delete window.__dipRec
      return r
    })
  }

  // ---- 帯の上の◆（動きの印）----
  // 本人（2026-11-12）「文字を順に出すやつ、せっかく印で出るのにタイミングを調整できない。
  // 印を選んで消すとテロップごと消える」。◆は components/timeline/KeyMarks
  await check('テロップの◆は、掴んでずらせて、選んで Delete すると◆だけ消える（テロップは残る）', async () => {
    await resetProject()
    // 1枚目のテロップ（1〜3秒）に、0.5秒と1.2秒の印を打ったプロジェクトを開く
    const proj = JSON.parse(readFileSync(fx.gcprojOrig, 'utf-8'))
    proj.cues[0] = {
      ...proj.cues[0],
      motion: { op: [{ t: 0.5, v: 0 }, { t: 1.2, v: 1 }] }
    }
    const p = join(fx.dir, 'keymarks.gcproj')
    writeFileSync(p, JSON.stringify(proj), 'utf-8')
    await setDialogFiles([p], null)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(400)
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) await cont.click()
    await page.waitForSelector('.telop-clip .kf-mark', { timeout: 15000 })
    touchedRef.dirty = true
    const keyTimes = () =>
      page.evaluate(() => {
        const d = JSON.parse(window.__gcProjectJson())
        return (d.cues[0].motion?.op ?? []).map((k) => k.t)
      })
    const telops = () => page.locator('.telop-clip').count()
    const n0 = await telops()
    assert(JSON.stringify(await keyTimes()) === '[0.5,1.2]', `印が打てていない（準備が成立していない）: ${JSON.stringify(await keyTimes())}`)
    const marks = page.locator('.telop-clip').first().locator('.kf-mark')
    assert((await marks.count()) === 2, `帯に◆が2つ出ていない（${await marks.count()}個）`)

    // 1) 2つ目の◆（1.2秒）を右へずらす
    const box = await marks.nth(1).boundingBox()
    const band = await page.locator('.telop-clip').first().boundingBox()
    const pxPerSec = band.width / 2 // 1枚目のテロップは 2秒
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + pxPerSec * 0.3, box.y + box.height / 2, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(600)
    const moved = await keyTimes()
    assert(
      moved.length === 2 && moved[0] === 0.5 && Math.abs(moved[1] - 1.5) <= 0.05,
      `◆をずらしても印の時刻が動かない（${JSON.stringify(moved)}。1.2 → 約1.5 のはず）`
    )
    assert((await telops()) === n0, '◆を掴んだらテロップが増減した')

    // 2) 1つ目の◆を選んで Delete → ◆だけ消える
    await marks.nth(0).click()
    await page.waitForTimeout(200)
    assert(await page.locator('.kf-mark-sel').count(), '◆を押しても選ばれた見た目にならない')
    await page.keyboard.press('Delete')
    await page.waitForTimeout(600)
    assert((await telops()) === n0, '◆を選んで Delete したら、テロップごと消えた')
    const left = await keyTimes()
    assert(left.length === 1 && Math.abs(left[0] - 1.5) <= 0.05, `選んだ◆だけが消えていない（${JSON.stringify(left)}）`)

    // 3) ◆を選んだあとテロップを押して Delete → 今度はテロップが消える（◆の選択が横取りしない）
    await page.locator('.telop-clip').first().locator('.kf-mark').first().click()
    await page.waitForTimeout(200)
    await page.locator('.telop-clip').nth(1).click()
    await page.waitForTimeout(200)
    await page.keyboard.press('Delete')
    await page.waitForTimeout(600)
    assert((await telops()) === n0 - 1, `◆の選択が残ったまま、テロップを選んで Delete しても消えない（${await telops()}枚）`)
  })

  await check('尻に暗転を付けたクリップの後ろに次のシーンがあっても、暗転が終わった瞬間に前のシーンが戻らない', async () => {
    await resetProject()
    await openWithTailDip('dipblack', 1)
    const rec = await playAndRecord(3.5, 2600)
    const dark = rec.findIndex((r) => r.op >= 0.9)
    assert(dark >= 0, `暗転が暗くなりきらない（覆いの最大 ${Math.max(...rec.map((r) => r.op)).toFixed(2)}・${rec.length}コマ）`)
    // 2本目へ進めたか（見えている面が 5秒より後ろを映したコマがあるか）
    assert(
      rec.slice(dark).some((r) => r.t.some((t) => t >= 5.05)),
      `再生しても2本目へ進んでいない（準備が成立していない。最後のコマ ${JSON.stringify(rec.at(-1))}）`
    )
    const revived = rec
      .slice(dark)
      .map((r, i) => ({ ...r, i: i + dark }))
      .filter((r) => r.op < 0.5 && r.t.some((t) => t >= 4 && t < 4.98))
    assert(
      !revived.length,
      `暗転が終わったあと、前のシーンが ${revived.length}コマ素通しで見えた（覆い/見えている面の時刻: ` +
        revived.slice(0, 4).map((r) => `#${r.i} ${r.op.toFixed(2)}/${r.t.join(',')}`).join(' ') + '）'
    )
  })
}
