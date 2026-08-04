// 消す・切る・複製する・詰める。**タイムラインを縮める側の操作**をまとめてある。
//
// ## 「消す」と「詰める」は別物
//
// 消す（Delete）… その物だけ消える。後ろは動かない。空いた所は空白になる。
// 詰める（リップル）… 消したぶん後ろが前へ寄る。**種類を跨いで全部**寄る。
//
// 詰めるときにずらす相手は5種類ある（テロップ・効果音・画像・目印・映像レイヤー）。
// 1つ忘れると、そこだけ置き去りになって「切って詰めたのに文字だけ残る」になる。
//
// ## 空白（gap）は消さずに残す
//
// クリップを動かしてできた隙間は、帯こそ描かないが**当たり判定は残す**。
// 消してしまうとクリックで選べず、Delete で詰める導線に到達できない。
//
// ## 鍵の掛かった段は触らない
//
// どの操作でも同じ。ここを揃えておかないと「キーでは消えるのにボタンでは消えない」
// のような食い違いが出る。
//
// ## 判定そのものは shared 側
//
// どこで切るか（silenceCut）・どう詰めるか（ripple）・切片の分け方（timeline）は
// 画面を起動せずに確かめられるように分けてある。こちらの仕事は
// 「選んでいる物を集めて、鍵を見て、呼ぶ」まで。
//
// ## 割れないと書いてあったが、**測ったら割れた**（2026-08-04）
//
// 2026-08-03 の時点でここには「切り口を探したが見つからなかった」と書いてあった。
// **目で探しただけで、測っていなかった。** 記号解決で測り直したら、話題ごとの群は
// どれも目安（40）のはるか下だった:
//
//   空白を詰める    受け取る 2 ／ 返す 0   ← **2026-08-04 に出した**（state/useGapClose）
//   無音カット      受け取る 3 ／ 返す 1
//   本編の切片      受け取る 7 ／ 返す 1
//   消す・複製      受け取る 7 ／ 返す 1
//   詰める心臓      受け取る12 ／ 返す 1
//
// ※ **測り方に穴が3つある。** 名前ではなく**宣言の位置**で照合する／省略記法は
//   値の方を解く／`const { … } = deps` のような**分割代入は「連れて行く物」に
//   数えない**（両側で書けばよい。数えると、どの群も同じ数字になって嘘が出る）。
//   道具の作り方は `引き継ぎ-心臓の分け直し.md`。
//
// 群どうしは**取り合っていない**（重なりは3文だけで、それも一方向の依存）:
// `mapContentTimes`（このファイルの心臓）・`razorSegment`・`duplicateSelectedSegments`。
// **次に出すなら、この3つの置き場を先に決めること。**
//
// ## 中身
//
// - `useTimelineEdit` … 下をまとめて返す唯一の入口
// - `deleteSelected` … 選んだテロップを消す（後ろは動かない）
// - `rippleDeleteSelected` … 消して後ろを詰める（**種類を跨いで全部**）
// - `cutSelected` … 切り取り（コピーしてから消す）
// - `regroupCopies` … 複製した物の「組」を振り直す（元の組と混ざらないように）
// - `duplicateSelected` … テロップを複製する
// - `deleteSelectedSE` … 選んだ効果音を消す
// - `duplicateClipsFromMenu` … 右クリックからの複製（種類ごと）
// ※ allContentEdges / mapContentTimes / collapseContent は state/useContentShift へ出した
// ※ 本編の切片まわり8つ（razorSegment / rippleDeleteVideoSegments /
//   toggleBlankSelectedVideo / duplicateSelectedSegments / setSelectedSegSpeed /
//   setSegRotate / deleteVideoSegmentsLeavingGap / splitVideoAtPlayhead）は
//   state/useSegmentEdit へ出した。**返す物の名前は変えていない**
// - `rippleToPrevCut` … 前のカットまで詰める（途中に端があればそこで止まる）
// - `rippleToNextCut` … 次のカットまで詰める
// - `cutAtPlayhead` … 再生ヘッドで、載っている物も含めて切る

