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

  /** 1本目と2本目の「間」に演出（dur 秒）を付けたプロジェクトを開く */
  const openWithXfade = async (type, dur) => {
    const proj = JSON.parse(readFileSync(fx.gcprojOrig, 'utf-8'))
    proj.segments[0] = { ...proj.segments[0], xfade: { type, dur } }
    const p = join(fx.dir, `xfade-${type}.gcproj`)
    writeFileSync(p, JSON.stringify(proj), 'utf-8')
    await setDialogFiles([p], null)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(400)
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) await cont.click()
    await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 15000 })
    await page.waitForTimeout(1200)
    touchedRef.dirty = true
  }

  /**
   * 間の演出を流しながら毎コマ記録する。
   * op … 覆い（.trans-overlay）のいちばん濃い所 / b … 2本目の面の濃さ /
   * a … 1本目の面が映している元動画の時刻（2本目の面は除く）
   */
  const recordXfade = async (from, ms) => {
    await seekTo(from)
    await page.waitForTimeout(500)
    await page.evaluate(() => {
      window.__xfRec = []
      const loop = () => {
        const op = Math.max(0, ...[...document.querySelectorAll('.trans-overlay')].map((e) => Number(getComputedStyle(e).opacity)))
        const vb = document.querySelector('video.screen-video-b')
        const b = vb ? Number(getComputedStyle(vb).opacity) : 0
        const a = [...document.querySelectorAll('video.screen-video:not(.screen-video-b)')]
          .filter((v) => Number(getComputedStyle(v).opacity) > 0.5)
          .map((v) => +v.currentTime.toFixed(3))
        window.__xfRec.push({ op, b, a })
        window.__xfRaf = requestAnimationFrame(loop)
      }
      loop()
    })
    await page.keyboard.press('Space')
    await page.waitForTimeout(ms)
    await page.keyboard.press('Space')
    return page.evaluate(() => {
      cancelAnimationFrame(window.__xfRaf)
      const r = window.__xfRec
      delete window.__xfRec
      return r
    })
  }

  // 本人（2026-11-12）「暗転が終わったら一回復活する」。**途中のクリップの尻へ落とした演出は
  // 「間」になる**（state/useTransitions の resolveTransDrop）ので、普段使っているのはこちら。
  // 書き出し（ffmpeg xfade の fadeblack）は「前 → 真っ黒 → 次」で、黒が明けるときに
  // 前のシーンは出ない。プレビューで**黒が明ける後半に前のシーンが透けていないか**を見る
  await check('間の黒フェードは、真っ黒になったあと前のシーンが透けずに次のシーンが出る', async () => {
    await resetProject()
    await openWithXfade('dipblack', 1)
    const rec = await recordXfade(3.5, 2200)
    // **いちばん濃いコマから数える。** 0.9 を超えた最初のコマはまだ前半（前のシーンが
    // 黒へ沈んでいく途中＝書き出しでも見える）で、そこから数えると正しい絵まで赤にする
    const top = Math.max(...rec.map((r) => r.op))
    const peak = rec.findIndex((r) => r.op === top)
    assert(top >= 0.9, `黒フェードが真っ黒にならない（覆いの最大 ${top.toFixed(2)}）`)
    // 前のシーン（元動画 4〜5秒）がどれだけ見えているか＝覆いにも2本目にも隠れていない割合
    const seen = rec
      .slice(peak)
      .map((r, i) => ({ ...r, i: i + peak, vis: (1 - r.op) * (1 - r.b) }))
      // 書き出しは 0%。直す前は最大 12%（2本目を溶かして重ねていた）
      .filter((r) => r.a.some((t) => t >= 4 && t < 4.98) && r.vis > 0.05)
    assert(
      !seen.length,
      `真っ黒のあと、前のシーンが ${seen.length}コマ透けて見えた（見えている割合/覆い/2本目: ` +
        seen.slice(0, 4).map((r) => `#${r.i} ${r.vis.toFixed(2)}/${r.op.toFixed(2)}/${r.b.toFixed(2)}`).join(' ') + '）'
    )
  })

  // 書き出しの「ディゾルブ」（xfade の fade）は前後が溶け合うだけで、黒くならない
  await check('間のディゾルブは、途中で黒くならない（書き出しと同じ）', async () => {
    await resetProject()
    await openWithXfade('fade', 1)
    const rec = await recordXfade(3.5, 2200)
    assert(rec.some((r) => r.b > 0.3), 'ディゾルブの2本目が出てこない（準備が成立していない）')
    const darkest = Math.max(...rec.map((r) => r.op))
    assert(darkest < 0.2, `ディゾルブなのに途中で黒い覆いが ${darkest.toFixed(2)} まで掛かった（書き出しは黒くならない）`)
  })

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

  // 本人（2026-11-12）「エフェクト周りの使い勝手が悪い」。帯の端の持ち手は 7px と
  // 書いてあったが、帯（overflow: hidden）に切られて実質 6px しか掴めなかった。
  // → 帯の端をまたいで 12px（内へ6・外へ6）。**外側から実際に掴めること**を見る
  //   （幅の数字は `shared/hitArea.test` が見ている。ここは画面で当たるかどうか）
  await check('演出の帯の持ち手は、帯の外側からでも掴めて長さを変えられる。押しただけでは長さが変わらない', async () => {
    await resetProject()
    await openWithXfade('fade', 0.5)
    const band = page.locator('.ttrans-xfade').first()
    assert(await band.count(), '間の演出の帯が出ていない（準備が成立していない）')
    const durOf = async () => Number(/([\d.]+)s/.exec((await band.getAttribute('title')) ?? '')?.[1] ?? 'NaN')
    const d0 = await durOf()
    assert(Math.abs(d0 - 0.5) < 0.01, `帯の長さが読めない（${d0}）`)
    const box = await band.boundingBox()
    // 帯の左端より 4px 外。前の作りでは、ここは帯の外＝クリップの本体だった
    const x = box.x - 4
    const y = box.y + box.height / 2
    const hit = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.className ?? '', [x, y])
    assert(String(hit).includes('ttrans-resize'), `帯の端から 4px 外で、持ち手に当たらない（当たったのは「${hit}」）`)

    // 押して離すだけ → 選ばれるが、長さは変わらない
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 1, y)
    await page.mouse.up()
    await page.waitForTimeout(300)
    assert(await page.locator('.ttrans-xfade.ttrans-sel').count(), '持ち手を押しても帯が選ばれない')
    assert((await durOf()) === d0, `押しただけで長さが変わった（${d0} → ${await durOf()}）`)

    // 左へ引く → 長くなる（帯は [カット-d, カット) なので、左端を引くと伸びる）
    // 1秒あたりの画素は1本目のクリップ（5秒）から取る。帯の幅は下限（12px）で
    // 押し上げられていることがあるので、物差しにしない
    const pxPerSec = (await v1Clips().nth(0).boundingBox()).width / 5
    assert(pxPerSec * 0.5 > 6, `引く量が小さすぎて確かめられない（0.5秒 = ${(pxPerSec * 0.5).toFixed(1)}px）`)
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - pxPerSec * 0.5, y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    const d1 = await durOf()
    assert(Math.abs(d1 - 1.0) <= 0.1, `外側から掴んで引いても長さが変わらない（${d0} → ${d1}。約1.0 のはず）`)
    await resetProject()
  })
}
