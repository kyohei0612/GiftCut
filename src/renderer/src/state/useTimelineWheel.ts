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
// ## 拡大はカーソルの下を動かさない
//
// 単に倍率だけ変えると、いま見ている場所が画面の外へ飛んでいく。
// カーソルの下にある時刻を先に控えておき、倍率を変えた後にそこへ戻す。
import { useEffect } from 'react'
import { clamp } from '../../../shared/timeline'
// 引ける下限。**拡大バーと同じ所から取る**——別々に持つと、
// 「バーでは引けるのにホイールでは引けない」という食い違いになる
//（shared/zoomBar の冒頭が、まさにその型を警告している）
import { minZoom } from '../../../shared/zoomBar'

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

export function useTimelineWheel(deps: UseTimelineWheelDeps) {
  const { scrollRef, zoomRef, setZoom, ZOOM_MIN, ZOOM_MAX, contentEndRef } = deps
  const { playing, currentTime, zoom } = deps

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.altKey) {
        e.preventDefault()
        const rect = el.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const timeAt = (el.scrollLeft + mx) / zoomRef.current
        // **目一杯引いたら全体が見える**（下限は shared/zoomBar が決める）。
        // 拡大バーの端と同じ所へ行き着かせる
        const lo = minZoom(el.clientWidth, contentEndRef.current, ZOOM_MIN)
        const nz = clamp(zoomRef.current * (e.deltaY < 0 ? 1.15 : 0.87), lo, ZOOM_MAX)
        setZoom(nz)
        requestAnimationFrame(() => {
          el.scrollLeft = Math.max(0, timeAt * nz - mx)
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
