// **再生ヘッドを基準に**詰める・割る。前のカットまで／次のカットまで／その場で切る。
//
// 選んでいる物を消す側（./useSelectionEdit）とは別物——**こちらは「いまの時刻」が
// 入力**で、何が選ばれているかは（鍵の判定を除いて）関係しない。
//
// ## 詰める相手は5種類ある
//
// テロップ・効果音・画像・目印・映像レイヤー。**1つ忘れると、そこだけ置き去り**に
// なって「切って詰めたのに文字だけ残る」になる。編集中は気づきにくく、
// 書き出してから分かる。時刻の付け替えは `state/useContentShift` に1つだけ置いてあり、
// ここはそれを**借りる**（持ち出さない）。
//
// ## 途中に端があればそこで止まる
//
// 「前のカットまで」は、間に何かの端（テロップの頭・効果音の尻…）があれば
// そこで止める。飛び越すと、跨いだ物が意図せず縮む。
//
// ## 判定そのものは shared 側
//
// どこで切るか（`shared/cutScope`）・どう詰めるか（`shared/timeline` の
// rippleStart / rippleEnd）は画面を起動せずに確かめられるように分けてある。
//
// ## なぜ state/useTimelineEdit から出したか（2026-08-04）
//
// 記号解決で測ったら **受け取る12・返す1**。受け取る12は**全部 import か型**で、
// 返す1つ（`seg`）から実際に使うのは `razorSegment` **1つだけ**
//（`引き継ぎ-心臓の分け直し.md`）。
//
// ## 中身
//
// - `usePlayheadRipple` … 下の3つをまとめて返す唯一の入口
// - `rippleToPrevCut` … 前のカットまで詰める（途中に端があればそこで止まる）
// - `rippleToNextCut` … 次のカットまで詰める
// - `cutAtPlayhead` … 再生ヘッドで、載っている物も含めて切る
import { qFrame, rippleEnd, rippleStart, segSpeed } from '../../../shared/timeline'
import { shouldCut, spansCut } from '../../../shared/cutScope'
import type { Cue } from '../lib/srt'
import type { ImgClip, SEClip, SegLayout, VClip, VSeg } from '../lib/projectTypes'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { usePlaybackCtx } from './playbackContext'

export interface UsePlayheadRippleDeps {
  /** つなぎ目の演出のうち、どこにも掛からなくなった物を捨てる */
  cleanupOrphanTrans: (list: VSeg[], removedIds: Set<number>) => VSeg[]
  idCounter: React.MutableRefObject<number>
  /** 本編（V1）に鍵が掛かっているか */
  mainLocked: () => boolean
  segLayoutRef: React.MutableRefObject<SegLayout[]>
  setTime: (t: number) => void
  stopPlayback: () => void
  telopLocked: (c: Cue) => boolean
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
  /** 本編に載っている物の端の時刻を全部集める（state/useContentShift） */
  allContentEdges: () => number[]
  /**
   * 区間を捨てて後ろを詰める。**state/useContentShift の物を借りる**
   *（5種類まとめて付け替える心臓。持ち出さない）
   */
  collapseContent: (rmStart: number, rmEnd: number, removeLen: number) => void
  /**
   * 切片を、素材の中の位置で2つに割る（レザー）。
   * **state/useSegmentEdit の物を借りる**（手で書き写さず、あちらの形に合わせる）
   */
  razorSegment: (seg: VSeg, atSrc: number) => void
}

