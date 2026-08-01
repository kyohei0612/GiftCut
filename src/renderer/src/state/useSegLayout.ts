// 本編（V1）の切片を、時間軸の上に並べた結果。
//
// ## なぜ「いまこの瞬間」用の写しを持つか
//
// 並びは掴んでいる最中・再生中にも読まれる。React の値をそのまま読むと、
// **掴み始めた時点の並びが焼き付いたまま**になり、途中で切ったり詰めたりした
// 結果が反映されない。読む人が2種類いるので、器も2つ要る。
import { useEffect, useMemo, useRef } from 'react'
import { layoutSegs, totalSegLen } from '../../../shared/timeline'
import type { SegLayout, VSeg } from '../lib/projectTypes'

export function useSegLayout(segments: VSeg[]) {
  /** 切片を時間軸へ並べた結果（どこからどこまでが何番目か） */
  const segLayout = useMemo(() => layoutSegs(segments), [segments])
  /** 本編ぜんたいの長さ */
  const videoTLen = useMemo(() => totalSegLen(segments), [segments])

  const segLayoutRef = useRef<SegLayout[]>([])
  useEffect(() => {
    segLayoutRef.current = segLayout
  }, [segLayout])

  const videoTLenRef = useRef(0)
  useEffect(() => {
    videoTLenRef.current = videoTLen
  }, [videoTLen])

  return { segLayout, videoTLen, segLayoutRef, videoTLenRef }
}
