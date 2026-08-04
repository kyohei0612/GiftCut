// 負荷チェックの**「50回編集して、50回戻す」**。履歴とメモリと、戻したら元どおりか。
//
// ## なぜ本体から出したか（2026-08-04）
//
// `bench.mjs` が上限（1,250行）に当たった。話題で3つに分けたうちの1つ。
// ここは**履歴を積んで、戻して、元に戻ったかを見る**だけを持つ。
//
// ## いちばん怖い壊れ方
//
// **元に戻したのに、絵だけ戻っていない。** 並びが合っていても絵が違えば、
// 使う人は「壊れた」と思う。だから並び（クリップの位置と幅）と
// 絵（同じ時刻のプレビュー）の**両方**を見る。
//
// ## 見くらべる前に「同じ時刻か」を確かめる
//
// 2026-08-04 に、**違う時刻どうしを見くらべて 0.745** と出て、
// 「元に戻したのに絵が違う」というアプリの不具合として報告しかけた。
// 素材にテロップが焼き込まれていたので、撮った画面を並べて初めて気づいた。
// → 秒で照合して、ずれていたら「絵の違いではない」と言って落とす。
//
// ## 中身
//
// - `runHistoryChecks` … 50回切る → メモリ → 50回戻す → 元どおりか
export async function runHistoryChecks(ctx) {
  const {
    page, say, done, shot, heap, heap0, mb, fmt, EDITS, nowSec,
    similarity, prev, visL, visR, rb, seekAt, headSec, SEEK_SEC
  } = ctx
  /** タイムラインの真ん中あたりに再生位置を移す（前後で同じ絵を見くらべるため） */
  const seekMid = () => seekAt(SEEK_SEC)
  /** クリップの位置と幅の一覧。元に戻したときに並びが復元したかを見る。 */
  const clipLayout = async () => {
    const boxes = await page.locator('[data-tid="V1"] .video-clip').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect()
        return { x: Math.round(r.x), w: Math.round(r.width) }
      })
    )
    return boxes
  }
  await seekMid()
  const shotPvBefore = await shot('編集前のプレビュー', prev)
  // 見くらべる相手の時刻を控える（下の「元に戻したら映像も戻る」で照合する）
  const seekedSec = await headSec()
  const layoutBefore = await clipLayout()

  const before = await page.locator('[data-tid="V1"] .video-clip').count()
  await say('動作', `${EDITS}回続けて切る`, '履歴を積んだときのメモリを見る')
  const tCut = nowSec()
  for (let i = 0; i < EDITS; i++) {
    // 見えている範囲の中だけを押す（外を押しても切れない）
    await page.mouse.click(visL + ((visR - visL) * (i + 0.5)) / EDITS, rb.y + rb.height / 2)
    await page.waitForTimeout(30)
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(30)
  }
  const cutSec = nowSec() - tCut
  await page.waitForTimeout(500)
  const after = await page.locator('[data-tid="V1"] .video-clip').count()
  await done(
    '動作',
    `${EDITS}回続けて切る`,
    `クリップ ${before} → ${after} 個 / ${fmt(cutSec)}秒（1回 ${fmt((cutSec / EDITS) * 1000, 0)}ms）`,
    after > before ? 'ok' : 'ng'
  )
  const heap1 = await heap()
  await done(
    '動作',
    `${EDITS}回ぶんの履歴を積んだあとのメモリ`,
    `${mb(heap1)}（開いた直後から ${mb(heap1 - heap0)} 増）`,
    heap1 - heap0 < 400e6 ? 'ok' : 'warn'
  )

  await say('動作', `${EDITS}回ぶん元に戻す`, '戻したあとに元の見た目へ戻るかも見る')
  const tUndo = nowSec()
  for (let i = 0; i < EDITS; i++) {
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(30)
  }
  const undoSec = nowSec() - tUndo
  await page.waitForTimeout(800)
  const back = await page.locator('[data-tid="V1"] .video-clip').count()
  await done(
    '動作',
    `${EDITS}回ぶん元に戻す`,
    `クリップ ${after} → ${back} 個 / ${fmt(undoSec)}秒`,
    back === before ? 'ok' : 'ng'
  )
  const heap2 = await heap()
  await done(
    '動作',
    '元に戻したあとのメモリ',
    `${mb(heap2)}（開いた直後との差 ${mb(heap2 - heap0)}）`,
    heap2 - heap0 < 300e6 ? 'ok' : 'warn'
  )

  // ---- 目と動作: 戻したら元どおりか ------------------------------------
  // 画面全体を見くらべると、再生ヘッドの位置や選択の枠まで差として出てしまう。
  // 「戻ったか」を見たいので、同じ時点のプレビューの絵と、クリップの並びで見る。
  await say('目', '元に戻したら映像も戻る', '同じ位置のプレビューを見くらべる')
  const tBefore = seekedSec
  await seekMid()
  const tAfter = await headSec()
  // **同じ時刻を見ていることを先に確かめる。** ここがずれていると、
  // 「元に戻したのに絵が違う」という**アプリの不具合に見える**
  //（2026-08-04 に実際そう報告しかけた。素材にテロップが焼かれていたので、
  //  撮った画面を並べて初めて「違うのは時刻だ」と分かった）。
  if (Math.abs(tAfter - tBefore) > 0.5)
    throw new Error(
      `見くらべる時刻がずれている（${fmt(tBefore)}秒 → ${fmt(tAfter)}秒）。絵の違いではない`
    )
  const shotPvAfter = await shot('元に戻したあとのプレビュー', prev)
  const sim = await similarity(shotPvBefore, shotPvAfter)
  await done(
    '目',
    '元に戻したら映像も戻る',
    `同じ位置のプレビューの一致度 ${sim.toFixed(3)}（1.0 で完全一致）`,
    sim > 0.98 ? 'ok' : sim > 0.9 ? 'warn' : 'ng'
  )
  const layoutAfter = await clipLayout()
  const sameLayout = JSON.stringify(layoutBefore) === JSON.stringify(layoutAfter)
  await done(
    '動作',
    '元に戻したらクリップの並びも戻る',
    `クリップ ${layoutBefore.length} 個の位置と幅を照合`,
    sameLayout ? 'ok' : 'ng'
  )
  await shot('元に戻したあと')
}
