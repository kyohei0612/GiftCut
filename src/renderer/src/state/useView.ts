// タイムラインの見え方（横の拡大率）。
//
// ## なぜ ref も一緒に持つか
//
// **拡大率は「描くとき」と「掴んでいる最中」の両方から読む。**
// 掴んでいる最中は毎フレーム読むので、描き直しを待つ state ではなく
// ref から読む必要がある。2つを別々の場所に置くと、
// **片方だけ古いまま**になって「掴んだ位置と実際の位置がずれる」。
//
// ここでは state を変えたら ref も必ず追いつくように、1か所で面倒を見る。

import { useEffect, useRef, useState } from 'react'

/** 既定の拡大率（px / 秒） */
export const DEFAULT_ZOOM = 24

export interface View {
  zoom: number
  setZoom: React.Dispatch<React.SetStateAction<number>>
  /** 掴んでいる最中に読む用（描き直しを待たない） */
  zoomRef: React.MutableRefObject<number>
}

export function useView(): View {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const zoomRef = useRef(DEFAULT_ZOOM)
  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])
  return { zoom, setZoom, zoomRef }
}
