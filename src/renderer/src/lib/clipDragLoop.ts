// クリップを掴んでいる間の**段取り**だけを持つ。何を書き換えるかは呼ぶ側。
//
// ## 押しただけの震えでは動かさない
//
// 3px 動いて初めて「掴んだ」とみなす。**縦の動きも見る**——横だけを見ていた頃は、
// 真上・真下へ振っても「まだ動いていない」と判定され、段を変える所まで一度も
// 進まなかった（＝置いた段から動かせない）。
//
// ## 端まで持っていったら景色を送る
//
// 送った分だけ**掴み始めの位置を戻す**。指は止まったままでも物は進むべきなので、
// 戻さないと送った瞬間にクリップが飛ぶ。速さの決め方は `shared/edgeScroll` に1つ。
//
// ## なぜ1か所に寄せたか（2026-08-04）
//
// `state/useClipDrag` の3か所（効果音・画像・映像レイヤー）に、**この段取りが
// まるごと3回**書かれていた。同じ場所に並べてあっても写しは写しで、
// 実際に「端の伸ばし方が2通り」「レザーの分け方が3通り」まで割れていた。
//
// ## 中身
//
// - `startClipDragLoop` … 掴んでから離すまでを1本の呼び出しにする
// - `handle` … その中で pointermove を受ける所（動き出しの判定と景色送り）
import { startEdgeScroll } from './edgeScroller'

export interface ClipDragLoopOpts {
  /** 掴んだときの pointerdown */
  e: React.PointerEvent
  /** 横に送る入れ物（端まで持っていったときに送る先） */
  scrollEl: HTMLDivElement | null
  /** 横の拡大率（px/秒）。掴んでいる最中にも読むので ref */
  zoomRef: React.MutableRefObject<number>
  /**
   * 動くたびに呼ぶ。`dt` は掴んだ時からのずれ（**秒**）。
   * 3px 動くまでは1度も呼ばれない。
   */
  onMove: (dt: number, ev: PointerEvent) => void
  /** 離したとき（片付けはここで。listener の解除は済ませてある） */
  onEnd: () => void
}

/** 掴んでから離すまで。**動き出しの判定・景色送り・後片付けをまとめて持つ** */
export function startClipDragLoop(o: ClipDragLoopOpts): void {
  const { e, scrollEl, zoomRef, onMove, onEnd } = o
  // 掴み始めは動かせるようにしておく（景色が送られたら、そのぶん戻す）
  let sx = e.clientX
  const sy = e.clientY
  let moved = false
  let lastEv: PointerEvent | null = null
  const es = startEdgeScroll(scrollEl, (dv) => {
    sx -= dv
    if (lastEv) handle(lastEv)
  })
  function handle(ev: PointerEvent): void {
    lastEv = ev
    es.track(ev.clientX)
    // **縦も見る。** 横だけだと真上・真下へ振っても動き出さない
    if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 3) return
    moved = true
    onMove((ev.clientX - sx) / zoomRef.current, ev)
  }
  const onUp = (): void => {
    es.stop()
    window.removeEventListener('pointermove', handle)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    onEnd()
  }
  window.addEventListener('pointermove', handle)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}
