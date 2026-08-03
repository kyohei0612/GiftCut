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
import { useDoc } from './contentContext'
import { useTracksCtx } from './tracksContext'
import { usePlaybackCtx } from './playbackContext'
import { useSel } from './selectionContext'
import { useExportCtx } from './exportContext'
import type { Cue } from '../lib/srt'
import type { ImgClip, Marker, SEClip, Track, TrackState, VClip, VSeg } from '../lib/projectTypes'
import type { Ratio } from './useExportSettings'
import type { PreviewRes } from '../components/panels/PreviewBars'

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

export interface UseHistoryDeps {
  /** 位置が飛んだら、温めてあった面は当てにできない */
  preparedRef: React.MutableRefObject<{ segIdx: number; srcId: number; half: 0 | 1 } | null>
  previewResRef: React.MutableRefObject<PreviewRes>
  lastPaintRef: React.MutableRefObject<number>
  ratioRef: React.MutableRefObject<Ratio>
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
  /** 再生位置を入れ替える（飛んだら、温めてあった面は捨てる） */
  setTime: (t: number) => void
  /** 再生位置を進める（描き直しは秒60回で頭打ち） */
  paintTime: (t: number, force?: boolean) => void
  /** 最後に確定した控えから変わっているか */
  isDirty: () => boolean
  /** いまの中身を控えの形にする */
  snapNow: () => Snap
  pushUndo: (state: Snap) => void
  /** まだ確定していない変更を、その場で1つ積む */
  commitPending: () => void
  undo: () => void
  redo: () => void
  /** 履歴を捨てて、ここを起点にし直す（プロジェクトを開いたとき） */
  resetHistory: (base: Snap) => void
}

