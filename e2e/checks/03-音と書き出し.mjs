// 音量まわりと、書き出した物の中身
//
// 章: 9・13. 音と書き出し（一番損害の大きい事故を機械で見る）
//
// **通しの本体は e2e/run.mjs から分けてある。** 1ファイル7,400行だと、
// 直したい章を探すのに毎回全部を読むことになり、足す場所も決まらないので
// 「仕上げ」に流れ込んでいた。道具（check・assert・素材づくり）は
// run.mjs 側に置いたままで、まとめて受け取る。

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

export default async function (C) {
  const {
    setSlider,
    trackHead,
    assert,
    check,
    fx,
    meanVolume,
    near,
    outDir,
    page,
    resetProject,
    section,
    setDialogFiles,
    sh,
  } = C
  section('9・13. 音と書き出し（一番損害の大きい事故を機械で見る）')

  await check('ソロにしたまま書き出しても、他のトラックの音が消えない', async () => {
    // ソロは「自分で聞くためだけ」の機能。書き出しに効いてしまうと、
    // 出来上がった動画から本編の音が丸ごと消えるという最悪の事故になる。
    const soloBtn = trackHead('A1').locator('button[title="ソロ"]').first()
    assert(await soloBtn.count(), 'A1 のソロボタンが見つからない')

    const exportOnce = async (label) => {
      const out = join(outDir, `${label}.mp4`)
      await setDialogFiles(null, out)
      await page.keyboard.press('Control+m') // 書き出しの設定画面を開く
      await page.waitForSelector('.export-overlay', { timeout: 8000 })
      await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
      // 完了まで待つ（進捗のオーバーレイが消えるまで）
      await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 240000 })
      assert(existsSync(out), `書き出しファイルができていない: ${out}`)
      return out
    }
    const plain = await exportOnce('plain')
    await soloBtn.click() // どこかのトラックをソロにする
    await page.waitForTimeout(300)
    const solo = await exportOnce('solo')
    await soloBtn.click() // 戻す

    // 音量を測って比べる（ソロで本編の音が消えていれば無音に近くなる）
    const loud = async (f) => {
      const p = spawn('ffmpeg', ['-i', f, '-af', 'volumedetect', '-f', 'null', '-'])
      let err = ''
      p.stderr.on('data', (d) => (err += d))
      await new Promise((res) => p.on('close', res))
      const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(err)
      return m ? parseFloat(m[1]) : null
    }
    const a = await loud(plain)
    const b = await loud(solo)
    assert(a !== null && b !== null, '書き出したファイルの音量を測れなかった')
    assert(b > -60, `ソロのまま書き出したら音がほぼ消えた（${b} dB）`)
    near(b, a, 6, `ソロの有無で書き出しの音量が変わった（通常 ${a} dB / ソロ ${b} dB）`)
  })

  await check('ダッキング: 声に合わせて BGM が下がる（書き出しでも）', async () => {
    // 「設定は入るが音は変わらない」が一番まずい。実際に2回書き出して、
    // **その差を測る**。声に埋もれて平均では見えないので、引き算で BGM の変化だけを見る。
    await resetProject()
    const exportOnce = async (label) => {
      const out = join(outDir, `${label}.mp4`)
      await setDialogFiles(null, out)
      await page.keyboard.press('Control+m')
      await page.waitForSelector('.export-overlay', { timeout: 8000 })
      await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
      await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 240000 })
      assert(existsSync(out), `書き出しファイルができていない: ${out}`)
      return out
    }
    const before = await exportOnce('duck-off')
    // 声のある所を調べる（確認用の素材は静かなので、しきい値をゆるめる）
    await page.locator('.tool-wide', { hasText: '無音カット' }).click()
    await page.waitForSelector('.sil-box')
    await setSlider('これより静かなら無音', -25)
    await setSlider('この長さ以上を無音とみなす', 0.2)
    await page.locator('.sil-box .btn', { hasText: '調べる' }).click()
    await page.waitForFunction(
      () => !(document.querySelector('.sil-result')?.textContent ?? '').includes('調べています'),
      { timeout: 60000 }
    )
    await page.locator('.sil-box .btn', { hasText: '閉じる' }).click()
    await page.waitForTimeout(300)
    // BGM クリップを右クリック →「声に合わせて下げる」
    await page.locator('.se-clip').first().click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const duckItem = page.locator('.ctx-item', { hasText: '声に合わせて下げる' })
    assert(await duckItem.count(), 'メニューにダッキングが無い')
    await duckItem.first().click()
    await page.waitForTimeout(800)
    // 下げ幅を最大にして、測って分かる差を作る
    if (await page.locator('.sil-box').count()) {
      await setSlider('どれだけ下げるか', -24)
      await page.waitForTimeout(300)
      await page.locator('.sil-box .btn', { hasText: '閉じる' }).click()
      await page.waitForTimeout(300)
    }
    const after = await exportOnce('duck-on')
    // 指定が書き出しまで届いているか（届いていないのか、効きが弱いのかを分ける）
    const filterFile = join(fx.userData, 'last-export-filter.txt')
    const filterTxt = existsSync(filterFile) ? readFileSync(filterFile, 'utf-8') : ''
    assert(
      filterTxt.includes('volume=eval=frame'),
      '書き出しに声の音量指定が渡っていない（控えのフィルタに見当たらない）'
    )
    // 2つの音の差を作って測る。何も変わっていなければ、差は無音になる。
    const diff = join(outDir, 'duck-diff.wav')
    await sh('ffmpeg', [
      '-y', '-i', before, '-i', after,
      '-filter_complex', '[1:a]volume=-1[inv];[0:a][inv]amix=inputs=2:normalize=0[d]',
      '-map', '[d]', diff
    ])
    const d = await meanVolume(diff)
    const a = await meanVolume(before)
    const b = await meanVolume(after)
    assert(a !== null && b !== null && d !== null, '書き出した音量を測れなかった')
    assert(a > -70, `そもそも音が入っていない（${a} dB）`)
    // 差が無音＝ダッキングが1つも効いていない
    assert(d > -70, `ダッキングの有無で音が変わっていない（差 ${d} dB）`)
    assert(b <= a + 0.5, `ダッキングを入れたのに音が大きくなった（${a} → ${b} dB）`)
  })

  // =========================================================================
}
