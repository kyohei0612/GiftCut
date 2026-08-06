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
import { barSpan, minZoom, panFromSpan, zoomFromSpan } from '../../../../shared/zoomBar'

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
  onApply
}: {
  /** タイムライン全体の長さ（秒） */
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
  const span = barSpan(el?.scrollLeft ?? 0, viewW, totalSec, zoom)

  /** 掴んだ所から離すまでを面倒みる。`grab` は掴んだ物 */
  const start = (e: React.PointerEvent, grab: 'l' | 'r' | 'move'): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const bar = barRef.current
    const scroll = scrollRef.current
    if (!bar || !scroll) return
    const rect = bar.getBoundingClientRect()
    const base = barSpan(scroll.scrollLeft, scroll.clientWidth, totalSec, zoom)
    const sx = e.clientX
    const at = (x: number): number => (x - rect.left) / Math.max(1, rect.width)
    const onMove = (ev: PointerEvent): void => {
      const w = scroll.clientWidth
      if (grab === 'move') {
        // つまみを丸ごと動かす。**拡大率は変えない**
        const d = (ev.clientX - sx) / Math.max(1, rect.width)
        onApply(zoom, panFromSpan(base.a + d, base, totalSec, zoom))
        return
      }
      // 端のボッチ。**掴んだ端が指の所へ来る。反対の端は動かない**（プレミアと同じ）。
      //
      // ## 2026-08-06 に二度まわり道して、ここへ戻った
      //
      //   ① 再生ヘッドを軸にした   →「●が指から逃げる」
      //   ② 動いた距離を倍率の対数に →「加速してるみたいで気持ち悪い」
      //
      // 本人の言葉:「**基本マウスとぴったりがいい。バーの動きはプレミアプロみたく**」。
      //
      // 直接操作は、**指の下の物が指どおりに動く**ことが値打ちで、
      // それを崩すと「賢いが読めない」物になる。効きの強さや軸の親切さは、
      // どれも指との一致を削って買っている。**買わない。**
      //
      // 効きが場所で変わる（細いつまみほど過敏）のは、倍率が見えている秒数の
      // 逆数だから。それは**バーというUIの素の性質**で、直せば別物になる。
      // 一定の効きが欲しいときは Ctrl+ホイール（あちらは1段ずつ）。
      //
      // ## バーの外まで引ける
      //
      // 丸めていないので、端を越えたぶんは「1画面より広い範囲」になり、
      // 下限（`minZoom`）まで引き切れる。つまみは端で止まって見えるが、
      // **指を外へ動かし続ければ引き続ける**（全部見えている状態は端までしか描けない）。
      // 丸めていた頃は「全体がちょうど1画面」で止まり、
      // **ホイールでは引けるのにバーでは引けない**状態だった。
      const p = at(ev.clientX)
      const next = grab === 'l' ? { a: p, b: base.b } : { a: base.a, b: p }
      // **目一杯引いたら全体が見える**（プレミアと同じ）。下限は中身の長さで決まる。
      // Ctrl+ホイールと「↔ 全体表示」も同じ shared/zoomBar を通る
      const lo = minZoom(w, totalSec, limits.min)
      const r = zoomFromSpan(next, totalSec, w, { min: lo, max: limits.max }, grab)
      // **再生ヘッドは追いかけない。** 追いかけると指との一致が崩れる
      //（それが①のまわり道だった）。ヘッドへ寄せたいときはキーボードの拡大
      //（`state/useViewNav` が `scrollForZoomAtPlayhead` を使う）。
      onApply(r.zoom, r.scrollLeft)
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
