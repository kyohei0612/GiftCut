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
import { fitZoom, minZoom, scrollForZoomAtPlayhead } from '../../../shared/zoomBar'
// **下限は固定値ではない**（2026-08-06）。「全体がちょうど収まる率」なので
// 中身の長さで毎回変わる。だから ZOOM_MIN は使わない
import { ZOOM_MAX } from './useView'
import { usePlaybackCtx } from './playbackContext'
import { useViewCtx } from './viewContext'

export interface UseViewNavDeps {
  /** 横スクロールする枠 */
  scrollRef: React.RefObject<HTMLDivElement>
  /** 目盛りとクリップが乗っている中身（擦った位置を測るのに使う） */
  trackInnerRef: React.RefObject<HTMLDivElement>
  /** 中身の終わり（秒）。**「↔ 全体表示」の基準**（素材を見せる操作なので、こちら） */
  contentEndRef: React.MutableRefObject<number>
  /**
   * 画面に出す長さ（秒）。**引ける下限はこちらから出す。**
   *
   * `contentEnd` ではない——下限は「全体がちょうど収まる率」で、
   * その"全体"は**下の拡大バーが描く長さ**でなければ、
   * バーの端と倍率の限界が食い違う（2026-08-06）。
   */
  durationRef: React.MutableRefObject<number>
  seekTo: (t: number) => void
}

export interface ViewNav {
  /**
   * **再生ヘッドを軸にして**寄る／引く（`+1` で寄る、`-1` で引く）。
   *
   * キーボード（`=` / `-`）と拡大バーが、どちらもここを通る。
   * **ホイールだけは通らない**——あちらの軸はカーソルの下（`useTimelineWheel`）。
   */
  zoomAtPlayhead: (dir: 1 | -1) => void
  /** 中身がちょうど収まる拡大率に合わせる */
  fitTimelineZoom: () => void
  /** 目盛りを擦った位置へ飛ぶ */
  scrubFromClientX: (cx: number) => void
}

export function useViewNav(deps: UseViewNavDeps): ViewNav {
  const { scrollRef, trackInnerRef, contentEndRef, durationRef, seekTo } = deps
  const { setZoom, zoomRef } = useViewCtx()
  // 拡大の軸に使う再生ヘッドの時刻。**state ではなく ref**（掴んでいる最中も読む）
  const { currentTimeRef } = usePlaybackCtx()


  // 「連れてくる」（revealPlayhead）と「飛ばして見せる」（seekAndReveal）は
  // ここには無い。**飛ばす側と輪になっていた**ので、
  //   連れてくる … state/useTimelineBox（縦の追従と同じ持ち主。飛ばす側を要らない）
  //   飛ばして見せる … state/usePlaybackEngine（飛ばす本人）
  // へ移した。ここは飛ばす側を要るだけの片道になっている。

  /**
   * **再生ヘッドを軸にして寄る／引く。**
   *
   * ## 入口ごとに軸を変えてある（2026-08-05・本人の指定）
   *
   *   ホイール    カーソルの下（`state/useTimelineWheel`。狙った所へ寄れる）
   *   キーボード  ここ。**手がマウスに無いので、カーソルを軸にしても狙えない**
   *   拡大バー    ここ（バー全体を俯瞰していて、カーソルは「バーの上」に居る）
   *
   * 刻みはホイール1ノッチと同じ 1.15 倍。**別の数にしない**——
   * 同じ「1回寄る」なのに入口で幅が違うと、持ち替えるたびに勘が外れる。
   */
  function zoomAtPlayhead(dir: 1 | -1): void {
    const el = scrollRef.current
    if (!el) return
    const t = currentTimeRef.current
    const headX = t * zoomRef.current - el.scrollLeft
    // **下限は「全体がちょうど収まる率」。材料はバーが描く長さ**（`duration`）。
    // `contentEnd` で出すと、バーの端と倍率の限界が食い違う（2026-08-06）
    const lo = minZoom(el.clientWidth, durationRef.current)
    const nz = clamp(zoomRef.current * (dir > 0 ? 1.15 : 0.87), lo, ZOOM_MAX)
    setZoom(nz)
    requestAnimationFrame(() => {
      if (el) el.scrollLeft = scrollForZoomAtPlayhead(t, nz, headX, el.clientWidth)
    })
  }

  // タイムラインの拡大率を「中身がちょうど収まる」ところに合わせる。
  //
  // **式は shared/zoomBar の fitZoom に1つだけ。** 下限も同じ所から取る
  // ——2026-08-03 まで ZOOM_MIN（6px/秒）で頭打ちしていて、**長い素材では
  // ↔ を押しても全体が見えなかった**（451秒だと 2,706px 要る）。
  function fitTimelineZoom(): void {
    const vw = scrollRef.current?.clientWidth ?? 800
    // **「↔ 全体表示」が見せるのは「素材」。だから `contentEnd`。**
    //
    // 引ける下限（`duration` 基準）と混ぜないこと。あちらは
    //「これ以上引けない所」で、こちらは「素材がちょうど入る所」。
    // 素材が短いときは**こちらの方が寄っている**（60秒ぶんの空白まで
    // 見せても仕方がない）。一度ここも `duration` にして、
    // **短い素材で4倍ぶん引きすぎ、確認が3件赤くなった**（2026-08-06）。
    const end = Math.max(contentEndRef.current, 10)
    setZoom(clamp(fitZoom(vw, end), minZoom(vw, durationRef.current), ZOOM_MAX))
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

  return { zoomAtPlayhead, fitTimelineZoom, scrubFromClientX }
}
