// パネルの節（アコーディオン）の開け閉めの決まり。
//
// **一番よく使う「★お気に入り」が、他を開くたびに畳まれていた。**
// テロップ・アイコンのタブは「1つだけ開く」作り（点数が多く、全部開けると
// 探せない）なので、別の節を押すたびにお気に入りが道連れで閉じる。
// 実際に使うのはお気に入りがほとんどなので、毎回開き直すことになっていた。
//
// 規則はここに1つだけ置く。画面の都合（どのタブか）は呼ぶ側が決める。

/** 他を開いても畳まれない節 */
export const KEEP_OPEN_SEC = 'fav'

/**
 * 節を押したあとの「開いている節」。
 *
 * @param cur   いま開いている節
 * @param k     押した節
 * @param multi 複数同時に開けるタブか（素材ビン・効果音）
 */
export function nextOpenSecs(cur: readonly string[], k: string, multi: boolean): string[] {
  // 開いている物を押したら閉じる。**自分で閉じるのは自由**（お気に入りも同じ）
  if (cur.includes(k)) return cur.filter((x) => x !== k)
  if (multi) return [...cur, k]
  // 1つだけ開くタブでも、お気に入りは道連れにしない
  if (k === KEEP_OPEN_SEC || !cur.includes(KEEP_OPEN_SEC)) return [k]
  return [KEEP_OPEN_SEC, k]
}