export function useHistory(deps: UseHistoryDeps): History {
  const { preparedRef, previewResRef, lastPaintRef, ratioRef } = deps
  const {
    cuesRef, segsRef, seClipsRef, markersRef, imgClipsRef, vClipsRef,
    setCues, setSegments, setSeClips, setMarkers, setImgClips, setVClips
  } = useDoc()
  const { tracksRef, trackStatesRef, setTracks, setTrackStates } = useTracksCtx()
  const { currentTimeRef, setCurrentTime } = usePlaybackCtx()
  const { setSelectedIds, setEditingId, clearSegSel } = useSel()
  const { setRatio } = useExportCtx()
  const undoStackRef = useRef<Snap[]>([])
  const redoStackRef = useRef<Snap[]>([])
  const baselineRef = useRef<Snap>({ cues: [], segments: [], seClips: [] })
  const suppressHistoryRef = useRef(false)
  const pendingTimerRef = useRef<number | null>(null)
  const [, setTick] = useState(0)
  const bumpHist = (): void => setTick((n) => n + 1)

  function setTime(t: number): void {
    currentTimeRef.current = t
    // 位置が飛んだら、温めてあった面は当てにできない
    preparedRef.current = null
    setCurrentTime(t)
  }

  /**
   * 再生ヘッドの位置を進める。
   *
   * ## なぜ間引くのか（実測で分かったこと）
   *
   * setCurrentTime は **App 全体（13,000行）を作り直す**。素のままだと
   * rAF が回るたびに作り直すので、240Hz のモニタでは毎秒240回になる。
   *
   * 実測（動きの記録）:
   *
   *     画質360  作り直し 144〜164回/秒 → 240fps 近辺を維持
   *     画質orig 作り直し 200〜254回/秒 → 125fps まで落ちる
   *
   * 1回1回は 50ms に満たないので「長い仕事」としては現れないが、
   * **細かい仕事で主スレッドが埋まりっぱなし**になる。音がぶちぶち切れるのは
   * 1発の詰まりではなくこれ。デコードは無罪（落としたコマは0だった）。
   *
   * 前は 360 のときだけ間引いていた。画質を上げたときこそ重いのに、
   * そこで間引きが外れる作りになっていた。**全部の画質で上限を掛ける。**
   * 再生ヘッドは秒60回も動けば人の目には連続に見える。
   */
  function paintTime(t: number, force = false): void {
    currentTimeRef.current = t
    if (!force) {
      const now = performance.now()
      // 低画質は30回/秒で足りる。それ以外も60回/秒で頭打ちにする
      const minMs = previewResRef.current === 360 ? 33 : 16
      if (now - lastPaintRef.current < minMs) return
      lastPaintRef.current = now
    }
    setCurrentTime(t)
  }

  const isDirty = (): boolean =>
    cuesRef.current !== baselineRef.current.cues ||
    segsRef.current !== baselineRef.current.segments ||
    seClipsRef.current !== baselineRef.current.seClips ||
    markersRef.current !== (baselineRef.current.markers ?? markersRef.current) ||
    imgClipsRef.current !== (baselineRef.current.imgClips ?? imgClipsRef.current) ||
    vClipsRef.current !== (baselineRef.current.vClips ?? vClipsRef.current) ||
    tracksRef.current !== (baselineRef.current.tracks ?? tracksRef.current) ||
    trackStatesRef.current !== (baselineRef.current.trackStates ?? trackStatesRef.current) ||
    ratioRef.current !== (baselineRef.current.ratio ?? ratioRef.current)
  const snapNow = (): Snap => ({
    cues: cuesRef.current,
    segments: segsRef.current,
    seClips: seClipsRef.current,
    markers: markersRef.current,
    imgClips: imgClipsRef.current,
    vClips: vClipsRef.current,
    tracks: tracksRef.current,
    trackStates: trackStatesRef.current,
    ratio: ratioRef.current
  })

  function pushUndo(state: Snap): void {
    undoStackRef.current.push(state)
    if (undoStackRef.current.length > 100) undoStackRef.current.shift()
  }
  // 保留中（デバウンス未確定）の変更を確定。分岐編集があれば redo を無効化する
  function commitPending(): void {
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current)
      pendingTimerRef.current = null
    }
    if (isDirty()) {
      pushUndo(baselineRef.current)
      baselineRef.current = snapNow()
      redoStackRef.current = []
    }
  }
  /**
   * 控えを画面へ戻す（元に戻す・やり直すの、戻す側）。
   *
   * **書き戻す相手は9種類ある。** 新しく控える物を足したら、必ずここへも足すこと。
   * 1つ忘れると、そこだけ戻らずに「Ctrl+Z したのに一部だけ残る」になる。
   *
   * 古い控え（markers や imgClips がまだ無かった頃の物）は、その項目が
   * 入っていない。**無ければ今のままにする**（空で上書きすると、開いた瞬間に消える）。
   *
   * ここに置いてあるのは、**控えを取る側と同じ持ち物を触るから**。
   * 以前は開く／保存する側（state/useProjectFile）に置いていて、
   * あちらは履歴の初期化を要り、こちらは戻す物を要る、という輪になっていた。
   * 中身は心臓を書き換えるだけなので、他人を待つ必要が無い。
   */
  function restore(s: Snap): void {
    baselineRef.current = s
    suppressHistoryRef.current = true
    setCues(s.cues)
    setSegments(s.segments)
    setSeClips(s.seClips)
    if (s.markers) setMarkers(s.markers)
    if (s.imgClips) setImgClips(s.imgClips)
    if (s.vClips) setVClips(s.vClips)
    if (s.tracks) setTracks(s.tracks)
    if (s.trackStates) setTrackStates(s.trackStates)
    if (s.ratio) setRatio(s.ratio)
    // 戻したあとも、残っている物は選んだままにする。
    // 毎回外すと、打っている最中に戻すたび選び直しになる（手数が増える）。
    // 消えた物だけ選択から外す。
    setSelectedIds((prev) => prev.filter((id) => s.cues.some((c) => c.id === id)))
    setEditingId(null) // 戻して消えたテロップの書き換え画面が残らないように
    clearSegSel()
    bumpHist()
  }

  function undo(): void {
    commitPending()
    if (!undoStackRef.current.length) return
    redoStackRef.current.push(snapNow())
    restore(undoStackRef.current.pop() as Snap)
  }
  function redo(): void {
    commitPending() // undo と対称に。分岐編集後は redoStack がクリアされ no-op になる
    if (!redoStackRef.current.length) return
    pushUndo(snapNow())
    restore(redoStackRef.current.pop() as Snap)
  }
  // 履歴をリセット（プロジェクト読み込み時など）
  function resetHistory(base: Snap): void {
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current)
      pendingTimerRef.current = null
    }
    undoStackRef.current = []
    redoStackRef.current = []
    baselineRef.current = base
    cuesRef.current = base.cues
    segsRef.current = base.segments
    seClipsRef.current = base.seClips
    if (base.markers) markersRef.current = base.markers
    if (base.imgClips) imgClipsRef.current = base.imgClips
    if (base.vClips) vClipsRef.current = base.vClips
    if (base.tracks) tracksRef.current = base.tracks
    if (base.trackStates) trackStatesRef.current = base.trackStates
    if (base.ratio) ratioRef.current = base.ratio
    suppressHistoryRef.current = true
    bumpHist()
    // 保険: 続く setCues 等のエフェクトでフラグが消費されなかった場合、次tickで確実に解除
    // （消費済みなら false のまま＝no-op。残留すると次の本物の編集がundoに積まれない不具合の対策）
    setTimeout(() => {
      suppressHistoryRef.current = false
    }, 0)
  }

  return {
    undoStackRef,
    redoStackRef,
    baselineRef,
    suppressHistoryRef,
    pendingTimerRef,
    bumpHist,
    setTime,
    paintTime,
    isDirty,
    snapNow,
    pushUndo,
    commitPending,
    undo,
    redo,
    resetHistory
  }
}
