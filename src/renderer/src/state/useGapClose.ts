// 本編にできた「空き（gap）」を詰める。
//
// ## 空きは消さずに残してある
//
// クリップを動かしてできた隙間は、帯こそ描かないが**当たり判定は残す**。
// 消してしまうとクリックで選べず、Delete で詰める導線に到達できない。
// ここはその「詰める」側。
//
// ## 途中に何か載っていたら、その手前で止める
//
// 空き全部を一度に詰めると、間にあったテロップが巻き添えでずれる。
// **「編集点」ではなく区間で見る**のが要点——編集点だけだと、空きの先頭に
// ちょうど重なっているクリップを飛び越えて、その中身を突き抜けて詰めてしまう。
//
// **どこまで詰めてよいかの判断は `shared/gapClose`**（2026-10-10）。前のクリップから
// 続いて空きに掛かっている字幕（カットをまたぐ物）は邪魔にしない——前はそれも
// 「先頭に重なっている」で止めていて、字幕186枚の編集では**ほとんどの空きが
// 何をしても消せなかった**。捨てた区間に掛かっていた尻は `collapseContent` が
// 空きの頭で止める（消さない）。
//
// ## なぜ state/useTimelineEdit から出したか（2026-08-04）
//
// あちらは959行あり、冒頭が「**切り口を探したが見つからなかった**」と書いていた。
// **目で探しただけで、測っていなかった。** 記号解決で測り直したら、
// この群は **受け取る2・返す0・他の群との重なり0** で、いちばん綺麗に外れた
// （測り方は `引き継ぎ-心臓の分け直し.md`）。
//
// 受け取る2つ（`layoutSegs` / `segTLen`）も `shared/timeline` の import なので、
// **こちらで書けば済む＝局所の物は1つも要らない。**
import { layoutSegs, segTLen } from '../../../shared/timeline'
import { TINY_GAP, planGapClose } from '../../../shared/gapClose'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useToastCtx } from './toastContext'
import { usePlaybackCtx } from './playbackContext'
import type { VClip } from '../lib/projectTypes'

export interface UseGapCloseDeps {
  /** 本編（V1）に鍵が掛かっているか */
  mainLocked: () => boolean
  /** 重ねた動画の長さ。**正典は shared/timeline の vcLen** */
  vcLen: (c: VClip) => number
  /**
   * 区間 [rmStart, rmEnd] を捨てて後ろを詰める（shared/ripple の collapseAt）。
   * 後ろの物は寄せ、区間に掛かっていた物の尻は区間の頭で止める。
   * 前は `shiftAfter`（境目より後ろをずらすだけ）だったので、掛かっていた字幕の
   * 尻を止められず、「先頭に重なっていたら止める」で逃げるしかなかった
   */
  collapseContent: (rmStart: number, rmEnd: number, removeLen: number) => void
  seekTo: (t: number) => void
}

export function useGapClose(deps: UseGapCloseDeps) {
  const { mainLocked, vcLen, collapseContent, seekTo } = deps
  const { setSegments, segsRef, cuesRef, seClipsRef, imgClipsRef, vClipsRef } = useDoc()
  const {
    selectedIds, selectedVideoIds, selectedAudioIds, selectedSeIds,
    selectedImgIds, selectedVClipIds, clearSegSel
  } = useSel()
  const { showToast } = useToastCtx()
  const { currentTimeRef } = usePlaybackCtx()

  /**
   * 再生ヘッドが空きの上なら、そこを詰める。
   *
   * 戻り値: 詰めたら true。空きの上でなければ false（呼び出し側は通常の削除へ）。
   */
  function closeGapAtPlayhead(): boolean {
    const t = currentTimeRef.current
    const L = layoutSegs(segsRef.current).find(
      (x) => x.seg.gap && t >= x.tStart - 1e-6 && t < x.tEnd - 1e-6
    )
    return L ? closeGap(L.seg.id) : false
  }

  /**
   * 選んでいる「空き」を詰める。**空きだけを選んでいるときに限る。**
   *
   * クリップも一緒に選ばれているのに詰めてしまうと、Delete が
   * 「空きを詰めただけで、クリップは何も消えない」動きになる。
   * 実際に Ctrl+A（全部選択）→ Delete で、空きが1つでもあると
   * 本編のクリップが消えなくなっていた。
   */
  function closeSelectedGaps(): boolean {
    const ids = new Set([...selectedVideoIds, ...selectedAudioIds])
    const picked = segsRef.current.filter((s) => ids.has(s.id))
    const gap = picked.find((s) => s.gap)
    if (!gap) return false
    // 空き以外も選ばれている＝「消す」が主目的。詰める動作は取らない
    const onlyGaps =
      picked.every((s) => s.gap) &&
      !selectedIds.length &&
      !selectedSeIds.length &&
      !selectedImgIds.length &&
      !selectedVClipIds.length
    if (!onlyGaps) return false
    clearSegSel()
    return closeGap(gap.id)
  }

  /** 空き1つを詰める。途中に別のクリップがあればその手前で止める。 */
  function closeGap(segId: number): boolean {
    if (mainLocked()) return false
    const segs = segsRef.current
    const L = layoutSegs(segs).find((x) => x.seg.id === segId && x.seg.gap)
    if (!L) return false
    // 空きの上に重なっているもの（テロップ・効果音・画像・重ねた動画）を見る。
    // 「編集点」ではなく**区間**で見るのが要点。編集点だけだと、空きの先頭に
    // ちょうど重なっているクリップを飛び越えて、その中身を突き抜けて詰めてしまう。
    const spans = [
      ...cuesRef.current.map((c) => ({ start: c.start, end: c.end })),
      ...seClipsRef.current.map((c) => ({ start: c.tStart, end: c.tStart + c.duration })),
      ...imgClipsRef.current.map((c) => ({ start: c.tStart, end: c.tStart + c.duration })),
      ...vClipsRef.current.map((c) => ({ start: c.tStart, end: c.tStart + vcLen(c) }))
    ]
    const plan = planGapClose({ start: L.tStart, end: L.tEnd }, spans)
    if (plan.blocked === 'start') {
      showToast('この空きの先頭には別のクリップが来ています。')
      return true
    }
    // 極小の空き（1コマ未満）は、何も載っていなければ黙って消す。
    // 前は「残り幅が1ms以下＝別のクリップが来ている」に引っかかって永久に消せなかった
    const tiny = plan.whole && plan.len <= TINY_GAP
    if (plan.len <= 1e-3 && !tiny) {
      showToast('この空きの先頭には別のクリップが来ています。')
      return true
    }
    const { to, len } = plan
    // 空きを縮める（丸ごと無くなるなら切片ごと外す）
    const next = segs.flatMap((s) =>
      s.id !== L.seg.id
        ? [s]
        : segTLen(s) - len > 1e-3
          ? [{ ...s, srcEnd: s.srcEnd - len }]
          : []
    )
    setSegments(next)
    // 捨てた区間 [頭, to] のぶん、後ろのテロップ/SE/画像/目印/映像レイヤーを前へ。
    // 区間に掛かっていた字幕の尻は区間の頭で止まる（消えない）
    collapseContent(L.tStart, to, len)
    seekTo(L.tStart)
    if (!plan.whole) showToast('次のクリップの手前まで詰めました。')
    return true
  }

  return { closeGapAtPlayhead, closeSelectedGaps, closeGap }
}
