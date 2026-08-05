// タイムラインの上でのホイールと、再生ヘッドの追いかけ。
//
// ## 素は横のまま
//
// これまでずっと横だったので、縦に送れるようになったからといって主を入れ替えると
// **今までの手が全部空振りする**。素=横／Shift=縦／Ctrl・Alt=拡大縮小。
//
// ※ブラウザは Shift＋ホイールを勝手に横（deltaX）へ振り替えることがあるので、
//   縦横どちらで来ても拾う。
//
// ## 拡大の軸は**再生ヘッド**（プレミアと同じ。2026-08-05 に変えた）
//
// 単に倍率だけ変えると、いま見ている場所が画面の外へ飛んでいく。何かを軸にして、
// 倍率を変えた後にそこへ戻す必要がある。**その軸を再生ヘッドにしてある。**
//
// 前はカーソルの下だった。**寄る先が毎回マウスの位置で変わる**ので、
// 「寄ってから編集する」流れだと、寄った直後に作業中の時刻が画面の端へ行く。
// 編集で軸になるのはいつも再生ヘッド。
//
// 計算は `shared/zoomBar` の `scrollForZoomAtPlayhead`（画面が無くても確かめられる）。
// ヘッドが画面の外に居るときは真ん中へ連れてくる——理由はあちらに書いてある。
import { useEffect } from 'react'
import { clamp } from '../../../shared/timeline'
// 引ける下限。**拡大バーと同じ所から取る**——別々に持つと、
// 「バーでは引けるのにホイールでは引けない」という食い違いになる
//（shared/zoomBar の冒頭が、まさにその型を警告している）
import { minZoom, scrollForZoomAtPlayhead } from '../../../shared/zoomBar'
import { ZOOM_MAX, ZOOM_MIN } from './useView'
import { usePlaybackCtx } from './playbackContext'
import { useTimelineBoxCtx } from './timelineBoxContext'
import { useTimelineSpanCtx } from './timelineSpanContext'
import { useViewCtx } from './viewContext'

export interface UseTimelineWheelDeps {
  scrollRef: { current: HTMLDivElement | null }
  /** 「いまこの瞬間」の倍率（ホイールは連続で飛んでくるので state だと追えない） */
  zoomRef: { current: number }
  setZoom: (v: number) => void
  ZOOM_MIN: number
  ZOOM_MAX: number
  /** 中身の終わり（秒）。**目一杯引いたら全体が見える**ようにするのに要る */
  contentEndRef: { current: number }
  playing: boolean
  currentTime: number
  zoom: number
}

export function useTimelineWheel() {
  // **要る物は心臓から自分で取る**（2026-08-04。配線はただの素通しだった）。
  // 上限・下限は state/useView の定数なので、ここで直に import する
  const { scrollRef } = useTimelineBoxCtx()
  const { zoom, setZoom, zoomRef } = useViewCtx()
  const { contentEndRef } = useTimelineSpanCtx()
  // `currentTimeRef` は拡大の軸に使う。**state ではなく ref を取ること**
  //（下のホイールの効果は1回しか張らないので、state だと最初の値のまま止まる）
  const { playing, currentTime, currentTimeRef } = usePlaybackCtx()

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.altKey) {
        e.preventDefault()
        // **軸は再生ヘッド**（カーソルではない。上の説明を読むこと）。
        // **`currentTimeRef` を使う。** この効果は1回しか張らない（deps が空）ので、
        // `currentTime`（state）を読むと**最初の値のまま**になる
        const t = currentTimeRef.current
        const headX = t * zoomRef.current - el.scrollLeft
        // **目一杯引いたら全体が見える**（下限は shared/zoomBar が決める）。
        // 拡大バーの端と同じ所へ行き着かせる
        const lo = minZoom(el.clientWidth, contentEndRef.current, ZOOM_MIN)
        const nz = clamp(zoomRef.current * (e.deltaY < 0 ? 1.15 : 0.87), lo, ZOOM_MAX)
        setZoom(nz)
        requestAnimationFrame(() => {
          el.scrollLeft = scrollForZoomAtPlayhead(t, nz, headX, el.clientWidth)
        })
      } else if (e.shiftKey && (e.deltaY !== 0 || e.deltaX !== 0)) {
        e.preventDefault()
        el.scrollTop += e.deltaY !== 0 ? e.deltaY : e.deltaX
      } else if (e.deltaY !== 0) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 流している間は、再生ヘッドを画面の中に留める。
  // 端ぎりぎりで送ると次の瞬間また外れるので、少し手前（60px）へ送る。
  useEffect(() => {
    if (!playing) return
    const el = scrollRef.current
    if (!el) return
    const x = currentTime * zoom
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) {
      el.scrollLeft = x - 60
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, playing, zoom])
}
