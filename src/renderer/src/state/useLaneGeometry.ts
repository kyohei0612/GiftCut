// 段（レーン）の縦位置と、掴んだ物の落とし先。
//
// ## なぜ独立させるか
//
// **「いま縦のどこを指しているか」は、掴む操作の付属品ではない。**
// 掴んで落とす所だけでなく、影を出す・段を選ぶ・当たり判定を取る、と
// 画面のあちこちから同じ問いが飛んでくる（数えたら9か所あった）。
// 掴む操作の中に埋めておくと、そこを触るたびに全員が巻き添えになる。
//
// ## 決まりそのものは shared/lanes にある
//
// ここは段の一覧と高さを当てはめるだけの包み。
// **外したときに本編（V1）へ落とさない**という決まりも向こう側にあり、
// 画面を起動せずに確かめられる（lanes.test.ts）。
//
// ## 上端の測り方
//
// 目盛りの高さ＋上の余白を足した所が、1段目の上端。
// ここを取り違えると、指した段と反応する段が1つずれる。

import {
  dropLaneAt as dropLaneIn,
  laneAtY as laneAtYIn,
  laneRows,
  type LaneRow
} from '../../../shared/lanes'
import { useTracksCtx } from './tracksContext'

export interface UseLaneGeometryDeps {
  /** 段の高さ。**掴んでいる最中にも読むので ref**（描き直しを待たない） */
  videoTrackHRef: React.MutableRefObject<number>
  audioTrackHRef: React.MutableRefObject<number>
  /** 1段目の上端まで（目盛りの高さ＋上の余白） */
  topOffset: number
}

export interface LaneGeometry {
  /** 各段の縦位置（trackInner の上端からの相対 px） */
  trackRows: () => LaneRow[]
  /** その高さにある段。無ければ null */
  laneAtY: (yRel: number) => string | null
  /** そこへ落とすならどの段か。**外したときに本編は返さない** */
  dropLaneAt: (yRel: number, kind: 'video' | 'audio', forVideoLayer?: boolean) => string | null
}

export function useLaneGeometry(deps: UseLaneGeometryDeps): LaneGeometry {
  const { videoTrackHRef, audioTrackHRef, topOffset } = deps
  const { tracks } = useTracksCtx()

  function trackRows(): LaneRow[] {
    return laneRows(tracks, videoTrackHRef.current, audioTrackHRef.current, topOffset)
  }
  function laneAtY(yRel: number): string | null {
    return laneAtYIn(trackRows(), yRel)
  }
  function dropLaneAt(
    yRel: number,
    kind: 'video' | 'audio',
    forVideoLayer = false
  ): string | null {
    return dropLaneIn(trackRows(), yRel, kind, forVideoLayer)
  }

  return { trackRows, laneAtY, dropLaneAt }
}
