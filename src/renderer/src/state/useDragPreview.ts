// 掴んでいる最中に出す物（影・吹き出し・吸い付きの線・囲い）。
//
// ## なぜまとめるか
//
// **どれも「離したら消える」物**で、消し忘れると画面に残り続ける。
// バラバラに置いていると、新しい掴み方を足すたびに「消す処理」を
// 書き足す場所が増え、必ずどれかを忘れる。
//
// ## 上書きの警告を出す理由
//
// 本編の上に落とすと、そこにあった物が**丸ごと消える**。
// 離す前に赤い縁で知らせないと、消えてから気づくことになる。

import { useRef, useState } from 'react'
import type { MediaItem } from '../components/panels/ProjectBinTab'
import type { SegDropMode } from '../../../shared/dragMode'

/** 効果音を置こうとしている所に出す影 */
export interface SeGhost {
  t: number
  name: string
  dur: number
  track: string
  path: string
}
/** 動画を置こうとしている所に出す影 */
export interface VideoGhost {
  t: number
  name: string
  dur: number
  insert: boolean
  path: string
  track: string
  /** すでにある物を掴んで動かしている（新しく置くのではない） */
  moving?: boolean
  mode?: SegDropMode
}
/** 画像を置こうとしている所に出す影 */
export interface ImgGhost {
  t: number
  name: string
  dur: number
  track: string
}
/** 範囲選択の囲い */
export interface Marquee {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface DragPreview {
  /**
   * いま掴んでいる素材と、その尺。**指を離した時に確定するので ref。**
   *
   * 配線から移した（2026-08-04）。上の影（`*Ghost`）はこの2つから作るのに、
   * **持ち主が別々**だった＝「離したら消える物」が2か所に散っていた。
   */
  draggingMediaRef: React.MutableRefObject<MediaItem | null>
  dragSeDurRef: React.MutableRefObject<number>
  seGhost: SeGhost | null
  setSeGhost: React.Dispatch<React.SetStateAction<SeGhost | null>>
  videoGhost: VideoGhost | null
  setVideoGhost: React.Dispatch<React.SetStateAction<VideoGhost | null>>
  imgGhost: ImgGhost | null
  setImgGhost: React.Dispatch<React.SetStateAction<ImgGhost | null>>
  /** 吸い付いた位置に出す縦線 */
  snapLineX: number | null
  setSnapLineX: React.Dispatch<React.SetStateAction<number | null>>
  /** 掴んでいる間に出す吹き出し（時刻や長さ） */
  dragTip: { x: number; y: number; text: string } | null
  setDragTip: React.Dispatch<React.SetStateAction<{ x: number; y: number; text: string } | null>>
  marquee: Marquee | null
  setMarquee: React.Dispatch<React.SetStateAction<Marquee | null>>
  /** このまま離すと丸ごと消える物（赤い縁で知らせる） */
  overwriteIds: number[]
  setOverwriteIds: React.Dispatch<React.SetStateAction<number[]>>
  /** 掴んでいる物を全部片付ける（離したときに必ず通す） */
  clearPreview: () => void
}

export function useDragPreview(): DragPreview {
  const draggingMediaRef = useRef<MediaItem | null>(null)
  /** 掴んでいる最中の効果音の尺（影の幅に使う。掴んだ時に測って入れる） */
  const dragSeDurRef = useRef(2)
  const [seGhost, setSeGhost] = useState<SeGhost | null>(null)
  const [videoGhost, setVideoGhost] = useState<VideoGhost | null>(null)
  const [imgGhost, setImgGhost] = useState<ImgGhost | null>(null)
  const [snapLineX, setSnapLineX] = useState<number | null>(null)
  const [dragTip, setDragTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const [overwriteIds, setOverwriteIds] = useState<number[]>([])

  return {
    draggingMediaRef,
    dragSeDurRef,
    seGhost,
    setSeGhost,
    videoGhost,
    setVideoGhost,
    imgGhost,
    setImgGhost,
    snapLineX,
    setSnapLineX,
    dragTip,
    setDragTip,
    marquee,
    setMarquee,
    overwriteIds,
    setOverwriteIds,
    // **1か所で全部消す。** 個別に消していると、新しい影を足したときに
    // 必ずどれかを消し忘れて、画面に残り続ける
    clearPreview: () => {
      setSeGhost(null)
      setVideoGhost(null)
      setImgGhost(null)
      setSnapLineX(null)
      setDragTip(null)
      setMarquee(null)
      setOverwriteIds([])
    }
  }
}
