// 本編の切片を「切る」「空きを作る」ときの作り方。
//
// ## 切り口に演出を残さない
//
// 切ると2つになるが、**頭側は尻に付いていた物を、尻側は頭に付いていた物を
// 落とす**。落とさないと、切り口の真ん中でフェードやつなぎ目の演出が始まって
// しまい、「切っただけなのに絵が溶ける」ことになる。
//
// 尻側は別のクリップになるので、番号を振り直す（同じ番号のまま2つあると、
// 選んだつもりの片方だけが動く／両方動く、という揺れが出る）。
import type { SegOps, SplitSeg } from '../../../shared/timeline'
import type { VSeg } from '../lib/projectTypes'

export interface UseSegOpsDeps {
  /** 切片の番号を配る所 */
  segIdCounter: { current: number }
}

export function useSegOps(deps: UseSegOpsDeps) {
  const { segIdCounter } = deps

  const segSplit: SplitSeg<VSeg> = (s, part, srcStart, srcEnd) =>
    part === 'head'
      ? { ...s, srcStart, srcEnd, transOut: undefined, xfade: undefined, afadeOut: undefined }
      : {
          ...s,
          id: segIdCounter.current++,
          srcStart,
          srcEnd,
          transIn: undefined,
          afadeIn: undefined
        }

  /** 空白の切片（映像なし・無音）。場所を指定して置いたときの、空いた所を埋める */
  const makeGapSeg = (len: number): VSeg => ({
    id: segIdCounter.current++,
    srcStart: 0,
    srcEnd: len,
    videoBlank: true,
    muted: true,
    gap: true
  })

  const segOps: SegOps<VSeg> = { split: segSplit, makeGap: makeGapSeg, isGap: (s) => !!s.gap }

  return { segSplit, makeGapSeg, segOps }
}

/** 拡張子から素材の種類を見分ける */
export function kindOf(p: string): 'video' | 'audio' | 'image' {
  const ext = p.toLowerCase().split('.').pop() ?? ''
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) return 'audio'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image'
  return 'video'
}
