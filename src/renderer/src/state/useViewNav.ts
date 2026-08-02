// タイムラインの「どこを見ているか」を動かす。寄る・引く・見えている所へ連れてくる。
//
// ## 共通の考え方：**いま見ている場所を見失わせない**
//
// 素で拡大率だけ変えると左端(0秒)を軸に伸び縮みするので、寄るほど再生ヘッドが
// 右へ吹き飛ぶ。飛ばしても枠の外なら見えないままで、再生し始めてやっと画面が追いつく。
// どちらも「探し直し」が要るので、動かすときは必ず軸か行き先を決める。
//
// ## ただし、見えている物は動かさない
//
// すでに枠の中にいるなら何もしない。押すたびに画面が揺れて逆に読みにくい。

import { clamp } from '../../../shared/timeline'
import { ZOOM_MAX, ZOOM_MIN } from './useView'
import { usePlaybackCtx } from './playbackContext'
import { useViewCtx } from './viewContext'

export interface UseViewNavDeps {
  /** 横スクロールする枠 */
  scrollRef: React.RefObject<HTMLDivElement>
  /** 目盛りとクリップが乗っている中身（擦った位置を測るのに使う） */
  trackInnerRef: React.RefObject<HTMLDivElement>
  /** 中身の終わり（秒）。フィットの基準。掴んでいる最中も読むので ref */
  contentEndRef: React.MutableRefObject<number>
  seekTo: (t: number) => void
}

export interface ViewNav {
  /** 再生ヘッドを軸にして寄る／引く */
  zoomAroundPlayhead: (nz: number) => void
  /** 中身がちょうど収まる拡大率に合わせる */
  fitTimelineZoom: () => void
  /** 目盛りを擦った位置へ飛ぶ */
  scrubFromClientX: (cx: number) => void
}

export function useViewNav(deps: UseViewNavDeps): ViewNav {
  const { scrollRef, trackInnerRef, contentEndRef, seekTo } = deps
  const { currentTimeRef } = usePlaybackCtx()
  const { setZoom, zoomRef } = useViewCtx()

  /**
   * 拡大率を変える。**再生ヘッドが画面から逃げないように**、
   * 再生ヘッドのある所を軸にして寄る／引く。
   *
   * 素で拡大率だけ変えると、左端(0秒)を軸に伸び縮みするので、
   * 拡大するほど再生ヘッドが右へ吹き飛んでいく。**いま見ている場所を見失う**ので、
   * 拡大のたびに横スクロールで探し直すことになっていた。
   *
   * 再生ヘッドが枠の外にいるときは真ん中へ連れてくる
   * （見えていない物を軸にしても、結局どこへ飛ぶか分からない）。
   */
  function zoomAroundPlayhead(nz: number): void {
    const el = scrollRef.current
    const z0 = zoomRef.current
    const t = currentTimeRef.current
    if (!el || !(z0 > 0)) {
      setZoom(nz)
      return
    }
    const w = el.clientWidth
    let px = t * z0 - el.scrollLeft // 枠の左端から再生ヘッドまで(px)
    if (px < 0 || px > w) px = w / 2
    setZoom(nz)
    // 幅が新しい拡大率で決まってから寄せる（先に動かすと切り詰められる）
    requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, t * nz - px)
    })
  }

  // 「連れてくる」（revealPlayhead）と「飛ばして見せる」（seekAndReveal）は
  // ここには無い。**飛ばす側と輪になっていた**ので、
  //   連れてくる … state/useTimelineBox（縦の追従と同じ持ち主。飛ばす側を要らない）
  //   飛ばして見せる … state/usePlaybackEngine（飛ばす本人）
  // へ移した。ここは飛ばす側を要るだけの片道になっている。

  // タイムラインの拡大率を「中身がちょうど収まる」ところに合わせる。
  function fitTimelineZoom(): void {
    const vw = scrollRef.current?.clientWidth ?? 800
    const end = Math.max(contentEndRef.current, 10)
    setZoom(clamp((vw - 40) / end, ZOOM_MIN, ZOOM_MAX))
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollLeft = 0
    })
  }

  // スクラブ（ルーラー・再生ヘッドのみ。プレミア準拠でスクラブ開始時に再生停止）
  function scrubFromClientX(cx: number): void {
    const el = trackInnerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    seekTo((cx - rect.left) / zoomRef.current)
  }

  return { zoomAroundPlayhead, fitTimelineZoom, scrubFromClientX }
}
