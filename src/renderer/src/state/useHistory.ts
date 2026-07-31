// 元に戻す・やり直すための控え。
//
// ## 何を控えるか
//
// タイムラインに載っている物と、段の構成・比率まで。
// **段を足して Ctrl+Z したのに、1つ前の別の操作が取り消される**、を防ぐため。
//
// 元動画（sources）は**控えない**。波形・焼き直し・尺は後から非同期で入る
// キャッシュなので、履歴に混ぜると Ctrl+Z で解析結果まで巻き戻って波形が消える。
//
// ## なぜ ref なのか
//
// 控えは「描くための物」ではないので、変わっても描き直す必要がない。
// state にすると、Ctrl+Z のたびに画面全体が2回描き直される。
// 代わりに、押せるかどうかの表示を更新するためだけの目印（tick）を1つ持つ。

import { useRef, useState } from 'react'
import type { Cue } from '../lib/srt'
import type { ImgClip, Marker, SEClip, Track, TrackState, VClip, VSeg } from '../lib/projectTypes'
import type { Ratio } from './useExportSettings'

/** ある時点の控え */
export interface Snap {
  cues: Cue[]
  segments: VSeg[]
  seClips: SEClip[]
  markers?: Marker[]
  imgClips?: ImgClip[]
  vClips?: VClip[]
  // トラック構成/状態・比率・元動画一覧も履歴に含める。
  // 含めないと「トラックを追加→Ctrl+Z」で1つ前の別操作が取り消されて驚く。
  tracks?: Track[]
  trackStates?: Record<string, TrackState>
  ratio?: Ratio
  // ※sources は履歴に含めない。波形/プロキシ/尺は非同期で後追いで入るキャッシュなので、
  //   履歴に混ぜると Undo で解析結果まで巻き戻って波形が消える。
  //   参照されなくなったソースは専用の GC effect で片付ける。
}

export interface History {
  undoStackRef: React.MutableRefObject<Snap[]>
  redoStackRef: React.MutableRefObject<Snap[]>
  /** 最後に確定した状態（ここからの差分を見て「変わった」と判断する） */
  baselineRef: React.MutableRefObject<Snap>
  /** 元に戻す・やり直す自身の書き換えを、履歴に積まないための札 */
  suppressHistoryRef: React.MutableRefObject<boolean>
  /** まとめて1回にするための待ち時間 */
  pendingTimerRef: React.MutableRefObject<number | null>
  /** 押せるかどうかの表示を更新するためだけの目印 */
  bumpHist: () => void
}

export function useHistory(): History {
  const undoStackRef = useRef<Snap[]>([])
  const redoStackRef = useRef<Snap[]>([])
  const baselineRef = useRef<Snap>({ cues: [], segments: [], seClips: [] })
  const suppressHistoryRef = useRef(false)
  const pendingTimerRef = useRef<number | null>(null)
  const [, setTick] = useState(0)
  return {
    undoStackRef,
    redoStackRef,
    baselineRef,
    suppressHistoryRef,
    pendingTimerRef,
    bumpHist: () => setTick((n) => n + 1)
  }
}
