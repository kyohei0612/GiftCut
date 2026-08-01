// 映像を映す <video> 要素の台帳。
//
// ## なぜ1本につき2つ持つか（A面/B面）
//
// カットは「同じファイルの別の場所へ飛ぶ」ことなので、1つの要素でやると
// 飛ぶたびに復号し直しの待ちが出る（実測 145〜235ms。コマ飛びの正体）。
// 片方を映している間に、もう片方を次のカットの頭へ送っておき、カットの瞬間に
// 表示を入れ替える＝待ちが再生の裏に隠れる。プレミアのプリロールと同じ考え方で、
// **プロキシでも原本でも効く**（復号の速さに頼らないため）。
//
// ## なぜ要素を作り直さないか
//
// ソースを切り替えるたびに `src` を差し替えると、要素は読み込みからやり直す＝
// 一瞬黒くなる。ソースごとに要素を常設し、**付け替えるのは「どれを映すか」だけ**。
import { useRef, useState } from 'react'

export function useVideoEls() {
  /** いま映している <video>。ソースを切り替えるとここが差し替わる（要素は捨てない） */
  const videoRef = useRef<HTMLVideoElement | null>(null)
  /** クロスディゾルブ用の2本目。同じ映像を重ねて溶かす */
  const videoBRef = useRef<HTMLVideoElement>(null)

  /** 鍵は `${ソースID}:${面}`。面は 0=A / 1=B */
  const videoElsRef = useRef<Map<string, HTMLVideoElement>>(new Map())
  const elKey = (srcId: number, half: 0 | 1): string => `${srcId}:${half}`

  /**
   * いまどちらの面を映しているか（ソースごと）。カットのたびに入れ替わる。
   *
   * state と ref の両方で持つのは、**読む人が2種類いる**ため。
   * 画面の描き直しには state が要り、掴んでいる最中や再生の途中で読むには
   * 「いまこの瞬間の値」が要る（state はクロージャに古い値が焼き付く）。
   */
  const [activeHalf, setActiveHalf] = useState<Record<number, 0 | 1>>({})
  const activeHalfRef = useRef<Record<number, 0 | 1>>({})
  activeHalfRef.current = activeHalf
  const halfOf = (srcId: number): 0 | 1 => activeHalfRef.current[srcId] ?? 0

  /** いま映している方の要素 */
  const elOf = (srcId: number): HTMLVideoElement | undefined =>
    videoElsRef.current.get(elKey(srcId, halfOf(srcId)))

  return { videoRef, videoBRef, videoElsRef, elKey, activeHalf, setActiveHalf, halfOf, elOf }
}
