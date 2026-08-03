// 新しいテロップを、どの段に置くか。
//
// ## 決まり
//
// **再生ヘッドの所を頭にして作る。そこが埋まっていたら、空いている一番下の段へ。**
// 「埋まっている」は**これから作るテロップの長さと重なるか**で見る——
// 頭だけ重なる／尻だけ重なる、のどちらでも避ける（本人の指定）。
//
// 見る相手はテロップだけではない。**画像や重ねた動画とも重ならない所**を探す。
// 同じ段に画像が居ると、作った瞬間から文字が絵の裏に隠れる。
//
// ## 端が接しているだけは「重なっていない」
//
// 前のテロップの尻と、次の頭がぴったり同じ時刻なのは重なりではない。
// 重なりと見なすと、隙間なく並べたい時に段がどんどん上へ増える。
// （`shared/overwrite` の上書き判定と同じ決まりにしてある）

/** 段の上に載っている物（テロップ・画像・重ねた動画）の、時間の占め方 */
export interface LaneItem {
  track: string
  start: number
  end: number
}

/** 2つの区間が重なっているか。**端が接しているだけは重ならない** */
export function overlaps(aS: number, aE: number, bS: number, bE: number): boolean {
  return aS < bE && aE > bS
}

/**
 * 空いている段を、**下から順に**探す。
 *
 * @param lanes 置ける段（**下から上の順**で渡す。V2, V3, V4 …）
 * @param start これから作る物の頭
 * @param end   これから作る物の尻
 * @param items いま載っている物
 * @returns 空いている段。1つも無ければ null（呼ぶ側が段を足す）
 */
export function firstFreeLane(
  lanes: readonly string[],
  start: number,
  end: number,
  items: readonly LaneItem[]
): string | null {
  for (const lane of lanes) {
    const busy = items.some((it) => it.track === lane && overlaps(start, end, it.start, it.end))
    if (!busy) return lane
  }
  return null
}
