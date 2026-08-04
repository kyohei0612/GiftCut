// 編集が落ち着いたら、履歴を1つ積む（450ms でまとめる）。
//
// ## なぜまとめるか
//
// 文字を1文字打つたびに履歴が積まれると、Ctrl+Z が**1文字ずつ**戻る。
// 掴んで動かしている間も1コマごとに積まれる。450ms 手が止まったら1つ、にする。
//
// ## 写し取り（refs）が同じ効果に入っている理由
//
// 履歴の写し（`snapNow`）は ref から読む。**ref を更新する前に写すと1つ前の
// 中身が入る**ので、更新と写しは同じ効果の中に置いて順番を固定してある。
//
// ## 呼ぶ順を変えない
//
// 元は `useSessionMemory` の中にあり、**セッション保存 → ここ**の順で走っていた。
// セッション保存は「1つ前の描画の ref」を見て「中身があるか」を判断しているので、
// **ここを先に呼ぶと、起動直後に空の状態でセッションを上書きしうる。**
// `useAppWiring` では必ず `useSessionMemory` の**後**に呼ぶこと（2026-08-03 に分けた）。
import { useEffect } from 'react'
import { useDoc } from './contentContext'
import { useTracksCtx } from './tracksContext'
import { useExportCtx } from './exportContext'
import { useHistoryCtx } from './historyContext'
import type { Snap } from './useHistory'
import type { Ratio } from './useExportSettings'

// **`any` で受けない。** 呼ぶ側が実物を渡す入口なので、型がズレた瞬間に
// 呼び出し側で落ちる＝手で書いても腐らない。
export interface UseHistoryCoalesceDeps {
  /** 前回の写しと比べて変わっているか */
  isDirty: () => boolean
  /** いまの中身を1つの写しにする */
  snapNow: () => Snap
  pushUndo: (state: Snap) => void
  baselineRef: React.MutableRefObject<Snap>
  pendingTimerRef: React.MutableRefObject<number | null>
  /** 読み込みなど「履歴に残さない変更」の札 */
  suppressHistoryRef: React.MutableRefObject<boolean>
  redoStackRef: React.MutableRefObject<Snap[]>
  setHistTick: () => void
  /**
   * 画面比。履歴の写しに入れる。
   * **`string` ではなく `Ratio`**——前は手で広げてあり、
   * 「16:9」以外の綴りを入れても通る形だった
   */
  ratioRef: React.MutableRefObject<Ratio>
}

export function useHistoryCoalesce(): void {
  // **要る9個は全部 履歴の心臓にある**（2026-08-04）。配線は取り出して
  // 渡していただけだった（`npm run passthrough` の①）
  const {
    isDirty, snapNow, pushUndo, baselineRef, pendingTimerRef, suppressHistoryRef,
    redoStackRef, bumpHist: setHistTick, ratioRef
  } = useHistoryCtx()
  const {
    cues, cuesRef, segments, segsRef, seClips, seClipsRef, imgClips, imgClipsRef,
    vClips, vClipsRef, markers, markersRef
  } = useDoc()
  const { tracks, tracksRef, trackStates, trackStatesRef } = useTracksCtx()
  const { ratio } = useExportCtx()

  // cues / segments / seClips / markers / imgClips の変更を 450ms コアレスして1履歴にまとめる
  useEffect(() => {
    cuesRef.current = cues
    segsRef.current = segments
    seClipsRef.current = seClips
    markersRef.current = markers
    imgClipsRef.current = imgClips
    vClipsRef.current = vClips
    tracksRef.current = tracks
    trackStatesRef.current = trackStates
    ratioRef.current = ratio
    if (suppressHistoryRef.current) {
      suppressHistoryRef.current = false
      baselineRef.current = snapNow()
      return
    }
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
    pendingTimerRef.current = window.setTimeout(() => {
      pendingTimerRef.current = null
      if (isDirty()) {
        pushUndo(baselineRef.current)
        baselineRef.current = snapNow()
        redoStackRef.current = []
        setHistTick()
      }
    }, 450)
    return () => {
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
    }
  }, [cues, segments, seClips, markers, imgClips, vClips, tracks, trackStates, ratio])
}