import {
  clamp, qFrame, rippleEnd, rippleShifted, rippleStart, segSpeed
} from '../../../shared/timeline'
import { nextGroupId, remapGroups } from '../../../shared/group'
import { shouldCut, spansCut } from '../../../shared/cutScope'
// 重なりの解決。**呼び方は state/cueOverwrite に1つだけ**（掴む側・貼り付けも同じ）
import { overwriteOverlapped } from './cueOverwrite'
// 空きを詰める側。**測って外した**（受け取る2・返す0。理由はあちらの冒頭）
import { useGapClose } from './useGapClose'
// 無音を探して詰める側。**測って外した**（受け取る3・返す1＝mapContentTimes は借りるだけ）
import { useSilenceCut } from './useSilenceCut'
// 時刻を付け替える土台（詰める側の心臓）。**またぐからこそ土台**——先にここを出した
import { useContentShift } from './useContentShift'
// 本編の切片そのものの編集。**土台を先に出したら受け取る7・返す0で外れた**
import { useSegmentEdit } from './useSegmentEdit'
import type { Cue } from '../lib/srt'
import type { ImgClip, SEClip, VClip, VSeg } from '../lib/projectTypes'
import type { SegLayout } from '../lib/projectTypes'
import type { SegOps } from '../../../shared/timeline'
import type { CutRange } from '../../../shared/silenceCut'
import type { SilenceCutState } from '../components/dialogs/AudioDialogs'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'
import { usePlaybackCtx } from './playbackContext'

export interface UseTimelineEditDeps {
  /** つなぎ目の演出のうち、どこにも掛からなくなった物を捨てる */
  cleanupOrphanTrans: (list: VSeg[], removedIds: Set<number>) => VSeg[]
  /** まだ確定していない変更を、履歴へ積んでしまう（消す前に必ず呼ぶ） */
  commitPending: () => void
  copySelected: () => void
  cueTrack: (c: Cue) => string
  cutRangeFromSegs: (segs: VSeg[], tA: number, tB: number) => { out: VSeg[]; insertAt: number }
  deleteSelectedImg: () => void
  deleteSelectedVClip: () => void
  idCounter: React.MutableRefObject<number>
  /** 本編（V1）に鍵が掛かっているか */
  mainLocked: () => boolean
  makeGapSeg: (len: number) => VSeg
  seekTo: (t: number) => void
  /**
   * 再生ヘッドが枠の外なら、見える所へ連れてくる（見えているときは何もしない）。
   * リップル削除で詰めたあと、ヘッドだけ画面の外へ飛ぶことがある。
   */
  revealPlayhead: () => void
  /** **形は SegLayout を指す**（前はここに書き写してあり、あちらを直しても古いままになる形だった） */
  segLayoutRef: React.MutableRefObject<SegLayout[]>
  segOps: SegOps<VSeg>
  /** 無音カットの下ごしらえの状態（探している最中か・見つかった所） */
  silenceCut: SilenceCutState
  setSilenceCut: React.Dispatch<React.SetStateAction<SilenceCutState>>
  setSilenceOpen: (v: boolean) => void
  setTime: (t: number) => void
  /** 境目より後ろを、種類を跨いでまとめてずらす */
  shiftAfter: (boundaryT: number, delta: number) => void
  silenceCuts: CutRange[]
  stopPlayback: () => void
  telopLocked: (c: Cue) => boolean
  vcLen: (c: VClip) => number
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
}

