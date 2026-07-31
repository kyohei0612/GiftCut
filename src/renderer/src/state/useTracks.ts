// 段（トラック）と、その状態（鍵・非表示・ミュート・ソロ・音量）。
//
// ## なぜ心臓に入れるか
//
// **鍵（ロック）は、あらゆる編集の手前で見る。**
// 掴む・伸ばす・消す・貼る——どの操作も「その段に鍵が掛かっていないか」を
// 最初に確かめる。実測で、選んだ物を書き換える29個の操作のうち
// **9個がこれを見ていた**。段を各区画へ配って回ると、その9か所で
// 受け渡しが要ることになる。
//
// ## 鍵の判定をここに置く理由
//
// `trackStates[id]?.locked` を各所で書くと、**書き忘れた1か所だけ鍵が効かない**。
// 効かない所は「たまたま動いてしまう」ので、気づくのは壊してからになる。

import { useState } from 'react'
import type { Track, TrackState } from '../lib/projectTypes'

export interface Tracks {
  tracks: Track[]
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>
  trackStates: Record<string, TrackState>
  setTrackStates: React.Dispatch<React.SetStateAction<Record<string, TrackState>>>
  /** その段に鍵が掛かっているか（無い段は掛かっていない扱い） */
  isLocked: (id: string) => boolean
  toggleTrack: (id: string, key: keyof TrackState) => void
}

export function useTracks(
  defaultTracks: Track[],
  initStates: (t: Track[]) => Record<string, TrackState>
): Tracks {
  const [tracks, setTracks] = useState<Track[]>(defaultTracks)
  const [trackStates, setTrackStates] = useState<Record<string, TrackState>>(() =>
    initStates(defaultTracks)
  )
  return {
    tracks,
    setTracks,
    trackStates,
    setTrackStates,
    isLocked: (id) => !!trackStates[id]?.locked,
    toggleTrack: (id, key) =>
      setTrackStates((s) => ({ ...s, [id]: { ...s[id], [key]: !s[id][key] } }))
  }
}
