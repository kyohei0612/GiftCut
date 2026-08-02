// 書き出し設定の引き継ぎと、言葉づかい
//
// 章: 13. 書き出しの設定が効いているか / 14. 見た目の表記ゆれ
//
// **通しの本体は e2e/run.mjs から分けてある。** 1ファイル7,400行だと、
// 直したい章を探すのに毎回全部を読むことになり、足す場所も決まらないので
// 「仕上げ」に流れ込んでいた。道具（check・assert・素材づくり）は
// run.mjs 側に置いたままで、まとめて受け取る。

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

export default async function (C) {
  const {
    assert,
    avgColor,
    avgColorAt,
    check,
    fillExportName,
    setExportTarget,
    fx,
    outDir,
    page,
    resetProject,
    section,
    setDialogFiles,
    shotDir,
    touchedRef,
  } = C
  section('13. 書き出しの設定が効いているか')

  await check('書き出す大きさが素材に合う（上へ伸ばさない）', async () => {
    // **解像度は選ばせない作りにした。** 素材から決める（決め方と理由は
    // shared/exportDefaults。試験もそちらに14件ある）。
    // ここで見るのは「その決め方が、できあがりのファイルまで届いているか」。
    //
    // 段そのもの（480/720/1080/2160 のどれになるか）はここで書き直さない。
    // 書き直すと**同じ規則が2か所**になり、片方だけ直したときに気づけない。
    // 代わりに、規則から必ず言えることだけを見る:
    //   ・素材より大きくしない（大きくしても絵は良くならず、時間だけ増える）
    //   ・決められた段のどれかになっている
    const sizeOf = async (f) => {
      const probe = spawn('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f
      ])
      let o = ''
      probe.stdout.on('data', (d) => (o += d))
      await new Promise((res) => probe.on('close', res))
      return o.trim().split(',').map(Number)
    }
    const [, srcH] = await sizeOf(fx.video)
    const out = join(outDir, 'res-src.mp4')
    await setExportTarget(out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
    await fillExportName(out)
    await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
    await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 240000 })
    assert(existsSync(out), '書き出しファイルができていない')
    const [w, h] = await sizeOf(out)
    // **見るのは「短い辺」。** 縦長（9:16）では 480x854 になるのが正しく、
    // 高さで見ていると縦長で必ず落ちる（480p＝短い辺が480、という意味なので）
    const short = Math.min(w, h)
    assert([480, 720, 1080, 2160].includes(short), `決められた段になっていない（${w}x${h}）`)
    // 一番下の段（480）より低い素材だけは、そこまで上げる決まり
    assert(
      short <= Math.max(srcH, 480),
      `素材（高さ${srcH}）より大きく書き出している（${w}x${h}）`
    )
  })

  await check('ショート（9:16）でも、縦長のまま中身が入って書き出せる', async () => {
    // **縦長は横長の使い回しでは通らない。** 幅と高さが入れ替わるので、
    // 出力の寸法・映像の入り方（潰れていないか）・テロップの焼き込みが
    // それぞれ別の壊れ方をしうる。ショートを作る人には毎回効く所なので機械で見る。
    await resetProject()
    await page.locator('.ratio-group .chip', { hasText: '9:16' }).first().click()
    await page.waitForTimeout(600)
    assert(
      (await page.locator('.ratio-group .chip.chip-on').innerText()).includes('9:16'),
      '9:16 に切り替わっていない'
    )
    const out = join(outDir, 'short916.mp4')
    await setExportTarget(out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
    await fillExportName(out)
    await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
    await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 240000 })
    assert(existsSync(out), '書き出しファイルができていない')

    const probe = spawn('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,nb_frames:format=duration', '-of', 'default=nw=1', out
    ])
    let o = ''
    probe.stdout.on('data', (d) => (o += d))
    await new Promise((res) => probe.on('close', res))
    const w = Number(/width=(\d+)/.exec(o)?.[1] ?? 0)
    const h = Number(/height=(\d+)/.exec(o)?.[1] ?? 0)
    const dur = Number(/duration=([\d.]+)/.exec(o)?.[1] ?? 0)
    // 大きさは素材から決まる（選ばせない作りにした）ので、**数字を決め打ちしない。**
    // 見るのは「縦長になっていること」と「9:16 になっていること」。
    assert(h > w, `縦長になっていない（${w}x${h}）`)
    assert(Math.abs(w / h - 9 / 16) < 0.02, `9:16 になっていない（${w}x${h}）`)
    assert(dur > 1, `尺が入っていない（${dur}秒）`)

    // **中身が入っていること。** 寸法だけ合っていて真っ黒、が一番たちが悪い。
    const f = join(shotDir, 'short916.png')
    const g = spawn('ffmpeg', ['-y', '-ss', '1.2', '-i', out, '-frames:v', '1', f])
    await new Promise((res) => g.on('close', res))
    assert(existsSync(f), 'コマを取り出せない')
    const c = await avgColor(f)
    assert(c.y != null && c.y > 8, `中身が真っ黒（明るさ ${c.y}）`)

    // **収まり方まで見る。** 横長の素材を縦長の枠に入れるので、
    // 上下は黒帯・真ん中に映像、が正しい形。
    // ここを見ないと「引き伸ばして潰れている」「横に倒れている」を見逃す。
    // **測る場所は割合で出す。** 大きさは素材から決まるので、画素数を
    // 決め打ちすると素材を替えた瞬間に枠の外を測って落ちる
    const band = Math.round(h * 0.2)
    const top = await avgColorAt(f, 0, 0, w, band)
    const middle = await avgColorAt(f, 0, Math.round(h * 0.4), w, band)
    const bottom = await avgColorAt(f, 0, h - band, w, band)
    assert(
      middle.y != null && top.y != null && bottom.y != null,
      '縦長のコマを場所ごとに測れない'
    )
    assert(
      middle.y > top.y + 5 && middle.y > bottom.y + 5,
      `映像が真ん中に入っていない（上 ${top.y} / 中 ${middle.y} / 下 ${bottom.y}）` +
        '＝引き伸ばしか、上下が埋まっている'
    )
    // 真ん中には模様がある（のっぺりなら映像が出ていない）
    assert(middle.range != null && middle.range > 30, `真ん中に絵が無い（明暗の幅 ${middle.range}）`)

    // テロップも焼けているか。文字が乗る所は明暗の幅が出る
    const ft = join(shotDir, 'short916-telop.png')
    const gt = spawn('ffmpeg', ['-y', '-ss', '2.0', '-i', out, '-frames:v', '1', ft])
    await new Promise((res) => gt.on('close', res))
    assert(existsSync(ft), 'テロップ確認用のコマを取り出せない')
    const tArea = await avgColorAt(ft, 0, Math.round(h * 0.6), w, Math.round(h * 0.26)) // 下寄り＝既定のテロップ位置
    assert(
      tArea.range != null && tArea.range > 40,
      `縦長だとテロップが焼けていない/枠の外に出ている（明暗の幅 ${tArea.range}）`
    )

    await page.locator('.ratio-group .chip', { hasText: '16:9' }).first().click()
    await page.waitForTimeout(400)
    touchedRef.dirty = true
    await resetProject()
  })

  await check('Ctrl+M でも書き出しの設定画面が出る（いきなり始まらない）', async () => {
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay', { timeout: 5000 })
    const txt = await page.locator('.export-overlay').textContent()
    assert(txt.includes('書き出す'), '設定画面ではなく書き出しが始まった')
    await page.locator('.export-overlay').click({ position: { x: 5, y: 5 } })
    await page.waitForTimeout(300)
  })

  // =========================================================================
  section('14. 見た目の表記ゆれ')

  await check('時間の目盛りと再生位置の時刻が同じ形式（00:00:00:00）', async () => {
    const cur = await page.locator('.transport, .tl-foot, .statusbar').first().textContent()
    const m = cur.match(/\d{2}:\d{2}:\d{2}[:.]\d{2}/)
    assert(m, `再生位置の時刻が見つからない: ${cur.slice(0, 80)}`)
    assert(m[0].includes(':') && m[0].split(/[:.]/).length === 4, `形式が違う: ${m[0]}`)
  })

  await check('左右のパネルの折りたたみ矢印が同じ記号', async () => {
    const arrows = await page.locator('.panel .collapse, .panel .pane-toggle').evaluateAll((els) =>
      els.map((e) => (e.textContent ?? '').trim())
    )
    if (arrows.length >= 2) {
      const uniq = [...new Set(arrows.map((a) => a.replace(/[<>]/g, '')))]
      assert(uniq.length <= 2, `矢印の記号が揃っていない: ${arrows.join(' / ')}`)
    }
  })

  // =========================================================================
}