export function useTimelineEdit(deps: UseTimelineEditDeps) {
  const {
    cleanupOrphanTrans, commitPending, copySelected, cueTrack, cutRangeFromSegs,
    deleteSelectedImg, deleteSelectedVClip, idCounter, mainLocked, makeGapSeg,
    seekTo, revealPlayhead, segLayoutRef, segOps, setSilenceCut, setSilenceOpen, setTime,
    shiftAfter, silenceCut, silenceCuts, stopPlayback, telopLocked, vcLen, videoRef
  } = deps
  const {
    cues, setCues, setSegments, segIdCounter,
    seClips, setSeClips, seIdCounter, imgClips, setImgClips,
    imgIdCounter, vClips, setVClips, vClipIdCounter
  } = useDoc()
  const {
    selectedIds, setSelectedIds, selectedVideoIds,
    selectedAudioIds, selectedSeIds, setSelectedSeIds,
    selectedImgIds, setSelectedImgIds, selectedVClipIds, setSelectedVClipIds,
    isSelected, clearSegSel,
    clearAll: clearAllSelections
  } = useSel()
  const { trackStates } = useTracksCtx()
  const { showToast } = useToastCtx()
  const { currentTimeRef, durationRef, fpsRef } = usePlaybackCtx()

  // 空きを詰める3つは state/useGapClose。**自分で心臓を見に行く**ので、
  // ここから渡すのは4つだけ（測って外した。受け取る2・返す0）
  // 土台をいちばん先に。**名前をそのまま取り出す**ので、呼んでいる所は書き換えなくてよい
  const { allContentEdges, mapContentTimes, collapseContent } = useContentShift({ vcLen })
  const gap = useGapClose({ mainLocked, vcLen, shiftAfter, seekTo })
  // 本編の切片まわり。**心臓（mapContentTimes）は貸すだけ**
  const seg = useSegmentEdit({
    mainLocked, makeGapSeg, segOps, segLayoutRef,
    shiftAfter, mapContentTimes, revealPlayhead, setTime, stopPlayback
  })
  const silence = useSilenceCut({
    mainLocked, commitPending, cutRangeFromSegs, segOps,
    silenceCut, setSilenceCut, setSilenceOpen, silenceCuts, mapContentTimes
  })

  function deleteSelected(): void {
    if (!selectedIds.length) return
    // ロック中トラックのテロップは残す（実トラック単位で判定）
    setCues((prev) => prev.filter((c) => !isSelected(c.id) || telopLocked(c)))
    setSelectedIds([])
  }
  /**
   * リップル削除（詰める）。選択中のテロップ・SE/BGM・画像・映像レイヤーを消し、
   * **消したクリップと同じトラックの後続だけ**を、その長さぶん前へ詰める。
   *
   * 以前はテロップ専用で、しかもトラックを見ずに全テロップを詰めていた。
   * SE や画像を消しても後続が詰まらず、V2 のテロップを消すと V3 のテロップまで
   * ずれる、という2つの食い違いがあった。
   *
   * 本編（V1/A1）の切片は別物（rippleDeleteVideoSegments が全レーン同期で詰める）。
   */
  function rippleDeleteSelected(): void {
    const hasAny =
      selectedIds.length || selectedSeIds.length || selectedImgIds.length || selectedVClipIds.length
    if (!hasAny) return
    // ロック中トラックのものが1つでも含まれていたら中止（部分的に消えると分かりにくい）
    const locked =
      cues.some((c) => isSelected(c.id) && telopLocked(c)) ||
      seClips.some((c) => selectedSeIds.includes(c.id) && trackStates[c.track]?.locked) ||
      imgClips.some((c) => selectedImgIds.includes(c.id) && trackStates[c.track]?.locked) ||
      vClips.some((c) => selectedVClipIds.includes(c.id) && trackStates[c.track]?.locked)
    if (locked) {
      showToast('ロックされたトラックのクリップが含まれています。')
      return
    }
    // 消した区間（トラックごと）。同じトラックの後続だけを詰めるために使う。
    const holes: { track: string; start: number; end: number }[] = []
    const collect = (track: string, start: number, end: number): void => {
      if (end > start) holes.push({ track, start, end })
    }
    cues.filter((c) => isSelected(c.id)).forEach((c) => collect(cueTrack(c), c.start, c.end))
    seClips
      .filter((c) => selectedSeIds.includes(c.id))
      .forEach((c) => collect(c.track, c.tStart, c.tStart + c.duration))
    imgClips
      .filter((c) => selectedImgIds.includes(c.id))
      .forEach((c) => collect(c.track, c.tStart, c.tStart + c.duration))
    vClips
      .filter((c) => selectedVClipIds.includes(c.id))
      .forEach((c) => collect(c.track, c.tStart, c.tStart + vcLen(c)))
    if (!holes.length) return
    // 詰めた後の位置は shared/timeline の rippleShifted に集約（同じ計算を書き直さない）
    const shifted = (track: string, t: number): number => rippleShifted(holes, track, t)
    setCues((prev) =>
      prev
        .filter((c) => !isSelected(c.id))
        .map((c) => {
          const ns = shifted(cueTrack(c), c.start)
          return ns === c.start ? c : { ...c, start: ns, end: ns + (c.end - c.start) }
        })
    )
    setSeClips((prev) =>
      prev
        .filter((c) => !selectedSeIds.includes(c.id))
        .map((c) => {
          const ns = shifted(c.track, c.tStart)
          return ns === c.tStart ? c : { ...c, tStart: ns }
        })
    )
    setImgClips((prev) =>
      prev
        .filter((c) => !selectedImgIds.includes(c.id))
        .map((c) => {
          const ns = shifted(c.track, c.tStart)
          return ns === c.tStart ? c : { ...c, tStart: ns }
        })
    )
    setVClips((prev) =>
      prev
        .filter((c) => !selectedVClipIds.includes(c.id))
        .map((c) => {
          const ns = shifted(c.track, c.tStart)
          return ns === c.tStart ? c : { ...c, tStart: ns }
        })
    )
    // **削除した所へ再生ヘッドを寄せる。**
    // キー操作のリップルトリム（Q/W）は編集点へ寄せているのに、
    // クリップを選んで消したときだけ置いていかれるのが食い違っていた。
    // 詰めたあとは「消した場所」が次に見たい所なので、そこに立たせる。
    if (holes.length) {
      const to = Math.min(...holes.map((h) => h.start))
      setTime(clamp(to, 0, durationRef.current))
      // **詰めた先が枠の外なら、そこを見せる。** ヘッドは動いているのに画面が
      // 前のままだと、消したあとどこに居るのか分からない。
      // 見えているときは何もしない（押すたびに画面が揺れる方が読みにくい）。
      // 立たせるのは次の描き直しのあと（setTime の結果を待つ）
      requestAnimationFrame(revealPlayhead)
    }
    setSelectedIds([])
    setSelectedSeIds([])
    setSelectedImgIds([])
    setSelectedVClipIds([])
  }

  /**
   * モーションで項目を選んでいる間は、コピー／貼り付けをそちらに回す。
   *
   * プレミアと同じ考え方で、**手前で選んでいる物が相手**になる。
   * モーションのタブを見ていて、そこで項目を選んでいるときだけ横取りする
   * （タイムラインのクリップのコピーは、それ以外では今までどおり）。
   */
  function cutSelected(): void {
    if (
      !selectedIds.length &&
      !selectedSeIds.length &&
      !selectedImgIds.length &&
      !selectedVClipIds.length
    )
      return
    if (cues.some((c) => isSelected(c.id) && telopLocked(c))) return
    copySelected()
    deleteSelected()
    deleteSelectedSE()
    deleteSelectedImg()
    deleteSelectedVClip()
  }
  /**
   * 複製した物に、新しい「組」の番号を振る道具を作る。
   *
   * **元の番号のまま複製してはいけない。** 複製と元が同じ組になり、
   * 複製を動かしたつもりで元まで動く（見た目には理由が分からない）。
   * 元が2つの組に分かれていたら、複製の側でも2つのまま保つ（shared/group）。
   */
  function regroupCopies(src: readonly { group?: number }[]): (g?: number) => number | undefined {
    const m = remapGroups(
      src.map((c) => c.group),
      nextGroupId({ cue: cues, se: seClips, img: imgClips, vclip: vClips })
    )
    return (g) => (g == null ? undefined : m.get(g))
  }

  function duplicateSelected(): void {
    if (!selectedIds.length) return
    if (cues.some((c) => isSelected(c.id) && telopLocked(c))) return
    const picked = cues.filter((c) => isSelected(c.id))
    const rg = regroupCopies(picked)
    const dupes = picked.map((c) => {
      const len = c.end - c.start
      return {
        ...structuredClone(c),
        id: idCounter.current++,
        start: c.end,
        end: c.end + len,
        group: rg(c.group)
      }
    })
    // **複製した側が勝つ。** 複製は「自分の直後」（`start: c.end`）に置くので、
    // **同じ段に次のテロップが並んでいれば必ず食い込む**。落として重ねたとき・
    // 端を伸ばしたとき・貼り付けたときと同じ扱いにする
    //（呼び方は state/cueOverwrite に1つだけ）。
    //
    // ここも `cuesRef` を読まない——まだ setCues していないので、
    // 手元で組み立てた配列に掛ける。
    const merged = [...cues, ...dupes].sort((a, b) => a.start - b.start)
    // ※ **これを外すと本当に赤くなることを確かめてある**（2026-08-03）。
    //   e2e「複製したテロップが次の物に重なっても、複製した側が勝つ」が
    //   `複製したあとも重なったままの帯がある: 600+188 と 694` で落ちる。
    const next = overwriteOverlapped(
      merged,
      dupes.map((d) => d.id),
      cueTrack,
      idCounter
    )
    setCues(next ?? merged)
    setSelectedIds(dupes.map((d) => d.id))
  }
  function deleteSelectedSE(): void {
    if (!selectedSeIds.length) return
    // ロック中トラックのクリップは残す
    setSeClips((prev) =>
      prev.filter((c) => !selectedSeIds.includes(c.id) || trackStates[c.track]?.locked)
    )
    setSelectedSeIds([])
  }



  /**
   * 右クリックの「複製」。選んでいるクリップを、自分のすぐ後ろに複製する。
   * 種類ごとに置き場所も採番も違うので、ここで振り分ける
   * （以前は右クリックメニューの中に直接書いてあった）。
   */
  function duplicateClipsFromMenu(kind: 'seg' | 'se' | 'img' | 'vclip'): void {
    if (kind === 'seg') {
      seg.duplicateSelectedSegments()
      return
    }
    if (kind === 'vclip') {
      const picked = vClips.filter((c) => selectedVClipIds.includes(c.id))
      const rg = regroupCopies(picked)
      const dupes = picked.map((c) => ({
        ...c,
        id: vClipIdCounter.current++,
        tStart: c.tStart + vcLen(c),
        group: rg(c.group)
      }))
      setVClips((prev) => [...prev, ...dupes])
      setSelectedVClipIds(dupes.map((d) => d.id))
      return
    }
    if (kind === 'se') {
      const picked = seClips.filter((c) => selectedSeIds.includes(c.id))
      const rg = regroupCopies(picked)
      const dupes = picked.map((c) => ({
        ...c,
        id: seIdCounter.current++,
        tStart: c.tStart + c.duration,
        group: rg(c.group)
      }))
      setSeClips((prev) => [...prev, ...dupes])
      setSelectedSeIds(dupes.map((d) => d.id))
      return
    }
    const pickedImg = imgClips.filter((c) => selectedImgIds.includes(c.id))
    const rgImg = regroupCopies(pickedImg)
    const dupes = pickedImg.map((c) => ({
      ...c,
      id: imgIdCounter.current++,
      tStart: c.tStart + c.duration,
      group: rgImg(c.group)
    }))
    setImgClips((prev) => [...prev, ...dupes])
    setSelectedImgIds(dupes.map((d) => d.id))
  }

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

  // **外へ出した物も、ここから同じ名前で返す。**
  // 受け取る側（useAppWiring・品書き・キー操作）を1行も書き換えずに済ませるため
  return {
    deleteSelected, rippleDeleteSelected, cutSelected, duplicateSelected,
    deleteSelectedSE, duplicateClipsFromMenu,
    rippleToPrevCut, rippleToNextCut, cutAtPlayhead,
    // 無音カット（state/useSilenceCut）
    findSilences: silence.findSilences,
    applySilenceCut: silence.applySilenceCut,
    // 空きを詰める（state/useGapClose）
    closeGapAtPlayhead: gap.closeGapAtPlayhead,
    closeSelectedGaps: gap.closeSelectedGaps,
    // 本編の切片（state/useSegmentEdit）
    razorSegment: seg.razorSegment,
    rippleDeleteVideoSegments: seg.rippleDeleteVideoSegments,
    toggleBlankSelectedVideo: seg.toggleBlankSelectedVideo,
    duplicateSelectedSegments: seg.duplicateSelectedSegments,
    setSelectedSegSpeed: seg.setSelectedSegSpeed,
    setSegRotate: seg.setSegRotate,
    deleteVideoSegmentsLeavingGap: seg.deleteVideoSegmentsLeavingGap,
    splitVideoAtPlayhead: seg.splitVideoAtPlayhead
    // allContentEdges / mapContentTimes / collapseContent は返さない
    //（この中でだけ使う。return の中は noUnusedLocals が見ない）
  }
}
