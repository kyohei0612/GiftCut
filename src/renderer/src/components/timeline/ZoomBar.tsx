// タイムラインの下の「拡大バー」。**掴む所で意味が変わる**（プレミアと同じ形）。
//
//   真ん中を掴む … 見ている所を左右へ動かす
//   端のボッチ   … その端だけ動く＝見える範囲が伸び縮みする（＝拡大・縮小）
//
// 前は「拡大のつまみ」と「横スクロール」が別々にあり、
// 「どこを見ているか」と「どれだけ寄っているか」を2か所で操っていた。
//
// **割合と拡大率の行き来は shared/zoomBar**（画面を起動せずに確かめられる）。
// こちらの仕事は、掴んだ場所を読んでそこへ渡すところまで。

import { useEffect, useRef, useState, type JSX } from 'react'
import {
  barSpan,
  barTotalSec,
  minZoom,
  panFromSpan,
  scrollForZoomAtPlayhead,
  viewSpan,
  zoomFromSpan
} from '../../../../shared/zoomBar'

// ## 効きの強さは、いじらないと決めた（2026-08-06）
//
// 「細いつまみでは過敏、太いつまみでは鈍い」のは本当で、本人からも
// 「小さいバーの時めっちゃ感度いいけど、大きくなると弱い」と出た。
// 原因は倍率が**見えている秒数の逆数**だから——バーというUIの素の性質。
//
// 一律3倍にする／動いた距離を倍率の対数に効かせる、を順に試したが、
// **どちらも「指の下の物が指どおりに動く」を削って買っていた。**
// 結論:「基本マウスとぴったりがいい。バーの動きはプレミアプロみたく」。
//
// 一定の効きが欲しいときの道は別にある——Ctrl+ホイール（1段ずつ）と
// キーボードの拡大（再生ヘッド軸）。**入口ごとに性格を分ける**方で持つ。

