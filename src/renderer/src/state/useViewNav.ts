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
// 全体が収まる率と、引ける下限。**式はあちらに1つだけ**（フィット・拡大バー・
// Ctrl+ホイールの3か所が同じ所へ行き着くようにするため）
import { fitZoom, minZoom } from '../../../shared/zoomBar'
import { ZOOM_MAX, ZOOM_MIN } from './useView'
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
  /** 中身がちょうど収まる拡大率に合わせる */
  fitTimelineZoom: () => void
  /** 目盛りを擦った位置へ飛ぶ */
  scrubFromClientX: (cx: number) => void
}

export function useViewNav(deps: UseViewNavDeps): ViewNav {
  const { scrollRef, trackInnerRef, contentEndRef, seekTo } = deps
  const { setZoom, zoomRef } = useViewCtx()


  // 「連れてくる」（revealPlayhead）と「飛ばして見せる」（seekAndReveal）は
  // ここには無い。**飛ばす側と輪になっていた**ので、
  //   連れてくる … state/useTimelineBox（縦の追従と同じ持ち主。飛ばす側を要らない）
  //   飛ばして見せる … state/usePlaybackEngine（飛ばす本人）
  // へ移した。ここは飛ばす側を要るだけの片道になっている。

  // タイムラインの拡大率を「中身がちょうど収まる」ところに合わせる。
  //
  // **式は shared/zoomBar の fitZoom に1つだけ。** 下限も同じ所から取る
  // ——2026-08-03 まで ZOOM_MIN（6px/秒）で頭打ちしていて、**長い素材では
  // ↔ を押しても全体が見えなかった**（451秒だと 2,706px 要る）。
  function fitTimelineZoom(): void {
    const vw = scrollRef.current?.clientWidth ?? 800
    const end = Math.max(contentEndRef.current, 10)
    setZoom(clamp(fitZoom(vw, end), minZoom(vw, end, ZOOM_MIN), ZOOM_MAX))
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

  return { fitTimelineZoom, scrubFromClientX }
}
