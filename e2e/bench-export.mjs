// 負荷チェックの**書き出し（目と耳）**。実際に焼いて、完走するか・音が抜けないかを見る。
//
// ## なぜ本体から出したか（2026-08-04）
//
// `bench.mjs` が上限に当たり、話題で分けた3つ目。ここは**焼いてから測る**だけ。
// 触って測る（./bench-ops）・履歴（./bench-history）とは互いを知らない。
//
// ## 「完走した」で終わらせない
//
// 出来上がったファイルがあっても、**中が無音**だったり**真っ黒**だったりする。
// 書き出しは何分もかかるので、そこまで気づかないのがいちばん痛い。
// だから尺・大きさ・音量・無音の長さ・明るさまで見る。
//
// ## 中身
//
// - `runExportChecks` … 焼いて、完走・音・絵を測る
export async function runExportChecks(ctx) {
  const {
    say, done, fmt, mb, MINUTES, totalSec, nowSec,
    page, sh, join, existsSync, statSync, meanVolume, silentSec, brightness,
    // 焼く先と、1コマ抜いた絵を置く所。**本体から出したときに受け取り忘れていて、
    // 焼き終わった直後に ReferenceError で落ちていた**（2026-08-04）。
    // 何分も焼いた後に落ちるので、いちばん損害の大きい抜け方をする
    exportPath, SHOTS
  } = ctx
  if (!exportPath || !SHOTS) throw new Error('焼く先（exportPath / SHOTS）が渡っていない')
    await say('耳', `${MINUTES}分ぶんを書き出す`, '完走するか・音が抜けないかを見る')
    const t0 = nowSec()
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
    await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
    let finished = true
    try {
      await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 4 * 3600 * 1000 })
    } catch {
      finished = false
    }
    const sec = nowSec() - t0
    const size = existsSync(exportPath) ? statSync(exportPath).size : 0
    await done(
      '動作',
      `${MINUTES}分ぶんの書き出しが完走する`,
      finished && size > 0
        ? `${fmt(sec / 60)}分 / ${mb(size)}（実時間の ${fmt(sec / totalSec, 2)}倍）`
        : '完走しなかった',
      finished && size > 0 ? 'ok' : 'ng'
    )

    if (size > 0) {
      const vol = await meanVolume(exportPath)
      await done(
        '耳',
        '書き出した音が入っている',
        `平均音量 ${fmt(vol)}dB（無音なら -90 付近）`,
        vol > -40 ? 'ok' : 'ng'
      )
      const sil = await silentSec(exportPath)
      await done(
        '耳',
        '音が途中で抜けていない',
        `無音区間 合計 ${fmt(sil)}秒 / 全体 ${totalSec}秒`,
        sil < totalSec * 0.2 ? 'ok' : 'warn'
      )
      // 書き出した動画の真ん中あたりを1コマ抜いて、絵が入っているか見る
      const frame = join(SHOTS, 'export-frame.png')
      await sh('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.floor(totalSec / 2)), '-i', exportPath, '-frames:v', '1', frame])
      if (existsSync(frame)) {
        const b = await brightness(frame)
        await done(
          '目',
          '書き出した映像が黒くない',
          `明るさ 平均${fmt(b.avg, 0)} 幅${fmt(b.max - b.min, 0)}`,
          b.max - b.min > 40 ? 'ok' : 'ng'
        )
      }
    }
}
