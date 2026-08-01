// 段（トラック）の高さ。
//
// ## 2段構えになっている理由
//
//   種類ごとの高さ … 映像はこれ、音声はこれ、という既定
//   段ごとの高さ   … 自分で掴んで変えた段だけ、個別に覚える
//
// **掴んだ段だけ太らせたい。** 以前は映像なら映像の段が全部、音声なら音声の段が
// 全部まとめて変わっていた。波形を見たいのは音声の1本だけ、ということの方が多く、
// 巻き添えで他まで太ると画面が足りなくなる。
//
// ## 既定で A1 だけ少し高いのは
//
// **波形が要るのは本編の音（A1）だけ。** 最小だと山が潰れて、どこで喋っているのかが
// 読めない（無音カットの当たりも付けられない）。かといって音声レーンを全部高くすると
// 段の合計が伸びて、タイムラインを縮めたときに縦へ溢れる。要る1本だけにしておく。

import { useEffect, useRef, useState } from 'react'

/** 段の高さの下限・上限（px） */
export const TRACK_H_MIN = 26
export const TRACK_H_MAX = 160
/** 本編の音だけ、波形が読める高さから始める */
export const DEFAULT_LANE_H: Record<string, number> = { A1: 44 }

// **ここは描き直しの最中に走るので、共通の loadLS を使えない。**
// あちらは画面側の定義で、読み込み順によっては「初期化前」になる
// （実際に起動テストがそれを捕まえた）。localStorage を直に読む。
function loadNum(key: string, def: number): number {
  try {
    const v = Number(localStorage.getItem(key))
    return v >= TRACK_H_MIN && v <= TRACK_H_MAX ? v : def
  } catch {
    return def
  }
}

/** 保存してある段ごとの高さを読む（範囲外は捨てる） */
export function loadLaneH(raw: string | null): Record<string, number> {
  try {
    const o = JSON.parse(raw ?? 'null')
    if (!o || typeof o !== 'object') return { ...DEFAULT_LANE_H }
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(o))
      if (typeof v === 'number' && v >= TRACK_H_MIN && v <= TRACK_H_MAX) out[k] = v
    return Object.keys(out).length ? out : { ...DEFAULT_LANE_H }
  } catch {
    return { ...DEFAULT_LANE_H }
  }
}

export interface LaneHeights {
  videoTrackH: number
  setVideoTrackH: React.Dispatch<React.SetStateAction<number>>
  audioTrackH: number
  setAudioTrackH: React.Dispatch<React.SetStateAction<number>>
  /** 掴んでいる最中に読む用（描き直しを待たない） */
  videoTrackHRef: React.MutableRefObject<number>
  audioTrackHRef: React.MutableRefObject<number>
  /** 自分で変えた段だけ入る。無い段は種類ごとの高さを使う */
  laneH: Record<string, number>
  setLaneH: React.Dispatch<React.SetStateAction<Record<string, number>>>
  laneHRef: React.MutableRefObject<Record<string, number>>
}

export function useLaneHeights(): LaneHeights {
  const [videoTrackH, setVideoTrackH] = useState<number>(() =>
    loadNum('gc.videoTrackH', TRACK_H_MIN)
  )
  const [audioTrackH, setAudioTrackH] = useState<number>(() =>
    loadNum('gc.audioTrackH', TRACK_H_MIN)
  )
  const videoTrackHRef = useRef(videoTrackH)
  const audioTrackHRef = useRef(audioTrackH)
  // **ここは描き直しの最中にも読まれる。** state と ref を1か所で面倒を見ないと、
  // 掴んでいる最中に片方だけ古いままになり、掴んだ段と動く段がずれる
  useEffect(() => {
    videoTrackHRef.current = videoTrackH
    try {
      localStorage.setItem('gc.videoTrackH', String(videoTrackH))
    } catch {
      /* 保存できなくてもその回は動く */
    }
  }, [videoTrackH])
  useEffect(() => {
    audioTrackHRef.current = audioTrackH
    try {
      localStorage.setItem('gc.audioTrackH', String(audioTrackH))
    } catch {
      /* 同上 */
    }
  }, [audioTrackH])

  const [laneH, setLaneH] = useState<Record<string, number>>(() => {
    try {
      return loadLaneH(localStorage.getItem('gc.laneH'))
    } catch {
      return { ...DEFAULT_LANE_H }
    }
  })
  const laneHRef = useRef(laneH)
  useEffect(() => {
    laneHRef.current = laneH
    try {
      localStorage.setItem('gc.laneH', JSON.stringify(laneH))
    } catch {
      /* 同上 */
    }
  }, [laneH])

  return {
    videoTrackH,
    setVideoTrackH,
    audioTrackH,
    setAudioTrackH,
    videoTrackHRef,
    audioTrackHRef,
    laneH,
    setLaneH,
    laneHRef
  }
}
