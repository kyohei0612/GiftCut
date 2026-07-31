// 画面に出る「窓」をどけて、先へ進めるようにする。
//
// ## なぜ1か所にまとめるか
//
// **窓で止まるのが、自動の道具がこける一番の理由だった。**
// 1日で4回踏んでいる:
//
//   ・監査（npm run audit）が、起動直後のテンプレート選びで押せず落ちた
//   ・9:16 の通しが、「前回の作業が残っています」で比率を当てられず落ちた
//   ・通しが、テンプレート選びの閉じ忘れで20件以上を巻き添えにした
//   ・字幕の確認が、同じ所で止まった
//
// どれも「その道具の書き忘れ」ではなく、**窓が出るのが普通だから**起きている。
// 道具ごとに書くと必ずどれかが抜けるので、ここに1つだけ置いて全部から呼ぶ。
//
// ## 何を押すか
//
// **消える方（進む方）を押す。** 復元は「復元する」、テンプレート選びは
// 「空で始める」、未保存の確認は「このまま続ける」。
// 迷ったら**何も壊さない方**を選ぶ（破棄より復元、削除よりキャンセル）。

// ## 黙って止まらせない
//
// **一番たちが悪いのは「窓で止まって、何も言わずに待ち続ける」形。**
// 実際、字幕の画面確認が33分、1行も出さずに止まっていた。
// 出力が無いと「重い処理をしている」のか「死んでいる」のか区別がつかない。
//
// なので自動の道具には必ず:
//   ・step() で今どこかを言わせる（黙らせない）
//   ・watchdog() で頭打ちを決める（時間が来たら自分から落ちる）

let lastStep = '（まだ何もしていない）'
let t0 = Date.now()

/** 今どこにいるかを言う。止まったとき、どこで止まったかが分かる */
export function step(name) {
  lastStep = name
  const s = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`[${s}秒] ${name}`)
}

/**
 * 決めた時間を過ぎたら、どこで止まったかを言って自分から落ちる。
 *
 * **待ち続けるより、落ちた方がいい。** 落ちれば原因が残る。
 */
export function watchdog(minutes = 10, onKill) {
  t0 = Date.now()
  const t = setTimeout(async () => {
    console.error(`\n**${minutes}分を過ぎました。ここで止まっています: ${lastStep}**`)
    try {
      await onKill?.()
    } catch {
      /* 片づけに失敗しても落ちる方を優先する */
    }
    process.exit(1)
  }, minutes * 60000)
  t.unref() // 仕事が終わっていれば、この見張りが居残らない
  return t
}

/** 押してよいボタン。上から順に探す（先に来る物ほど「進む」意味が強い） */
const BUTTONS = [
  '復元する',
  'このまま続ける',
  '空で始める',
  '閉じる',
  'キャンセル',
  'あとで'
]

/**
 * 窓が出ていたら閉じる。出ていなければ何もしない。
 *
 * @returns 閉じた窓の題名（閉じなければ null）
 */
export async function dismissModal(page) {
  try {
    if ((await page.locator('.export-overlay, .modal-box').count()) === 0) return null
    const title =
      (await page.locator('.restore-title').first().innerText().catch(() => '')) || '（題名なし）'
    for (const label of BUTTONS) {
      const b = page
        .locator('.restore-btns button, .modal-btn', { hasText: label })
        .filter({ hasText: label })
      if (await b.count()) {
        await b.first().click({ timeout: 3000 }).catch(() => {})
        await page.waitForTimeout(400)
        return title
      }
    }
    // **押す物が無い窓は、待っている窓。**
    // 同じ覆い（.export-overlay）は「書き出し中」「聞き取り中」にも使う。
    // そこで Escape を押すと、聞きに来たのではなく**走っている処理を止めて**しまう。
    // ボタンが1つも無いなら、それは進み具合を見せているだけなので手を出さない。
    if ((await page.locator('.restore-btns button').count()) === 0) return null
    // 名前で見つからなければ Escape（効かない窓もあるので最後の手段）
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    return title
  } catch {
    return null
  }
}

/**
 * 窓が無くなるまでどけ続ける（次の窓が続けて出ることがある）。
 * **何度も回さない**——同じ窓が閉じないなら、それは本物の不具合。
 */
export async function clearModals(page, tries = 3) {
  const closed = []
  for (let i = 0; i < tries; i++) {
    const t = await dismissModal(page)
    if (!t) break
    closed.push(t)
  }
  return closed
}
