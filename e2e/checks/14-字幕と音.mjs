// SRT の読み込み、音・リップル削除・書き出し
//
// 章: 字幕ファイル（SRT）の読み込み / 9-10-13. 音・リップル削除・書き出し
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
    trackHead,
    dndFromBin,
    assert,
    check,
    fillExportName,
    setExportTarget,
    clipW,
    fx,
    near,
    outDir,
    page,
    resetProject,
    section,
    setDialogFiles,
    shotDir,
    similarity,
  } = C
  section('字幕ファイル（SRT）の読み込み')
  await resetProject()

  await check('文字がある状態でSRTを読むと、件数つきで確認が出る', async () => {
    await setDialogFiles([fx.srt], null)
    const n0 = await page.locator('.telop-clip').count()
    assert(n0 > 0, '文字が無い状態から始まっている')
    await page.locator('button', { hasText: 'SRT読込' }).first().click()
    await page.waitForSelector('.modal-box', { timeout: 8000 })
    const title = await page.locator('.modal-title').textContent()
    assert(
      title.includes(String(n0)) && title.includes('置き換え'),
      `件数つきの確認になっていない: ${title}`
    )
  })

  await check('その確認で「中止」を押すと、今ある文字が消えない', async () => {
    const n0 = await page.locator('.telop-clip').count()
    await page.locator('.modal-btn', { hasText: '中止' }).first().click()
    await page.waitForTimeout(400)
    assert((await page.locator('.modal-box').count()) === 0, '確認が閉じていない')
    assert((await page.locator('.telop-clip').count()) === n0, '中止したのに文字が消えた')
  })

  await check('「置き換える」を選ぶと、SRTの中身に入れ替わる', async () => {
    await setDialogFiles([fx.srt], null)
    await page.locator('button', { hasText: 'SRT読込' }).first().click()
    await page.waitForSelector('.modal-box', { timeout: 8000 })
    await page.locator('.modal-btn', { hasText: '置き換える' }).first().click()
    await page.waitForTimeout(900)
    const n1 = await page.locator('.telop-clip').count()
    assert(n1 > 0, '読み込んだ文字が1つも出ていない')
    // 読み込んだ字幕の1つ目が、実際に画面に出ていること
    const txt = await page.locator('.telop-clip').first().textContent()
    assert(txt.trim().length > 0, '文字の中身が空になっている')
  })

  // =========================================================================
  section('9-10-13. 音・リップル削除・書き出し')
  await resetProject()

  await check('ミキサーの数字に「dB」が付いている', async () => {
    // `.panel-tabs *` だと、タブを囲っている帯そのものが先に当たる。
    // 帯の真ん中はタブとタブの隙間なので、押しても何も起きず、
    // 「ミキサーに dB が出ていない」＝アプリの不具合のように見えていた。
    // タブそのもの（.tab）を押す。
    const tab = page.locator('.panel.monitor .tab', { hasText: 'オーディオミキサー' }).first()
    assert(await tab.count(), 'ミキサーのタブが見当たらない')
    await tab.click()
    await page.waitForTimeout(500)
    const on = await page.locator('.panel.monitor .tab-on').first().textContent()
    assert(on.includes('ミキサー'), `ミキサーのタブに切り替わっていない（${on}）`)
    const txt = await page.locator('.panel.monitor').first().textContent()
    assert(txt.includes('dB'), `ミキサーに dB が出ていない: ${txt.slice(0, 120)}`)
    const back = page.locator('.panel.monitor .tab', { hasText: 'プログラム' }).first()
    if (await back.count()) await back.click()
    await page.waitForTimeout(400)
  })

  await check('画像をリップル削除すると、同じ段の後ろだけが詰まる', async () => {
    await resetProject()
    // V3 に2つ目の画像を置いて、後ろが詰まるか見る
    // 1つ目の画像は 1〜5秒。詰まるのを見るには、その**外**に置く必要がある
    const pps = (await clipW()) / 5
    const r = await dndFromBin('spare_image', '[data-tid="V3"]', { x: Math.round(pps * 9), y: 10 })
    assert(r.ghost, '掴んだ画像の影が出なかった')
    await page.waitForTimeout(600)
    const imgs = page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)')
    assert((await imgs.count()) >= 2, '画像が2つになっていない')
    const xs = await imgs.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)))
    const cueX0 = await page.locator('.telop-clip').first().boundingBox()
    await imgs.nth(0).click()
    await imgs.nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    await page.locator('.ctx-item', { hasText: 'リップル削除' }).first().click()
    await page.waitForTimeout(600)
    const xs2 = await imgs.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)))
    assert(xs2.length === xs.length - 1, '画像が1つ減っていない')
    assert(xs2[0] < xs[1] - 5, `同じ段の後ろが詰まっていない（${xs[1]} → ${xs2[0]}）`)
    const cueX1 = await page.locator('.telop-clip').first().boundingBox()
    near(cueX1.x, cueX0.x, 3, '別の段の文字まで動いてしまった')
  })

  await check('鍵をかけた段のクリップが混ざっていると、リップル削除は実行されない', async () => {
    await resetProject()
    const lock = trackHead('V2').locator('button[title="ロック"]').first()
    await lock.click()
    await page.waitForTimeout(300)
    const n0 = await page.locator('.telop-clip').count()
    await page.locator('.telop-clip').first().click()
    await page.locator('.telop-clip').first().click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const item = page.locator('.ctx-item', { hasText: 'リップル削除' })
    if (await item.count()) {
      await item.first().click()
      await page.waitForTimeout(500)
    } else {
      await page.keyboard.press('Escape')
    }
    assert((await page.locator('.telop-clip').count()) === n0, '鍵をかけたのに消えた')
    await lock.click()
    await page.waitForTimeout(300)
  })

  await check('書き出しの設定画面が出て、いきなり始まらない', async () => {
    await resetProject()
    await page.locator('.mode-tab', { hasText: '書き出し' }).first().click()
    await page.waitForSelector('.export-overlay', { timeout: 8000 })
    const txt = await page.locator('.export-overlay').textContent()
    // 窓が出ただけでは足りない。**押した瞬間に始まっていない**ことを見たいので、
    // 「まだ始まっていない窓」にしか無い物（タイトル欄・書き出し先）で確かめる
    assert(
      txt.includes('タイトル') && txt.includes('書き出し先'),
      `設定画面が出ていない: ${txt.slice(0, 80)}`
    )
    await page.locator('.export-overlay').click({ position: { x: 5, y: 5 } })
    await page.waitForTimeout(400)
  })

  await check('フレームレート「素材と同じ」で、素材と同じなめらかさになる', async () => {
    const out = join(outDir, 'fps-same.mp4')
    await setExportTarget(out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
    // **fps は選ばせない作りにした**（素材と同じで固定）。
    // 選ぶ代わりに、窓が「素材と同じ」であることを言っているかを見る。
    // ここを見ないと、黙って 30fps に落ちていても気づけない
    const txt = await page.locator('.export-overlay').textContent()
    assert(/素材と同じ設定で書き出します/.test(txt), `窓に書き出す中身の説明が無い: ${txt.slice(0, 80)}`)
    await fillExportName(out)
    await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
    await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 240000 })
    assert(existsSync(out), '書き出しファイルができていない')
    const fpsOf = async (f) => {
      const p = spawn('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', f
      ])
      let o = ''
      p.stdout.on('data', (d) => (o += d))
      await new Promise((res) => p.on('close', res))
      const [a, b] = o.trim().split('/')
      return Number(a) / Number(b || 1)
    }
    const src = await fpsOf(fx.video)
    const got = await fpsOf(out)
    assert(Math.abs(src - got) < 0.5, `素材 ${src.toFixed(2)}fps に対し ${got.toFixed(2)}fps`)
  })

  await check('書き出した動画に、文字と画像が焼き込まれている', async () => {
    // 文字も画像も無い時刻と、両方ある時刻のコマを抜き出して見比べる
    const out = join(outDir, 'fps-same.mp4')
    // 前の項目が書き出したファイルに頼っていたので、絞って回すと
    // 「コマを抜き出せなかった」で落ちていた。無ければ自分で書き出す。
    if (!existsSync(out)) {
      await setExportTarget(out)
      await page.keyboard.press('Control+m')
      await page.waitForSelector('.export-overlay', { timeout: 8000 })
      await fillExportName(out)
      await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
      await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 240000 })
      assert(existsSync(out), '書き出しファイルができていない')
    }
    const frame = async (t, name) => {
      const f = join(shotDir, name)
      const p = spawn('ffmpeg', ['-y', '-ss', String(t), '-i', out, '-frames:v', '1', f])
      await new Promise((res) => p.on('close', res))
      return f
    }
    const withStuff = await frame(2, 'exp-with.png') // 文字1〜3秒・画像1〜5秒
    const without = await frame(12, 'exp-without.png') // 何も乗っていない
    assert(existsSync(withStuff) && existsSync(without), 'コマを抜き出せなかった')
    const sim = await similarity(withStuff, without)
    assert(sim < 0.9, `文字や画像が焼き込まれていない疑い（一致度 ${sim.toFixed(3)}）`)
  })

  await check('書き出しの途中でやめられて、中途半端なファイルが残らない', async () => {
    // **軽い書き出しだと、中止を押す前に終わってしまう**（GPU で焼くようになって
    // 実際にそうなった）。それでは「中止できた」ことを確かめられないので、
    // 一番重い設定（4K）にして、途中で止められる時間を作る。
    await resetProject()
    const out = join(outDir, 'cancelled.mp4')
    await setExportTarget(out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
    // ※ 以前はここで 4K を選んで重くしていたが、**解像度は選ばせない作りにした**
    //   （素材から決まる）。重くする手が無くなったので、出た瞬間に掴む方だけが頼り。
    //   ここが不安定になったら、重くするのではなく**尺を伸ばす**方で作ること
    await fillExportName(out)
    await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
    // **待ってから探してはいけない。** 書き出しが速いと、探す前に終わってしまい
    // 「中止ボタンが無い」と誤って報告する（GPU で焼くようになって実際に起きた）。
    // 出た瞬間に掴む。
    const cancel = page.locator('.export-overlay button', { hasText: /中止|キャンセル|やめる/ })
    await cancel.first().waitFor({ timeout: 8000 })
    await cancel.first().click()
    await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 60000 })
    await page.waitForTimeout(800)
    assert(!existsSync(out), '中止したのにファイルが残っている')
  })

  // =========================================================================
  // =========================================================================
}
