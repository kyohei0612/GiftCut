// タイムラインに載っている物そのもの（テロップ・切片・効果音・画像・映像・目印）。
//
// ## なぜまとめるか
//
// **区画はどれも「中身」を見て描く。** 左パネルは選んでいる物の設定を出し、
// タイムラインは全部を並べ、プレビューはいま時刻の物を重ねる。
// 中身が App.tsx の中にあるままだと、区画を切り出すたびに
// 「配列6つ＋その setter＋採番」を渡すことになる。
//
// ## 採番（IdCounter）を一緒に置く理由
//
// **配列と採番は必ず一組。** 別々にすると、片方だけ復元されたときに
// 既に居る物と同じ番号が振られ、掴んだのに別の物が動く。
// 実際、読み込み側で id を振り直す作りにしてあるのはこの事故のため
//（src/renderer/src/lib/projectLoad.ts に記録がある）。

import { useRef, useState } from 'react'
import type { Cue } from '../lib/srt'
import type { ImgClip, Marker, SEClip, VClip, VSeg } from '../lib/projectTypes'

export interface Content {
  /** テロップ */
  cues: Cue[]
  setCues: React.Dispatch<React.SetStateAction<Cue[]>>
  /** 動画の切片（隙間なく並ぶ。カットするほど増える） */
  segments: VSeg[]
  setSegments: React.Dispatch<React.SetStateAction<VSeg[]>>
  segIdCounter: React.MutableRefObject<number>
  /** 効果音・BGM */
  seClips: SEClip[]
  setSeClips: React.Dispatch<React.SetStateAction<SEClip[]>>
  seIdCounter: React.MutableRefObject<number>
  /** 画像 */
  imgClips: ImgClip[]
  setImgClips: React.Dispatch<React.SetStateAction<ImgClip[]>>
  imgIdCounter: React.MutableRefObject<number>
  /** 別素材の映像クリップ（V2 以降に置く物） */
  vClips: VClip[]
  setVClips: React.Dispatch<React.SetStateAction<VClip[]>>
  vClipIdCounter: React.MutableRefObject<number>
  /** 目印 */
  markers: Marker[]
  setMarkers: React.Dispatch<React.SetStateAction<Marker[]>>
  markerIdCounter: React.MutableRefObject<number>
}

export function useContent(): Content {
  const [cues, setCues] = useState<Cue[]>([])
  const [segments, setSegments] = useState<VSeg[]>([])
  const segIdCounter = useRef(1)
  const [seClips, setSeClips] = useState<SEClip[]>([])
  const seIdCounter = useRef(1)
  const [imgClips, setImgClips] = useState<ImgClip[]>([])
  const imgIdCounter = useRef(1)
  const [vClips, setVClips] = useState<VClip[]>([])
  const vClipIdCounter = useRef(1)
  const [markers, setMarkers] = useState<Marker[]>([])
  const markerIdCounter = useRef(1)

  return {
    cues,
    setCues,
    segments,
    setSegments,
    segIdCounter,
    seClips,
    setSeClips,
    seIdCounter,
    imgClips,
    setImgClips,
    imgIdCounter,
    vClips,
    setVClips,
    vClipIdCounter,
    markers,
    setMarkers,
    markerIdCounter
  }
}
