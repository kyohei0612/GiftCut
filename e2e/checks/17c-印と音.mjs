// **印と赤**（マウスの印が目盛りの数字に切れずに出る／上書きされる帯が赤くなる）と、
// **耳で聴く確認**（書き出した音を測る）、**画面の記録**。
//
// `17-目と耳の確認.mjs` から出した（決まり: 600超は500以下に割る）。
// 章「耳で聴く確認」「画面の記録」を名乗るのはここ。入口は ./17-目と耳の確認.mjs
//
// ## 音の確認は同じ書き出しを使い回す
//
// 1本焼くのに時間がかかるので、**焼くのは1回**。測る側だけ変える。

import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export default async function (C) {
  const {
    ONLY, ROOT, SHOT_ONLY, assert, avgColorAt, check, fillExportName, setExportTarget, fx, loudness, meanVolume,
    outDir, page, resetProject, section, seekTo, setDialogFiles, shot, shotDir,
    silences, similarity
  } = C
  await check('マウスの印が、目盛りの数字の上に切れずに出る', async () => {
    // 再生ヘッドと見分けが付く形にしてある（全高の縦線は再生ヘッドだけ）。
    // 印は目盛りの中に収め、頭を数字の上に乗せる。
    //
    // ※「目盛りより上に何px 出ているか」で見てはいけない。目盛りは
    // スクロール領域の一番上に貼り付いているので、上へ出した分は切り落とされる。
    // 実際、位置の計算は 3px 突き出しているのに目では何も見えていなかった。
    // **切られていないこと**（＝領域の内側にあること）で見る。
    await resetProject()
    const box = await page.locator('.track-inner').boundingBox()
    await page.mouse.move(Math.round(box.x + 220), Math.round(box.y + 12)) // 目盛りの上
    await page.waitForTimeout(300)
    const m = await page.evaluate(() => {
      const mk = document.querySelector('.hover-mark')
      const rl = document.querySelector('.ruler')
      const sc = document.querySelector('.track-scroll')
      const tm = document.querySelector('.hover-time')
      if (!mk || !rl || !sc) return null
      const a = mk.getBoundingClientRect()
      const b = rl.getBoundingClientRect()
      const s = sc.getBoundingClientRect()
      const head = getComputedStyle(mk, '::before')
      const own = getComputedStyle(mk)
      return {
        markTop: Math.round(a.top),
        markLeft: Math.round(a.left),
        markW: Math.round(a.width),
        markH: Math.round(a.height),
        rulerTop: Math.round(b.top),
        rulerH: Math.round(b.height),
        cut: Math.round(s.top - a.top), // 0より大きい＝切り落とされている
        inRuler: a.top >= b.top - 1 && a.top < b.bottom, // 目盛りの中に居る
        headH: parseFloat(head.height) || 0,
        headW: parseFloat(head.width) || 0,
        headBg: head.backgroundColor,
        headContent: head.content,
        vis: `${own.display}/${own.visibility}/${own.opacity}`,
        time: tm ? tm.textContent.trim() : null
      }
    })
    assert(m, 'マウスの印が出ていない')
    assert(m.cut <= 0, `印の頭が枠の外にはみ出して切れている（${m.cut}px ぶん）`)
    assert(m.inRuler, `印が目盛りの中に居ない（印 ${m.markTop} / 目盛り ${m.rulerTop}）`)
    assert(m.headH >= 3, `印の頭が出ていない（高さ ${m.headH}px）＝線だけで目盛りに紛れる`)
    assert(m.time, '印に時刻が出ていない')
    // ここまでは「計算上そうなっている」の確認。**本当に描かれているか**は画素で見る。
    //
    // 撮るのは画面まるごと（clip を渡さない）。clip を渡すと表示範囲がいじられ、
    // その拍子にマウスが枠から出た扱いになって印が消える。
    // 切り取りは撮った後に ffmpeg でやる。
    const shot = join(shotDir, 'hover-mark.png')
    await page.screenshot({ path: shot })
    const still = await page.evaluate(() => !!document.querySelector('.hover-mark'))
    assert(still, '撮っている途中で印が消えた（撮り方の問題。clip を渡していないか確認）')
    const head = await avgColorAt(shot, m.markLeft - 6, m.rulerTop, 13, 5)
    const bg = await avgColorAt(shot, m.markLeft - 46, m.rulerTop, 13, 5)
    assert(head.y != null && bg.y != null, '画素を測れなかった（ffmpeg が見つからない可能性）')
    assert(
      head.y > bg.y + 40,
      `印の頭が描かれていない（頭の明るさ ${Math.round(head.y)} / 何も無い所 ${Math.round(bg.y)}）`
    )
  })

  await check('上書きされるクリップが、見た目にはっきり赤くなる', async () => {
    const target = v1Clips().nth(1)
    const before = join(shotDir, 'ov-before.png')
    const after = join(shotDir, 'ov-after.png')
    await target.screenshot({ path: before })
    const box = await v1Clips().nth(0).boundingBox()
    const w = box.width
    await page.mouse.move(box.x + 20, box.y + box.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + 20 + (w * i) / 6, box.y + box.height / 2)
    await page.waitForTimeout(350)
    await target.screenshot({ path: after })
    await page.mouse.move(box.x + 20, box.y + box.height / 2)
    await page.mouse.up()
    await page.waitForTimeout(300)
    const c0 = await avgColor(before)
    const c1 = await avgColor(after)
    assert(c0.v != null && c1.v != null, '色を測れなかった')
    // V が大きいほど赤寄り。警告中は赤縁が乗るので上がるはず。
    assert(c1.v > c0.v + 1, `赤くなっていない（V: ${c0.v?.toFixed(1)} → ${c1.v?.toFixed(1)}）`)
  })

  // =========================================================================
  section('耳で聴く確認（書き出した音を測る）')
  await resetProject()
  // **前に焼いた物を測らない。**
  // 使い回す作りなので、別の状態（例: 頭に空きを入れる項目）で焼かれた物が
  // 残っていると、まっさらにした後でもそれを測ってしまう。
  // 実際に「素材には無い無音が 0.0〜2.0秒にある」と赤くなり、
  // **本物の不具合と見分けが付かなかった**。焼き直しは1本ぶんで済む。
  rmSync(join(outDir, 'audio-check.mp4'), { force: true })

  // 音の確認は同じ書き出しを使い回す（1本焼くのに時間がかかるため）。
  // ただし**絞って回したときに、焼いていないのに測ろうとする**ことがあるので、
  // 無ければその場で焼く。前の項目の結果に寄りかからせない。
  const exportForAudioCheck = async (out) => {
    if (existsSync(out)) return
    await setExportTarget(out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
    await fillExportName(out)
    await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
    await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 240000 })
  }

  await check('書き出した動画に、途中で音が途切れる所が無い', async () => {
    const out = join(outDir, 'audio-check.mp4')
    await exportForAudioCheck(out)
    assert(existsSync(out), '書き出しファイルができていない')
    const vol = await meanVolume(out)
    assert(vol !== null && vol > -60, `全体が無音になっている（${vol} dB）`)
    // 0.6秒以上の無音が続いていたら音が抜けている疑い。ただし**素材そのものが
    // 無音の所**（実素材の頭など）は問題ではないので、素材側の無音は差し引く。
    const gaps = await silences(out, -50, 0.6)
    const srcGaps = await silences(fx.video, -50, 0.6)
    const explained = (g) =>
      srcGaps.some((s) => g.start >= s.start - 1.2 && g.start <= s.start + s.dur + 1.2)
    const bad = gaps.filter((g) => !explained(g))
    assert(
      bad.length === 0,
      `素材には無い無音ができている: ${bad.map((g) => `${g.start.toFixed(1)}秒から${g.dur.toFixed(1)}秒`).join(' / ')}`
    )
  })

  await check('書き出した動画の音量が、狙った大きさに揃っている', async () => {
    const out = join(outDir, 'audio-check.mp4')
    await exportForAudioCheck(out)
    const lufs = await loudness(out)
    assert(lufs !== null, 'ラウドネスを測れなかった')
    // 画面の設定は -14 LUFS。実測がそこから大きく外れていたら揃っていない。
    assert(Math.abs(lufs + 14) < 3, `狙いの -14 LUFS から離れている（実測 ${lufs} LUFS）`)
  })

  // =========================================================================
  section('画面の記録')

  // 画面の記録は「通しで回したとき」と「撮るだけのとき」だけ。
  // 絞って回すたびに同じ画面を撮っても、前のものと変わらず意味が無い。
  if (!ONLY.length || SHOT_ONLY) {
    await check(
      '最後の画面をスクリーンショットに残す',
      async () => {
        await page.screenshot({ path: join(ROOT, 'e2e', 'last-run.png') })
        if (SHOT_ONLY) console.log('  → e2e/last-run.png に撮りました')
      },
      { setup: true }
    )
  }
}
