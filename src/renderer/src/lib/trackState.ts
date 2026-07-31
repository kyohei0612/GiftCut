// 段（トラック）の初期状態。
//
// 鍵・非表示・ミュート・ソロ・音量。**新しく段を足したときも同じ既定**にする
// （足した段だけ音が出ない、のような食い違いを作らない）。

import type { Track, TrackState } from './projectTypes'

/** 起動時の段（映像は先頭に続けて、音声はその後に続けて並べる） */
export const DEFAULT_TRACKS: Track[] = [
  { id: 'V3', name: 'V3', kind: 'video' }, // テロップ上段（V2から上下移動できる先）
  { id: 'V2', name: 'V2 テロップ', kind: 'video' },
  { id: 'V1', name: 'V1 動画', kind: 'video' },
  { id: 'A1', name: 'A1 音声', kind: 'audio' },
  { id: 'A2', name: 'A2 SE', kind: 'audio' },
  { id: 'A3', name: 'A3', kind: 'audio' } // 追加音声トラック（BGM等）
]
/** 足せる音声の段 */
export const EXTRA_AUDIO_TRACK = 'A3'

export function newTrackState(id: string): TrackState {
  return {
    target: id === 'V1' || id === 'A1',
    hidden: false,
    muted: false,
    solo: false,
    locked: false,
    volume: 1
  }
}

export function initTrackStates(tracks: Track[]): Record<string, TrackState> {
  const s: Record<string, TrackState> = {}
  for (const t of tracks) s[t.id] = newTrackState(t.id)
  return s
}
