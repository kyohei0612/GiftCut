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
  minZoom,
  panFromSpan,
  scrollForZoomAtPlayhead,
  zoomFromSpan
} from '../../../../shared/zoomBar'

export function ZoomBar({
  totalSec,
  zoom,
  playheadSecRef,
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
  /**
   * 再生ヘッドの時刻（秒）を入れてある箱。**寄せたときに画面から追い出さない**ために使う。
   *
   * **値ではなく ref で受ける。** 値で受けると、再生中は毎コマこの部品が
   * 描き直される（`TimelineArea` が `currentTime` を受け取らないのと同じ理由）。
   * 読むのは掴んで動かしている最中だけなので、ref で足りる。
   *
   * 軸にはしない——軸にすると掴んでいる●が指の下から逃げる（shared/zoomBar）
   */
  playheadSecRef: React.MutableRefObject<number>
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
    // **掴んだ瞬間の、再生ヘッドの画面位置**（px）。拡大の軸に使う。
    //
    // 動かしている最中に測り直さない。`zoom` はこの関数を作った時の値で固定
    // されているので、途中で測ると**古い拡大率で位置を出す**ことになり、
    // 軸が毎フレームずれる（＝バーが暴れる）。
    const headX0 = playheadSecRef.current * zoom - scroll.scrollLeft
    const at = (x: number): number => (x - rect.left) / Math.max(1, rect.width)
    const onMove = (ev: PointerEvent): void => {
      const w = scroll.clientWidth
      if (grab === 'move') {
        // つまみを丸ごと動かす。**拡大率は変えない**
        const d = (ev.clientX - sx) / Math.max(1, rect.width)
        onApply(zoom, panFromSpan(base.a + d, base, totalSec, zoom))
        return
      }
      // 端のボッチ。掴んでいない側はそのまま残す（shared/zoomBar が面倒をみる）
      //
      // **バーの外まで引ける**（2026-08-06・本人の指定）。
      //
      // ここは前まで 0〜1 に丸めていた。すると●を端まで持っていっても
      // 「全体がちょうど1画面」までしか行かず、**バーでは最大まで縮小できない**
      // ——Ctrl+ホイールは下限（`minZoom`）まで引けるので、
      // **同じ物を操る2つの入口で、行ける所が違う**状態だった。
      //
      // 丸めるのをやめると、端を越えたぶんは「1画面より広い範囲」になり、
      // 下の `zoomFromSpan` が下限で止めてくれる。つまみは端で止まって見えるが、
      // **指を外へ動かし続ければ引き続ける**——止まったのではなく、
      // つまみが表せる範囲を超えただけ（全部見えている状態は端から端までしか描けない）。
      const p = at(ev.clientX)
      const next = grab === 'l' ? { a: p, b: base.b } : { a: base.a, b: p }
      // **目一杯引いたら全体が見える**（プレミアと同じ）。下限は中身の長さで決まるので
      // ここで下げる。Ctrl+ホイールと「↔ 全体表示」も同じ shared/zoomBar を通る
      const lo = minZoom(w, totalSec, limits.min)
      const r = zoomFromSpan(next, totalSec, w, { min: lo, max: limits.max }, grab)
      // **軸は再生ヘッド**（2026-08-06・本人の指定で戻した）。
      //
      // ## 一度「追い出さないだけ」にして、戻した
      //
      // 08-05 は「●が指の下から逃げるから軸にしない」で、はみ出したときだけ
      // 送り返す形にしていた。**それが逆に読めない動きを作った**（本人の言葉:
      // 「拡大バーを触った瞬間だけ再生バーに追従するため、そこがぶつかって
      // 拡大バーがバグる」）——ほとんどの間は指に付いてくるのに、
      // **ヘッドが端に来た瞬間だけ**別の力で引っぱられる。
      // いつ起きるかが手前で読めないので、不具合に見える。
      //
      // 常に軸にすれば、動きは1つだけになる。●は指から離れるが、
      // **離れ方はいつも同じ**（ヘッドへ寄っていく）ので予測できる。
      // ホイールがカーソル軸なのは変えない——手がそこにあるので迷わない。
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
