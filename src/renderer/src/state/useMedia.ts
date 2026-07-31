// 素材（取り込んだファイル）と、いまプレビューに読み込んでいる元動画。
//
// ## 「素材ビン」と「元動画」は別の話
//
//   素材ビン（mediaItems） … 取り込んで並べてある物。まだ使っていなくてよい
//   元動画（sources）      … タイムラインが実際に使っている物
//
// 混ざりやすいが役目が違う。ビンから消しても、タイムラインが使っていれば
// 元動画は残す（消すと編集中の映像が消える）。
//
// ## videoSrc と videoPath を分けてある理由
//
//   videoSrc  … プレビューで再生している物。焼き直し（プロキシ）ができたら差し替わる
//   videoPath … 書き出しに使う原本。**こちらは絶対に差し替えない**
//
// 一緒にすると、焼き直した粗い映像で書き出してしまう。

import { useRef, useState } from 'react'
import type { Source } from '../lib/projectTypes'
import type { MediaItem } from '../components/panels/ProjectBinTab'

/** 音の波形（描くためだけの物。保存しない） */
export interface Waveform {
  min: number[]
  max: number[]
  dur: number
}

export interface Media {
  /** プレビューで再生している物（焼き直しができたら差し替わる） */
  videoSrc: string | null
  setVideoSrc: React.Dispatch<React.SetStateAction<string | null>>
  /** 書き出しに使う原本。**差し替えない** */
  videoPath: string | null
  setVideoPath: React.Dispatch<React.SetStateAction<string | null>>
  videoName: string | null
  setVideoName: React.Dispatch<React.SetStateAction<string | null>>
  videoDuration: number
  setVideoDuration: React.Dispatch<React.SetStateAction<number>>
  /** 焼き直しの進み具合（null＝やっていない／終わった） */
  proxyPct: number | null
  setProxyPct: React.Dispatch<React.SetStateAction<number | null>>
  waveform: Waveform | null
  setWaveform: React.Dispatch<React.SetStateAction<Waveform | null>>
  thumbnailSrc: string | null
  setThumbnailSrc: React.Dispatch<React.SetStateAction<string | null>>

  /** タイムラインが使っている元動画。[0] が主 */
  sources: Source[]
  setSources: React.Dispatch<React.SetStateAction<Source[]>>
  sourcesRef: React.MutableRefObject<Source[]>
  sourceIdCounter: React.MutableRefObject<number>
  /** いま <video> に読み込まれている元動画の id */
  curSourceIdRef: React.MutableRefObject<number | null>
  activeSrcId: number | null
  setActiveSrcId: React.Dispatch<React.SetStateAction<number | null>>

  /** 取り込んで並べてある素材（まだ使っていなくてよい） */
  mediaItems: MediaItem[]
  setMediaItems: React.Dispatch<React.SetStateAction<MediaItem[]>>
  mediaIdCounter: React.MutableRefObject<number>
}

export function useMedia(): Media {
  const [videoSrc, setVideoSrc] = useState<string | null>(null)
  const [videoPath, setVideoPath] = useState<string | null>(null)
  const [videoName, setVideoName] = useState<string | null>(null)
  const [videoDuration, setVideoDuration] = useState(0)
  const [proxyPct, setProxyPct] = useState<number | null>(null)
  const [waveform, setWaveform] = useState<Waveform | null>(null)
  const [thumbnailSrc, setThumbnailSrc] = useState<string | null>(null)

  const [sources, setSources] = useState<Source[]>([])
  const sourcesRef = useRef<Source[]>([])
  const sourceIdCounter = useRef(1)
  const curSourceIdRef = useRef<number | null>(null)
  const [activeSrcId, setActiveSrcId] = useState<number | null>(null)

  const [mediaItems, setMediaItems] = useState<MediaItem[]>([])
  const mediaIdCounter = useRef(1)

  return {
    videoSrc,
    setVideoSrc,
    videoPath,
    setVideoPath,
    videoName,
    setVideoName,
    videoDuration,
    setVideoDuration,
    proxyPct,
    setProxyPct,
    waveform,
    setWaveform,
    thumbnailSrc,
    setThumbnailSrc,
    sources,
    setSources,
    sourcesRef,
    sourceIdCounter,
    curSourceIdRef,
    activeSrcId,
    setActiveSrcId,
    mediaItems,
    setMediaItems,
    mediaIdCounter
  }
}
