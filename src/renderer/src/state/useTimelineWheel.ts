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
// ## 拡大の軸は**カーソルの下**（ホイールだけ。2026-08-05 に決めた）
//
// 単に倍率だけ変えると、いま見ている場所が画面の外へ飛んでいく。何かを軸にして、
// 倍率を変えた後にそこへ戻す必要がある。**ホイールの軸はカーソル。**
//
// **軸は入口ごとに変えてある**（本人の指定）:
//
//   ホイール    カーソルの下（狙った所へ寄れる。手がそこにあるので迷わない）
//   拡大バー    再生ヘッド
//   キーボード  再生ヘッド（手がマウスに無いので、カーソルを軸にしても狙えない）
//
// 一度ホイールも再生ヘッドにしたが**戻した**——タイムラインの遠くを狙って
// 寄る使い方ができなくなるため。ヘッド基準が要るのは「手がマウスから離れている」
// 入口（キーボード）と、「バー全体を俯瞰している」入口（拡大バー）。
import { useEffect } from 'react'
import { clamp } from '../../../shared/timeline'
// 引ける下限。**拡大バーと同じ所から取る**——別々に持つと、
// 「バーでは引けるのにホイールでは引けない」という食い違いになる
//（shared/zoomBar の冒頭が、まさにその型を警告している）
import { minZoom } from '../../../shared/zoomBar'
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
  const { durationRef } = useTimelineSpanCtx()
  const { playing, currentTime } = usePlaybackCtx()

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.altKey) {
        e.preventDefault()
        // **軸はカーソルの下**（上の説明を読むこと）。押した所の時刻を控えて、
        // 倍率を変えたあと同じ画面位置へ戻す
        const rect = el.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const timeAt = (el.scrollLeft + mx) / zoomRef.current
        // **目一杯引いたら全体が見える**（下限は shared/zoomBar が決める）。
        // 拡大バーの端と同じ所へ行き着かせる
        // **材料はバーが描く長さ**（`duration`）。前は `contentEnd` で出していたので
        // 入口ごとに限界が違い、掴んだ瞬間に倍率が飛んだ（2026-08-06）
        const lo = minZoom(el.clientWidth, durationRef.current, ZOOM_MIN)
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
      } else if (e.deltaX !== 0) {
        // **横そのもの（トラックパッドの横スワイプ・横チルト）**（2026-08-07）。
        //
        // ここは前は**書く必要が無かった**——`.track-scroll` が `overflow-x: auto`
        // で、横の送りはブラウザがやっていた。08-06 に横のスクロールバーを隠すため
        // `overflow: hidden auto` にした日から、**ブラウザの分だけが黙って死んだ。**
        //
        // CSS には「横へ送る手は減らない（拡大バー／ホイール／Shift+ホイール。
        // どれも scrollLeft を直に書くので隠しても効く）」と書いてあるが、
        // **数え漏れていた**。横スワイプだけはこちらが書いていなかった。
        // 隠した物の裏で動いていた既定は、隠すと一緒に消える。
        e.preventDefault()
        el.scrollLeft += e.deltaX
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