export function usePlayheadRipple(deps: UsePlayheadRippleDeps) {
  const {
    cleanupOrphanTrans, idCounter, mainLocked, segLayoutRef, setTime, stopPlayback,
    telopLocked, videoRef, allContentEdges, collapseContent, razorSegment
  } = deps
  const {
    cues, setCues, setSegments, segIdCounter, seClips, setSeClips, seIdCounter,
    imgClips, setImgClips, imgIdCounter, vClips, setVClips, vClipIdCounter
  } = useDoc()
  const {
    selectedIds, setSelectedIds, selectedVideoIds, selectedAudioIds, selectedSeIds,
    selectedImgIds, selectedVClipIds, isSelected, clearSegSel,
    clearAll: clearAllSelections
  } = useSel()
  const { trackStates } = useTracksCtx()
  const { currentTimeRef, fpsRef } = usePlaybackCtx()
  // **借りている物をそのまま渡す**（名前を変えると、呼んでいる所が
  // 「本編の切片を触っている」と気づけなくなる）
  const seg = { razorSegment }

  function rippleToPrevCut(): void {
    if (mainLocked()) return
    stopPlayback()
    const t = currentTimeRef.current
    const L = segLayoutRef.current.find((l) => t > l.tStart + 0.01 && t <= l.tEnd + 1e-6)
    if (!L) return
    // カット点まで一気に詰めず、途中に編集点（テロップ等の端）があればそこで止める。
    // 例: カット点0・テロップ[2,5]・再生ヘッド8 なら、[0,8] ではなく [5,8] を削る。
    const floorT = rippleStart(L.tStart, t, allContentEdges())
    const removeLen = Math.min(t - floorT, L.len)
    if (removeLen < 0.02) return
    const rmStart = floorT
    const rmEnd = t
    const sp = segSpeed(L.seg)
    const midCut = floorT > L.tStart + 1e-6 // 切片の途中から削る＝2つに割って間を捨てる
    setSegments((prev) => {
      const idx = prev.findIndex((x) => x.id === L.seg.id)
      if (idx < 0) return prev
      const seg = prev[idx]
      let next: VSeg[]
      if (!midCut) {
        // 切片の頭から削る（従来どおり頭を前進させる）
        next = prev.map((x) =>
          x.id === seg.id ? { ...x, srcStart: x.srcStart + removeLen * sp } : x
        )
      } else {
        // 途中を削る: [切片頭, floorT] と [t, 切片尻] を残して間を捨てる。
        // 間のトランジションは分割点をまたげないので落とす。
        const keepLeftEnd = seg.srcStart + (floorT - L.tStart) * sp
        const keepRightStart = seg.srcStart + (t - L.tStart) * sp
        next = [...prev]
        next[idx] = { ...seg, srcEnd: keepLeftEnd, transOut: undefined, xfade: undefined }
        next.splice(idx + 1, 0, {
          ...seg,
          id: segIdCounter.current++,
          srcStart: keepRightStart,
          transIn: undefined
        })
      }
      const gone = new Set(next.filter((x) => x.srcEnd - x.srcStart <= 0.02).map((x) => x.id))
      return gone.size ? cleanupOrphanTrans(next, gone) : next
    })
    collapseContent(rmStart, rmEnd, removeLen)
    if (videoRef.current)
      videoRef.current.currentTime = L.seg.srcStart + (rmStart - L.tStart) * sp
    setTime(rmStart) // 再生ヘッドは削った位置（編集点）に留める
    clearAllSelections() // 消えたクリップを選択に残さない
  }
  // 再生ヘッドから「1つ後のカット点」までを詰めて削除。
  // 対象切片の尻を再生ヘッドまで後退＝[再生ヘッド, 切片終わり]を除去し、後続を詰める。
  function rippleToNextCut(): void {
    if (mainLocked()) return
    stopPlayback()
    const t = currentTimeRef.current
    const L = segLayoutRef.current.find((l) => t >= l.tStart - 1e-6 && t < l.tEnd - 0.01)
    if (!L) return
    // カット点まで一気に詰めず、途中に編集点（テロップ等の端）があればそこで止める。
    const ceilT = rippleEnd(t, L.tEnd, allContentEdges())
    const removeLen = Math.min(ceilT - t, L.len)
    if (removeLen < 0.02) return
    const rmStart = t
    const rmEnd = ceilT
    const sp = segSpeed(L.seg)
    const midCut = ceilT < L.tEnd - 1e-6 // 切片の途中まで削る＝2つに割って間を捨てる
    setSegments((prev) => {
      const idx = prev.findIndex((x) => x.id === L.seg.id)
      if (idx < 0) return prev
      const seg = prev[idx]
      let next: VSeg[]
      if (!midCut) {
        // 切片の尻まで削る（従来どおり尻を手前へ）
        next = prev.map((x) =>
          x.id === seg.id ? { ...x, srcEnd: x.srcEnd - removeLen * sp } : x
        )
      } else {
        const keepLeftEnd = seg.srcStart + (t - L.tStart) * sp
        const keepRightStart = seg.srcStart + (ceilT - L.tStart) * sp
        next = [...prev]
        next[idx] = { ...seg, srcEnd: keepLeftEnd, transOut: undefined, xfade: undefined }
        next.splice(idx + 1, 0, {
          ...seg,
          id: segIdCounter.current++,
          srcStart: keepRightStart,
          transIn: undefined
        })
      }
      const gone = new Set(next.filter((x) => x.srcEnd - x.srcStart <= 0.02).map((x) => x.id))
      return gone.size ? cleanupOrphanTrans(next, gone) : next
    })
    collapseContent(rmStart, rmEnd, removeLen)
    if (videoRef.current) videoRef.current.currentTime = L.seg.srcStart + (t - L.tStart) * sp
    setTime(rmStart) // 再生ヘッドはカット点（元の位置）に留める
    clearSegSel() // 消えたクリップを選択に残さない
    setSelectedIds([])
  }


  /**
   * 再生ヘッドで切る。**選んでいる物があるかどうかで意味が変わる。**
   *
   *   何も選んでいない → 再生ヘッドの位置で、載っている物を全部切る
   *   何かを選んでいる → その選んだ物だけを切る
   *
   * 以前は「動画は常に全部・テロップだけ選択を見る」という食い違った作りで、
   * 効果音・画像・映像レイヤーには分割そのものが無かった。
   * **どれを切るかを1か所で決める**（散らばっていると、種類ごとに挙動が割れる）。
   */
  function cutAtPlayhead(): void {
    const t = qFrame(currentTimeRef.current, fpsRef.current)
    const anySel =
      selectedIds.length > 0 ||
      selectedVideoIds.length > 0 ||
      selectedAudioIds.length > 0 ||
      selectedSeIds.length > 0 ||
      selectedImgIds.length > 0 ||
      selectedVClipIds.length > 0
    // 決め方は shared/cutScope に置いてある（種類ごとに書き直さないこと）
    const want = (selected: boolean): boolean => shouldCut(anySel, selected)
    const spans = (start: number, end: number): boolean => spansCut(start, end, t)

    // ---- 本編の動画（V1）----
    if (!mainLocked()) {
      const L = segLayoutRef.current.find((x) => spans(x.tStart, x.tEnd))
      const segSel =
        selectedVideoIds.includes(L?.seg.id ?? -1) || selectedAudioIds.includes(L?.seg.id ?? -1)
      if (L && want(segSel)) seg.razorSegment(L.seg, L.seg.srcStart + (t - L.tStart) * segSpeed(L.seg))
    }

    // ---- テロップ ----
    const cueTargets = cues.filter(
      (c) => want(isSelected(c.id)) && !telopLocked(c) && spans(c.start, c.end)
    )
    if (cueTargets.length) {
      const idMap = new Map(cueTargets.map((c) => [c.id, idCounter.current++]))
      setCues((prev) => {
        const out: Cue[] = []
        for (const c of prev) {
          const nid = idMap.get(c.id)
          if (nid != null) {
            out.push({ ...structuredClone(c), end: t })
            out.push({ ...structuredClone(c), id: nid, start: t })
          } else out.push(c)
        }
        return out.sort((a, b) => a.start - b.start)
      })
    }

    // ---- 効果音・BGM ----
    // 音源の中の位置（srcOffset）も進める。ここを忘れると、後半が頭から鳴り直す
    const seTargets = seClips.filter(
      (c) =>
        want(selectedSeIds.includes(c.id)) &&
        !trackStates[c.track]?.locked &&
        spans(c.tStart, c.tStart + c.duration)
    )
    if (seTargets.length) {
      const idMap = new Map(seTargets.map((c) => [c.id, seIdCounter.current++]))
      setSeClips((prev) => {
        const out: SEClip[] = []
        for (const c of prev) {
          const nid = idMap.get(c.id)
          if (nid != null) {
            const left = t - c.tStart
            out.push({ ...c, duration: left })
            out.push({
              ...c,
              id: nid,
              tStart: t,
              duration: c.duration - left,
              srcOffset: (c.srcOffset ?? 0) + left
            })
          } else out.push(c)
        }
        return out
      })
    }

    // ---- 画像 ----
    // 静止画なので、切っても中身の位置は動かない（長さだけ分ける）
    const imgTargets = imgClips.filter(
      (c) =>
        want(selectedImgIds.includes(c.id)) &&
        !trackStates[c.track]?.locked &&
        spans(c.tStart, c.tStart + c.duration)
    )
    if (imgTargets.length) {
      const idMap = new Map(imgTargets.map((c) => [c.id, imgIdCounter.current++]))
      setImgClips((prev) => {
        const out: ImgClip[] = []
        for (const c of prev) {
          const nid = idMap.get(c.id)
          if (nid != null) {
            const left = t - c.tStart
            out.push({ ...structuredClone(c), duration: left })
            out.push({
              ...structuredClone(c),
              id: nid,
              tStart: t,
              duration: c.duration - left
            })
          } else out.push(c)
        }
        return out
      })
    }

    // ---- 映像レイヤー ----
    // 素材の中のどこを使うか（srcStart〜srcEnd）を分ける。動画の切片と同じ考え方
    const vcTargets = vClips.filter(
      (c) =>
        want(selectedVClipIds.includes(c.id)) &&
        !trackStates[c.track]?.locked &&
        spans(c.tStart, c.tStart + (c.srcEnd - c.srcStart))
    )
    if (vcTargets.length) {
      const idMap = new Map(vcTargets.map((c) => [c.id, vClipIdCounter.current++]))
      setVClips((prev) => {
        const out: VClip[] = []
        for (const c of prev) {
          const nid = idMap.get(c.id)
          if (nid != null) {
            const cut = c.srcStart + (t - c.tStart)
            out.push({ ...structuredClone(c), srcEnd: cut })
            out.push({ ...structuredClone(c), id: nid, tStart: t, srcStart: cut })
          } else out.push(c)
        }
        return out
      })
    }
  }

  return { rippleToPrevCut, rippleToNextCut, cutAtPlayhead }
}
