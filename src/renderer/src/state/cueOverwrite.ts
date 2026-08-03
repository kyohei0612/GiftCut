// テロップの重なりを解決するときの**呼び方**を1か所に集める。
//
// ## 判定と組み立ては shared/overwrite にある
//
// ここが持っているのは、**React 側でしか決められない2つ**だけ:
//
//   1. **採番は setState の updater の外でやる**——中で `idCounter.current++` を
//      回すと、StrictMode の2回走りで番号が飛ぶ・ずれる
//   2. 複製は `structuredClone`（浅い写しだと、割れた片方を直すと元まで変わる）
//
// ## なぜ寄せたか（2026-08-03）
//
// 呼ぶ所が3か所になった:
//
//   落として重ねる     state/useTimelineDrag
//   端をつまんで伸ばす state/useTimelineDrag（08-03 に追加）
//   貼り付け           state/useCopyPaste（08-03 に追加）
//
// **貼り付けが通っていないのは、秘書エージェントの検証で見つかった。**
// ⑥（端を伸ばす）を直したときに視野へ入っていなかった——「同じ決まりを
// 3か所で書く」形になりかけたので、その前に1つへ寄せた。
//
// ## 呼ぶ側で違うのは「何に対して掛けるか」
//
//   掴む側   … `cuesRef.current`（既に setCues 済みの、いまこの瞬間の一覧）
//   貼り付け … **手元で組み立てた配列**（まだ setCues していない）
//
// どちらも「上書き済みの配列」が返るので、そのまま絶対値で入れる。
import { overwriteCues } from '../../../shared/overwrite'
import type { Cue } from '../lib/srt'

/**
 * 同じ段で重なった分を、勝つ側（`winnerIds`）で削り取る。
 *
 * @returns 上書きが起きたら新しい一覧。何も重なっていなければ `null`
 *          （`null` のときは setCues を呼ばない＝余計な描き直しと履歴を作らない）
 */
export function overwriteOverlapped(
  all: readonly Cue[],
  winnerIds: readonly number[],
  cueTrack: (c: Cue) => string,
  idCounter: React.MutableRefObject<number>
): Cue[] | null {
  return overwriteCues(
    all,
    winnerIds,
    cueTrack,
    () => idCounter.current++,
    (c) => structuredClone(c)
  )
}