export function ZoomBar({
  totalSec,
  zoom,
  limits,
  scrollRef,
  playheadSecRef,
  onApply
}: {
  /**
   * 再生ヘッドの時刻（秒）。**●で寄せ引きするときの軸**（2026-08-07・本人の指定）。
   *
   * 「プレミアみたいに、再生バーを基準にタイムラインが横に伸びてく感じ。
   * 　どこに再生バーがあっても。いまは左右端基準でしょ？」
   *
   * 値ではなく ref で受ける——再生中に毎コマ描き直さないため
   * （読むのは掴んで動かしている最中だけ）。
   */
  playheadSecRef: React.MutableRefObject<number>
  /**
   * タイムライン全体の長さ（秒）。**バーが描くのはこの範囲で、引ける下限もここから出す。**
   *
   * 別の長さ（物が置いてある終わり）で下限を出すと、バーの端と倍率の限界が
   * 食い違い、**引いたのにバーが動かない区間**ができる。Ctrl+ホイールも
   * キーボードも同じ長さを見る（2026-08-06）。
   */
  totalSec: number
  zoom: number
  limits: { min: number; max: number }
  /** 横に送る入れ物（いまどこを見ているかを読む・書く） */
  scrollRef: React.RefObject<HTMLDivElement | null>
  /** 決まった拡大率と見る位置を当てる */
  onApply: (zoom: number, scrollLeft: number) => void
}): JSX.Element {
  const barRef = useRef<HTMLDivElement>(null)
  // **横に送られただけでは描き直しが起きない。**
  // つまみの位置は「いまどこを見ているか」から出しているのに、
  // 拡大率が変わらない操作（掴んで動かす・ホイールで横へ送る）では
  // 何も再計算されず、**つまみだけ置いていかれる**。ここで自分で見張る。
  const [, tick] = useState(0)
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    const bump = (): void => tick((n) => n + 1)
    sc.addEventListener('scroll', bump, { passive: true })
    const ro = new ResizeObserver(bump)
    ro.observe(sc)
    return () => {
      sc.removeEventListener('scroll', bump)
      ro.disconnect()
    }
  }, [scrollRef])
  const el = scrollRef.current
  const viewW = el?.clientWidth ?? 0
  /**
   * **バーが描く範囲（秒）。タイムラインの長さではなく、引き切って見える秒数。**
   *
   * 本人の指定:「バーのマックス状態を、かなり引いたタイムラインの状態にしてほしい」。
   * 長さそのものを描くと、**全部見えた時点で満杯**になり、そこから先は
   * 引いてもつまみが動かない。引き切った所を満杯にすれば、その区間も動く。
   * 詳しくは shared/zoomBar の `barTotalSec`。
   */
  const barTotal = barTotalSec(viewW, totalSec, limits.min)
  const span = barSpan(el?.scrollLeft ?? 0, viewW, barTotal, zoom)

  /** 掴んだ所から離すまでを面倒みる。`grab` は掴んだ物 */
  const start = (e: React.PointerEvent, grab: 'l' | 'r' | 'move'): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const bar = barRef.current
    const scroll = scrollRef.current
    if (!bar || !scroll) return
    const rect = bar.getBoundingClientRect()
    // **掴む起点は丸めない方**（`viewSpan`）。描いてある位置から出し直すと、
    // 両端（全部見えている／寄り切っている）で**掴んだ瞬間に倍率が飛ぶ**。
    // 理由は shared/zoomBar の `viewSpan` に書いてある
    const base = viewSpan(scroll.scrollLeft, scroll.clientWidth, barTotal, zoom)
    const sx = e.clientX
    // **掴んだ瞬間の、再生ヘッドの画面位置**（px）。寄せ引きの軸に使う。
    // 動かしている最中に測り直さない——`zoom` はこの関数を作った時の値で
    // 固定なので、途中で測ると古い倍率で位置を出して軸が毎フレームずれる
    const headX0 = playheadSecRef.current * zoom - scroll.scrollLeft
    const at = (x: number): number => (x - rect.left) / Math.max(1, rect.width)
    const onMove = (ev: PointerEvent): void => {
      const w = scroll.clientWidth
      if (grab === 'move') {
        // つまみを丸ごと動かす。**拡大率は変えない**
        const d = (ev.clientX - sx) / Math.max(1, rect.width)
        onApply(zoom, panFromSpan(base.a + d, base, barTotal, zoom))
        return
      }
      // 端のボッチ。**動いた量で倍率を決め、軸は再生バー**（2026-08-07・本人の指定）。
      //
      // 「プレミアみたいに、再生バーを基準にタイムラインが横に伸びてく感じ。
      // 　どこに再生バーがあっても。いまは左右端基準でしょ？」
      //
      // 倍率は「掴んだ所からの動いた量」で出す（絶対位置で置き直さない——
      // 両端でつまみの座標が飽和しているので、置き直すと掴んだ瞬間に飛ぶ）。
      // 横位置は倍率から**再生バーの画面位置を留める**ように決める。
      // これで、どこに再生バーが居ても、その場を中心に伸び縮みする。
      //
      // ## バーの外まで引ける
      //
      // 動いた量に上限を置いていないので、端を越えても引き続けられる。
      //
      // **下限は `totalSec` から出す。ホイール・ナビと同じ引数で同じ関数を呼ぶ。**
      // 以前はここだけ `barTotal`（＝引き切って見える秒数）を渡していた。
      // あれは `viewW / 下限` なので、そこへもう一度 `fitZoom` を掛けると
      // **余白のぶんだけ下限がさらに下がる**＝バーの方が先へ行ける。
      // 床（6px/秒）が効いている間は差が出ず、**「全体が収まる率」が効く長さに
      // なった瞬間だけ食い違う**——2026-08-16 に末尾の空白5分を足して表に出た
      //（`16-仕上げ-3` の「バーで引き切ると、ホイールで引き切るのと同じ所まで行く」）。
      //
      // つまみの満杯と下限が一致する性質は保たれる: 下限まで引くと見えている秒数は
      // `w / 下限` で、`barTotal` はそれ以上にならない（`barTotalSec` の max）。
      const d = at(ev.clientX) - at(sx)
      const next = grab === 'l' ? { a: base.a + d, b: base.b } : { a: base.a, b: base.b + d }
      const lo = minZoom(w, totalSec, limits.min)
      const r = zoomFromSpan(next, barTotal, w, { min: lo, max: limits.max }, grab)
      onApply(r.zoom, scrollForZoomAtPlayhead(playheadSecRef.current, r.zoom, headX0, w))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <div className="zoom-bar" ref={barRef} title="掴んで移動／左右の●で拡大・縮小">
      <div
        className="zoom-bar-thumb"
        style={{ left: `${span.a * 100}%`, width: `${(span.b - span.a) * 100}%` }}
        onPointerDown={(e) => start(e, 'move')}
      >
        {/* ボッチ。**つまみが細くなっても掴めるように、外側へはみ出させる**
            （中に入れると、寄ったときに左右のボッチが重なって掴めない） */}
        <span className="zoom-bar-knob zbk-l" onPointerDown={(e) => start(e, 'l')} />
        <span className="zoom-bar-knob zbk-r" onPointerDown={(e) => start(e, 'r')} />
      </div>
    </div>
  )
}
