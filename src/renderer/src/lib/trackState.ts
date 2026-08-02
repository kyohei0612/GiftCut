// 段（トラック）の初期状態。
//
// 鍵・非表示・ミュート・ソロ・音量。**新しく段を足したときも同じ既定**にする
// （足した段だけ音が出ない、のような食い違いを作らない）。

import type { Track, TrackState } from './projectTypes'

/**
 * 起動時の段（映像は先頭に続けて、音声はその後に続けて並べる）。
 *
 * **名前は番号だけにする。** 以前は「V2 テロップ」「A1 音声」「A2 SE」のように
 * 注釈が付いていたが、足した段（V4・A4…）には付かないので、**同じ見出しの列に
 * 2通りの書き方が混ざる**。何が置ける段かは、置いてみれば分かる（置けない所には
 * 落ちない）ので、注釈で説明する必要はない。
 */
export const DEFAULT_TRACKS: Track[] = [
  { id: 'V3', name: 'V3', kind: 'video' }, // テロップ上段（V2から上下移動できる先）
  { id: 'V2', name: 'V2', kind: 'video' },
  { id: 'V1', name: 'V1', kind: 'video' },
  { id: 'A1', name: 'A1', kind: 'audio' },
  { id: 'A2', name: 'A2', kind: 'audio' },
  { id: 'A3', name: 'A3', kind: 'audio' } // 追加音声トラック（BGM等）
]

/**
 * 前の既定に付いていた注釈。**保存済みのプロジェクトから外すために覚えておく。**
 *
 * 名前は1つずつプロジェクトに保存されるので、既定を変えても**開き直した人の
 * 画面は前のまま**になる。ここに載っている物だけを番号へ戻す＝
 * 自分で付け替えた名前には触らない。
 */
const OLD_DEFAULT_NAMES: Record<string, string> = {
  V1: 'V1 動画',
  V2: 'V2 テロップ',
  A1: 'A1 音声',
  A2: 'A2 SE'
}

/** 前の既定の注釈が付いていたら番号だけに戻す（自分で付けた名前はそのまま） */
export function normalizeTrackName(id: string, name: string): string {
  return OLD_DEFAULT_NAMES[id] === name ? id : name
}
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
