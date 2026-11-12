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
//
// ## 消した物は「控え」に残す（2026-11-12）
//
// 元に戻す（state/useHistory）は、タイムラインの中身を戻す。ところが置き場から
// 素材を消すと、元動画の登録（sources）も置き場の札（mediaItems）もここから消える。
// 前は消えたきりだったので、戻しても**指す先の動画が無い切片**だけが帰ってきていた
// （本人「プロジェクトに入れた動画とかが、戻すで戻らない」）。
//
// → 一覧から外れた物を、外れた瞬間の中身（波形・尺・サムネ込み）で控えておく
//   （`sourceGraveRef` / `mediaGraveRef`）。戻すときはここから生き返らせる
//   （`state/useMainSource`）。**使うのは履歴だけ**。保存はしない。

import { useEffect, useRef, useState } from 'react'
import type { Source, VSeg } from '../lib/projectTypes'
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
  /**
   * 「いまこの瞬間」の元動画の尺。**指を離した時の処理が古い値を読まないように。**
   *
   * 配線が持っていたのを移した（2026-08-04）。ここを待っていたのが
   * `usePlaybackEngine` で、**その先で12本が詰まっていた**（`npm run passthrough`）。
   */
  videoDurationRef: React.MutableRefObject<number>
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
  /** 一覧から外れた元動画の控え（id → 外れた瞬間の中身）。元に戻すが生き返らせる */
  sourceGraveRef: React.MutableRefObject<Map<number, Source>>
  /** 「いまこの瞬間」の原本のパス（元に戻すが、主が入れ替わったかを見る） */
  videoPathRef: React.MutableRefObject<string | null>
  /**
   * 元動画を登録した時刻。掃除が「置く直前の物」を消す競合を防ぐ猶予に使う。
   *
   * 配線が持っていたのを移した（2026-08-04）。見るのは登録する側（`useMediaOps`）と
   * 掃除する側（`useVideoSync`）の**2つ**で、どちらも元動画の話。持ち主はここ。
   */
  srcAddedAtRef: React.MutableRefObject<Map<number, number>>
  sourceIdCounter: React.MutableRefObject<number>
  /** いま <video> に読み込まれている元動画の id */
  curSourceIdRef: React.MutableRefObject<number | null>
  activeSrcId: number | null
  setActiveSrcId: React.Dispatch<React.SetStateAction<number | null>>
  /**
   * その切片がどの元動画の物か（指していなければ主ソース）。
   *
   * **ここに置いてあるのは、読む人がとても多いから。**
   * 再生・プレビューの絵・書き出し・帯の描画——どれも「この切片の元は何か」を
   * 要る。素材を読み込む側（state/useMediaOps）に置いていた頃は、
   * 再生の心臓がそちらを要り、あちらは再生を止める物を要る、という輪になっていた。
   * 引くだけの物なので、心臓に置けば誰も他人を待たない。
   */
  srcOfSeg: (seg: VSeg | undefined) => Source | undefined

  /** 取り込んで並べてある素材（まだ使っていなくてよい） */
  mediaItems: MediaItem[]
  setMediaItems: React.Dispatch<React.SetStateAction<MediaItem[]>>
  /** 「いまこの瞬間」の置き場の並び（履歴が控えを取るときに読む） */
  mediaItemsRef: React.MutableRefObject<MediaItem[]>
  /** 置き場から外れた素材の控え（id → 外れた瞬間の中身）。元に戻すが生き返らせる */
  mediaGraveRef: React.MutableRefObject<Map<number, MediaItem>>
  mediaIdCounter: React.MutableRefObject<number>
}

