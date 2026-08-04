// タイムラインを**縦に送る**所を触る道具（縮める・段の上端を測る・送る・境目の位置）。
//
// ## なぜ本体から出したか（2026-08-04）
//
// 11章「トラック（段）」を前後2つに割ったとき、**この道具だけが両方から
// 使われていた**（前半＝見出しの追従／後半＝目盛りと境目）。片方のファイルに
// 置くと、もう片方から触れなくなる。元は `02-タイムライン編集.mjs` の中の
// 局所変数で、中身は1文字も変えていない（関数で包んだだけ）。
//
// ## 中身
//
// - `makeTimelineVScroll` … 下の4つ（squeeze / tops / scrollTo / where）を作って返す

/**
 * @param {object} o 道具の束（e2e/run.mjs の C をそのまま渡す）
 * @param {object} o.page 画面（Playwright）
 * @param {Function} o.dragBy 掴んで動かす
 */
export function makeTimelineVScroll({ page, dragBy }) {
  // ---- 縦スクロールの追従 -------------------------------------------------
  // ここは一度壊している。縦に送れるようにしたのに見出し列を追従させず、
  // V1 の行に音の波形が出て、掴める段と見えている段が食い違って
  // クリップを移動できなくなった。**目で見て分かる形**で固定する。
  //
  // プレビューの枠を広げる＝タイムラインが縮む、なので、
  // 「縮めて入りきらない状態」を作ってから見る。
  const timelineVScroll = {
    /**
     * タイムラインを一番低くして、中身がはみ出す状態を作る。
     *
     * **必ず一度広げてから縮める。** 既に最小まで縮んでいると、下へ引いても
     * 高さが変わらず、伸び縮みの処理そのものが動かない
     * （動かないのを「効いていない」と読み違えて1回転んだ）。
     */
    async squeeze() {
      await dragBy(page.locator('.resizer-h').first(), 0, -400) // まず広げる
      await page.waitForTimeout(250)
      const before = await page.evaluate(
        () => document.querySelector('.timeline')?.getBoundingClientRect().height ?? 0
      )
      await dragBy(page.locator('.resizer-h').first(), 0, before) // 下へ目いっぱい＝最小まで縮む
      await page.waitForTimeout(300)
    },
    /** 段の行と、その見出しの、画面上での上端 */
    tops(id) {
      return page.evaluate((tid) => {
        const row = document.querySelector(`.track[data-tid="${tid}"]`)
        const head = [...document.querySelectorAll('.th')].find(
          (el) => el.querySelector('.th-id')?.textContent?.trim() === tid
        )
        const ruler = document.querySelector('.ruler')
        const sc = document.querySelector('.track-scroll')
        return {
          row: row ? Math.round(row.getBoundingClientRect().top) : null,
          head: head ? Math.round(head.getBoundingClientRect().top) : null,
          ruler: ruler ? Math.round(ruler.getBoundingClientRect().top) : null,
          over: sc ? sc.scrollHeight - sc.clientHeight : 0
        }
      }, id)
    },
    async scrollTo(y) {
      await page.evaluate((v) => {
        const el = document.querySelector('.track-scroll')
        if (el) el.scrollTop = v
      }, y)
      await page.waitForTimeout(250)
    },
    /** 映像と音声の境目が、いま見えている枠のどこに居るか */
    where() {
      return page.evaluate(() => {
        const sc = document.querySelector('.track-scroll')
        const a = document.querySelector('.track-audio')
        if (!sc || !a) return null
        const s = sc.getBoundingClientRect()
        return {
          rel: Math.round(a.getBoundingClientRect().top - s.top), // 枠の上端から境目まで
          view: Math.round(s.height),
          over: sc.scrollHeight - sc.clientHeight,
          top: Math.round(sc.scrollTop)
        }
      })
    }
  }

  return timelineVScroll
}
