// 消す・切る・複製する・詰める。**タイムラインを縮める側の操作**の入口。
//
// ## ここはもう「配線」しかしていない（2026-08-04）
//
// 中身は全部6つの区画へ出た。**心臓（context）を1つも見に行かない**——
// 区画がそれぞれ自分で見に行くので、ここに残ったのは「誰に何を渡すか」だけ。
//
//   ./useContentShift    時刻を付け替える**土台**（5種類まとめて。詰める側の心臓）
//   ./useSelectionEdit   選んでいる物を消す・切る・複製する
//   ./usePlayheadRipple  再生ヘッドを基準に詰める・割る
//   ./useSegmentEdit     本編（V1）の切片そのものの編集
//   ./useGapClose        空きを詰める
//   ./useSilenceCut      無音を探して詰める
//
// **返す物の名前は1つも変えていない。** 受け取る側（useAppWiring・品書き・
// キー操作）を1行も書き換えずに済ませるため。
//
// ## 割れないと書いてあったが、**測ったら割れた**（2026-08-04）
//
// 2026-08-03 の時点でここには「切り口を探したが見つからなかった」と書いてあった。
// **目で探しただけで、測っていなかった。** 記号解決で測り直したら、話題ごとの群は
// どれも目安（40）のはるか下だった。959 → 178行。
//
// **またぐ物こそが土台だった。** 「mapContentTimes が4群からまたいで使われるので
// どこで切っても導管になる」と書いて諦めていたが、逆——先に土台として出したら、
// 次の群の「返す」が 1 → 0 になった。
//
// ※ **測り方に穴が5つある。** 名前ではなく**宣言の位置**で照合する／省略記法は
//   値の方を解く／分割代入・import・**型の宣言**は「連れて行く物」に数えない
//（両側に置けるから。数えると、どの群も同じだけ膨らんで嘘が出る）。
//   道具の作り方は `引き継ぎ-心臓の分け直し.md`。
//
// ## 「消す」と「詰める」は別物（どの区画でも同じ）
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

// 空きを詰める側。**測って外した**（受け取る2・返す0。理由はあちらの冒頭）
import { useGapClose } from './useGapClose'
// 無音を探して詰める側。**測って外した**（受け取る3・返す1＝mapContentTimes は借りるだけ）
import { useSilenceCut } from './useSilenceCut'
// 時刻を付け替える土台（詰める側の心臓）。**またぐからこそ土台**——先にここを出した
import { useContentShiftCtx } from './contentShiftContext'
// 本編の切片そのものの編集。**土台を先に出したら受け取る7・返す0で外れた**
import { useSegmentEdit } from './useSegmentEdit'
// 選んでいる物を消す・切る・複製する（受け取る6・返す1）
import { useSelectionEdit } from './useSelectionEdit'
// 再生ヘッドを基準に詰める・割る（受け取る12・返す1）
import { usePlayheadRipple } from './usePlayheadRipple'
import type { Cue } from '../lib/srt'
import type { VClip, VSeg } from '../lib/projectTypes'
import type { SegLayout } from '../lib/projectTypes'
import type { SegOps } from '../../../shared/timeline'
import type { CutRange } from '../../../shared/silenceCut'
import type { SilenceCutState } from '../components/dialogs/AudioDialogs'

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
  // **ここは心臓を1つも見に行かない**（2026-08-04）。中身を6つの区画へ出した結果、
  // 残ったのは「誰に何を渡すか」だけになった。区画はそれぞれ自分で見に行く。
  // 空きを詰める3つは state/useGapClose。**自分で心臓を見に行く**ので、
  // ここから渡すのは4つだけ（測って外した。受け取る2・返す0）
  // 土台をいちばん先に。**名前をそのまま取り出す**ので、呼んでいる所は書き換えなくてよい
  // **呼ぶのは囲いの中の1回だけ**（state/contentShiftContext。理由もそちら）
  const { allContentEdges, mapContentTimes, collapseContent } = useContentShiftCtx()
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
  // 選んでいる物を消す・切る・複製する（state/useSelectionEdit）。
  // **借りるのは `duplicateSelectedSegments` 1つだけ**（測って外した）
  const selEdit = useSelectionEdit({
    copySelected, cueTrack, deleteSelectedImg, deleteSelectedVClip, idCounter,
    revealPlayhead, setTime, telopLocked, vcLen,
    duplicateSelectedSegments: seg.duplicateSelectedSegments
  })
  // 再生ヘッドを基準に詰める・割る（state/usePlayheadRipple）。
  // **心臓（collapseContent）と `razorSegment` は貸すだけ**
  const ripple = usePlayheadRipple({
    cleanupOrphanTrans, idCounter, mainLocked, segLayoutRef, setTime, stopPlayback,
    telopLocked, videoRef, allContentEdges, collapseContent, razorSegment: seg.razorSegment
  })

  // **外へ出した物も、ここから同じ名前で返す。**
  // 受け取る側（useAppWiring・品書き・キー操作）を1行も書き換えずに済ませるため
  return {
    // 選んでいる物を消す・複製する（state/useSelectionEdit）
    deleteSelected: selEdit.deleteSelected,
    rippleDeleteSelected: selEdit.rippleDeleteSelected,
    cutSelected: selEdit.cutSelected,
    duplicateSelected: selEdit.duplicateSelected,
    deleteSelectedSE: selEdit.deleteSelectedSE,
    duplicateClipsFromMenu: selEdit.duplicateClipsFromMenu,
    // 再生ヘッドで詰める・割る（state/usePlayheadRipple）
    rippleToPrevCut: ripple.rippleToPrevCut,
    rippleToNextCut: ripple.rippleToNextCut,
    cutAtPlayhead: ripple.cutAtPlayhead,
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
