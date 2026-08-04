// 無音の区間を探して、まとめて詰める。
//
// ## 後ろから消す
//
// 前から消すと、消したぶんだけ後ろの位置がずれて狙いが外れる。
//
// ## 映像だけ詰めない
//
// 文字・効果音・画像・めじるしも同じ規則で付け替える（`mapContentTimes`）。
// **1種類でも掛け忘れると、そこだけ置き去りになる。**
//
// ## 探す所は shared 側
//
// どこが無音かの判定（`shared/silenceCut`）と、実際に音を調べる所（main 側の
// ffmpeg）は分けてある。ここの仕事は「聞いて、詰めて、知らせる」まで。
//
// ## なぜ state/useTimelineEdit から出したか（2026-08-04）
//
// あちらは959行あり、冒頭が「切り口を探したが見つからなかった」と書いていたが、
// **目で探しただけで測っていなかった。** 記号解決で測ったら
// **受け取る3・返す1**で外れた（`引き継ぎ-心臓の分け直し.md`）。
//
// ※ 返す1＝`mapContentTimes`。あれは**あちらの心臓**（5種類まとめて時刻を
//   付け替える）で、無音カット以外からも呼ばれる。連れて行かずに**受け取る**。
import { tidyGaps, type SegOps } from '../../../shared/timeline'
import { totalCutLen, type CutRange } from '../../../shared/silenceCut'
import type { SilenceCutState } from '../components/dialogs/AudioDialogs'
import type { VSeg } from '../lib/projectTypes'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useToastCtx } from './toastContext'
import { useMediaCtx } from './mediaContext'

export interface UseSilenceCutDeps {
  /** 本編（V1）に鍵が掛かっているか */
  mainLocked: () => boolean
  /** まだ確定していない変更を、履歴へ積んでしまう（消す前に必ず呼ぶ） */
  commitPending: () => void
  cutRangeFromSegs: (segs: VSeg[], tA: number, tB: number) => { out: VSeg[]; insertAt: number }
  segOps: SegOps<VSeg>
  /** 無音カットの下ごしらえの状態（探している最中か・見つかった所） */
  silenceCut: SilenceCutState
  setSilenceCut: React.Dispatch<React.SetStateAction<SilenceCutState>>
  setSilenceOpen: (v: boolean) => void
  silenceCuts: CutRange[]
  /**
   * 本編に載っている物の時刻を、**5種類まとめて**付け替える。
   * **state/useTimelineEdit の心臓**。ここは借りるだけ（連れて行かない）
   */
  mapContentTimes: (at: (t: number) => number) => void
}

export function useSilenceCut(deps: UseSilenceCutDeps) {
  const {
    mainLocked, commitPending, cutRangeFromSegs, segOps,
    silenceCut, setSilenceCut, setSilenceOpen, silenceCuts, mapContentTimes
  } = deps
  const { setSegments, segsRef } = useDoc()
  const { clearSegSel } = useSel()
  const { showToast } = useToastCtx()
  const { sources, videoPath } = useMediaCtx()

  async function findSilences(): Promise<void> {
    const path = sources[0]?.path ?? videoPath
    if (!path) {
      showToast('先に動画を読み込んでください。')
      return
    }
    setSilenceCut((s) => ({ ...s, busy: true }))
    const res = await window.giftcut.detectSilences(path, silenceCut.noiseDb, silenceCut.minSec)
    setSilenceCut((s) => ({ ...s, busy: false, found: res?.ok ? (res.silences ?? []) : [] }))
    if (!res?.ok) showToast('無音を調べられませんでした: ' + (res?.error ?? ''), 'error')
  }

  /** 見つけた無音を、後ろから順に詰めて削除する */
  function applySilenceCut(): void {
    const ranges = silenceCuts
    if (!ranges.length) return
    if (mainLocked()) return
    commitPending()
    // 後ろから消す。前から消すと、消したぶんだけ後ろの位置がずれて狙いが外れる。
    const desc = [...ranges].sort((a, b) => b.start - a.start)
    let segs = segsRef.current
    for (const r of desc) segs = cutRangeFromSegs(segs, r.start, r.end).out
    setSegments(tidyGaps(segs, segOps))
    // 文字・効果音・画像・めじるしも一緒に詰める（映像だけ詰まると全部ずれる）
    const shift = (t: number): number => {
      let v = t
      for (const r of desc) {
        if (v >= r.end) v -= r.end - r.start
        else if (v > r.start) v = r.start
      }
      return v
    }
    mapContentTimes(shift)
    clearSegSel()
    const sec = totalCutLen(ranges)
    showToast(`${ranges.length}か所・合計 ${sec.toFixed(1)}秒 を詰めました。`, 'success')
    setSilenceOpen(false)
    setSilenceCut((s) => ({ ...s, found: null }))
  }

  return { findSilences, applySilenceCut }
}
