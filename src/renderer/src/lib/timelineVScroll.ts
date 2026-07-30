// タイムラインを縦に送ったときの「ついていく側」。
//
// 【なぜ独立させたか】
// 前に縦スクロールを足して壊している。段だけが動いて左の見出しが残り、
// V1 の行に音の波形が出て、掴める段と見えている段が食い違って移動できなくなった。
// 原因は「スクロールを足したのに、ついていく側を作らなかった」こと。
//
// 同じ罠を二度と踏まないよう、**ついていく相手を1か所に集めて**テストで固定する。
// 呼ぶ側（App）は「送った量」を渡すだけにしてある。
//
// ついていく必要があるのは2つ。
//   1. 段見出しの並び（.th-body） … 同じ量だけ上へずらす
//   2. 目盛りに貼り付く物          … 再生ヘッドの三角・つまみ、めじるしの旗、
//      磁石の印。中身の上端を基準に置いてあるので、送った量を CSS 変数で渡し、
//      styles.css 側が calc で目盛りの位置へ置き直す。
//
// ※かつて3つ目に「左端の高さ調整の丸」があった。縦に送ると枠の外へ出て消え、
//   掴んだ丸と実際の境目が離れることもあったので廃止し、段見出しの境目そのものを
//   掴む形（プレミアと同じ）にした。境目は見出しと一緒に動くので追従は要らない。
//
// 当たり判定（何秒の・どの段か）は全部 track-inner の矩形を基準にしているので、
// スクロールしても勝手に正しくなる。**基準をスクロール側に変えないこと。**

/** 送った量を書き込む CSS 変数。styles.css の calc(... + var(--tl-scroll)) と対。 */
export const TL_SCROLL_VAR = '--tl-scroll'

export interface TimelineVScrollTargets {
  /** 左の段見出しの並び（.th-body） */
  headers?: HTMLElement | null
  /** タイムラインの中身（.track-inner）。目盛りに貼り付く物の基準を渡す先 */
  inner?: HTMLElement | null
}

/**
 * 縦に送った量を、ついていく側へ配る。
 *
 * @param scrollTop 送った量(px)。負の値やNaNは0として扱う（環境によっては
 *                  行き過ぎ（オーバースクロール）で負が来る）。
 */
export function applyTimelineVScroll(
  scrollTop: number,
  { headers, inner }: TimelineVScrollTargets
): number {
  const st = Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : 0
  const shift = `translateY(${-st}px)`
  if (headers) headers.style.transform = shift
  inner?.style.setProperty(TL_SCROLL_VAR, `${st}px`)
  return st
}

/**
 * プレビューとの境目を動かしてタイムラインの高さが変わったとき、
 * **どこを残すか**。
 *
 * 素のままだと、枠は下端だけが動く＝縮めると下（音声）から順に消えていき、
 * 上（映像）はいつまでも全部見えている。これは片側だけが減る動きで、
 * プレミアの「上と下が一緒に小さくなる」感じにならない。
 *
 * 残すのは**映像と音声の境目**。ここが編集で一番見ている線なので、
 * これを枠の真ん中に置いておけば、縮めたぶんは上（映像の上の段）と
 * 下（音声の下の段）から均等に減る。広げれば均等に戻る。
 *
 * @param boundary 中身の上端から数えた、映像と音声の境目の位置(px)
 * @param viewH    いま見えている高さ(px)
 * @param max      送れる限界（scrollHeight - clientHeight）
 */
export function centeredScrollTop(boundary: number, viewH: number, max: number): number {
  if (!(max > 0)) return 0 // 全部入っているなら送る必要がない
  const want = boundary - viewH / 2
  if (!Number.isFinite(want)) return 0
  return Math.round(Math.min(Math.max(want, 0), max))
}
