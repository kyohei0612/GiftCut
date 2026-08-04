// 本編に載っている物の**時刻を付け替える**土台。詰める側の心臓。
//
// ## 5種類まとめてしか触らない
//
// 相手はテロップ・効果音・画像・映像レイヤー・目印の5種類。
// **1種類でも掛け忘れると、そこだけ置き去りになる**（音や文字だけ元の位置に残る）。
// 編集中は気づきにくく、書き出してから分かるので1か所にまとめてある。
// 種類が増えたときも、ここへ足せば全員に行き渡る。
//
// ## 渡すのは「時刻 → 時刻」の関数だけ
//
// 詰める・ずらす・複数区間を畳む、どれもこの形で書ける。
// 何を捨てるかを決めるのは呼ぶ側で、ここは**当てるだけ**。
//
// ## なぜ state/useTimelineEdit から出したか（2026-08-04）
//
// あちらは「`mapContentTimes` が群をまたいで使われているので、どこで切っても
// 導管になる」と書いて割るのをやめていた。**逆だった**——またぐなら
// **それこそが土台**で、先にここを出せば残りが素直に分かれる。
//
// 測ったら **受け取る1（`collapseAt` の import だけ）・返す0**。
// 出したあと「本編の切片」の返すも 1 → 0 になった（測り方は `引き継ぎ-心臓の分け直し.md`）。
import { collapseAt } from '../../../shared/ripple'
import { useDoc } from './contentContext'
import type { VClip } from '../lib/projectTypes'

export interface UseContentShiftDeps {
  /** 重ねた動画の長さ。**正典は shared/timeline の vcLen** */
  vcLen: (c: VClip) => number
}

export function useContentShift(deps: UseContentShiftDeps) {
  const { vcLen } = deps
  const {
    setCues, cuesRef, setSeClips, seClipsRef, setImgClips, imgClipsRef,
    setVClips, vClipsRef, setMarkers
  } = useDoc()

  /** 本編に載っている物の端の時刻を全部集める（どこで止めるかの判断に使う） */
  function allContentEdges(): number[] {
    const out: number[] = []
    for (const c of cuesRef.current) out.push(c.start, c.end)
    for (const c of seClipsRef.current) out.push(c.tStart, c.tStart + c.duration)
    for (const c of imgClipsRef.current) out.push(c.tStart, c.tStart + c.duration)
    for (const c of vClipsRef.current) out.push(c.tStart, c.tStart + vcLen(c))
    return out
  }

  /**
   * 本編に載っている物の時刻を、**5種類まとめて**同じ規則で付け替える。
   *
   * **端は別々に付け替える。** テロップの片端だけが対象区間にかかることが
   * あり、まとめて動かすと残すべき尻まで消える。潰れて長さが0になった物は
   * ここで落とす。
   *
   * **動かない物は同じ物のまま返す。** 作り直すと、変わっていない段まで
   * 描き直しになる。
   */
  function mapContentTimes(at: (t: number) => number): void {
    const atStart = <T extends { tStart: number }>(x: T): T => {
      const t = at(x.tStart)
      return t === x.tStart ? x : { ...x, tStart: t }
    }
    setCues((prev) =>
      prev
        .map((c) => ({ ...c, start: at(c.start), end: at(c.end) }))
        .filter((c) => c.end - c.start > 0.05)
    )
    setSeClips((prev) => prev.map(atStart))
    setImgClips((prev) => prev.map(atStart))
    // 映像レイヤーも動かす（本編とズレると位置リンクが崩れる）
    setVClips((prev) => prev.map(atStart))
    setMarkers((prev) =>
      prev.map((m) => {
        const t = at(m.t)
        return t === m.t ? m : { ...m, t }
      })
    )
  }

  /** 区間 [rmStart, rmEnd] を捨てて、後ろを詰める */
  function collapseContent(rmStart: number, rmEnd: number, removeLen: number): void {
    mapContentTimes((t) => collapseAt(t, rmStart, rmEnd, removeLen))
  }

  return { allContentEdges, mapContentTimes, collapseContent }
}