export function useMedia(): Media {
  const [videoSrc, setVideoSrc] = useState<string | null>(null)
  const [videoPath, setVideoPath] = useState<string | null>(null)
  // 描くたびに写す。読むのは「元に戻す」の押した瞬間で、そのときには描き終わっている
  const videoPathRef = useRef<string | null>(null)
  videoPathRef.current = videoPath
  const [videoName, setVideoName] = useState<string | null>(null)
  const [videoDuration, setVideoDuration] = useState(0)
  const videoDurationRef = useRef(0)
  useEffect(() => {
    videoDurationRef.current = videoDuration
  }, [videoDuration])
  const [proxyPct, setProxyPct] = useState<number | null>(null)
  const [waveform, setWaveform] = useState<Waveform | null>(null)
  const [thumbnailSrc, setThumbnailSrc] = useState<string | null>(null)

  const [sources, setSourcesState] = useState<Source[]>([])
  const sourcesRef = useRef<Source[]>([])
  const srcAddedAtRef = useRef<Map<number, number>>(new Map())
  /**
   * 元動画の一覧を書き換える。**写し（sourcesRef）も同じ場で更新する。**
   *
   * 下の `srcOfSeg` が「**いまこの瞬間**の一覧を引く」と宣言しているとおり、
   * 写しはその場で読めなければ意味がない。ところが以前は `useAppWiring` の
   * effect で追随していて、**effect は次の描き直しまで走らない**——
   * 宣言と実体が食い違っていた。
   *
   * 実害: **素材をまとめて落とすと1本しか入らなかった。**
   * `placeVideoAtDrop` は「まだ1本も無いか」を写しで見て、無ければ
   * `loadVideo`（＝切片を全部捨てて番号を1へ戻す）を通る。束は同じ一拍で
   * 回るので、2本目もまだ空の写しを見て**1本目を捨てていた**（2026-08-03）。
   *
   * ※ 関数で渡された分も写しに当てる。中身は filter/map/spread だけなので
   *   2回呼ばれても副作用は無い（**updater の中で採番しないこと**）。
   */
  const setSources: React.Dispatch<React.SetStateAction<Source[]>> = (v) => {
    // ※ **この1行を消すと本当に赤くなることを確かめてある**（2026-08-03）。
    //   useMedia.test.ts の3件が落ちる（写しが空のまま＝ここが唯一の更新経路）。
    const prev = sourcesRef.current
    const next = typeof v === 'function' ? v(prev) : v
    // 外れた物を控える（冒頭「消した物は控えに残す」）。外れた瞬間の中身＝波形や尺が
    // 入った後の物なので、生き返らせたとき解析をやり直さなくて済む
    for (const s of prev) if (!next.some((n) => n.id === s.id)) sourceGraveRef.current.set(s.id, s)
    sourcesRef.current = next
    setSourcesState(v)
  }
  const sourceGraveRef = useRef<Map<number, Source>>(new Map())
  const sourceIdCounter = useRef(1)
  const curSourceIdRef = useRef<number | null>(null)
  const [activeSrcId, setActiveSrcId] = useState<number | null>(null)

  const [mediaItems, setMediaItems] = useState<MediaItem[]>([])
  const mediaIdCounter = useRef(1)
  // **元動画（setSources）と違って、書く側を包まない。** 置き場へ足す所は updater の
  // 中で採番している（`mediaIdCounter.current++`）ので、こちらで updater をもう一度
  // 呼ぶと番号が2つ進んで、写しと実物の id が食い違う。描くときに写す
  const mediaItemsRef = useRef<MediaItem[]>([])
  const mediaGraveRef = useRef<Map<number, MediaItem>>(new Map())
  if (mediaItemsRef.current !== mediaItems) {
    const now = new Set(mediaItems.map((m) => m.id))
    for (const m of mediaItemsRef.current) if (!now.has(m.id)) mediaGraveRef.current.set(m.id, m)
    mediaItemsRef.current = mediaItems
  }

  // 「いまこの瞬間」の一覧を引く。掴んでいる最中も読むので state ではなく写しを見る
  const srcOfSeg = (seg: VSeg | undefined): Source | undefined => {
    const list = sourcesRef.current
    if (!list.length) return undefined
    if (seg?.srcId == null) return list[0]
    return list.find((s) => s.id === seg.srcId) ?? list[0]
  }

  return {
    srcOfSeg,
    videoSrc,
    setVideoSrc,
    videoPath,
    setVideoPath,
    videoName,
    setVideoName,
    videoDuration,
    setVideoDuration,
    videoDurationRef,
    srcAddedAtRef,
    proxyPct,
    setProxyPct,
    waveform,
    setWaveform,
    thumbnailSrc,
    setThumbnailSrc,
    sources,
    setSources,
    sourcesRef,
    sourceGraveRef,
    videoPathRef,
    sourceIdCounter,
    curSourceIdRef,
    activeSrcId,
    setActiveSrcId,
    mediaItems,
    setMediaItems,
    mediaItemsRef,
    mediaGraveRef,
    mediaIdCounter
  }
}
