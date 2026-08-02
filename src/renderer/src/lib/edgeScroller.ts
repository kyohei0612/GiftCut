// 掴んでいる間、端に寄ったらタイムラインを送り続ける仕掛け。
//
// **速さの決め方は shared/edgeScroll**（画面を起動せずに確かめられる）。
// こちらの仕事は「毎コマ呼ぶ」「実際に送れた量を返す」の2つだけ。
//
// ## 送れた量を返すのが要点
//
// 掴んだ物は「掴み始めの指の位置からどれだけ動いたか」で場所を決めている。
// 指が止まったまま景色だけ動くと、**指は動いていないのに物は動くべき**なので、
// 掴み始めの位置の方を送った量だけずらしてやる必要がある。
// 端に着いて**もう送れないとき**にずらすと、物だけが滑っていく。
// だから「送ろうとした量」ではなく **実際に送れた量** を返す。

import { edgeScrollDelta } from '../../../shared/edgeScroll'

export interface EdgeScroller {
  /** pointermove のたびに、いまの指の位置を渡す */
  track: (clientX: number) => void
  /** 掴み終わったら必ず呼ぶ（呼ばないと送り続ける） */
  stop: () => void
}

/**
 * @param scroll   送る相手（タイムラインの横スクロールの入れ物）
 * @param onScroll 実際に送れた量（px）。掴み始めの位置をこのぶんずらす
 */
export function startEdgeScroll(
  scroll: HTMLElement | null,
  onScroll: (dv: number) => void
): EdgeScroller {
  let x: number | null = null
  let raf: number | null = null
  const tick = (): void => {
    raf = requestAnimationFrame(tick)
    if (!scroll || x == null) return
    const r = scroll.getBoundingClientRect()
    const want = edgeScrollDelta(x, r.left, r.right)
    if (want === 0) return
    const before = scroll.scrollLeft
    scroll.scrollLeft = before + want
    // 端に着いていれば 0。送れていないのに掴み始めをずらすと、物だけが滑っていく
    const moved = scroll.scrollLeft - before
    if (moved !== 0) onScroll(moved)
  }
  raf = requestAnimationFrame(tick)
  return {
    track: (clientX) => {
      x = clientX
    },
    stop: () => {
      if (raf != null) cancelAnimationFrame(raf)
      raf = null
    }
  }
}
