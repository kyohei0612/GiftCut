// **トラック選択ツール**（プレミア準拠）。クリックした所から左／右を全部選ぶ。
//
// ## ここが「掴む」より先に来る
//
// この道具が選ばれている間は、擦る・囲う・動かす**どの入口も**まず
// `maybeTrackSelect` を通して、true なら自分の仕事をやめる。
// だから3つの入口すべてがここを見に来る＝**これが土台**（測って分かった）。
//
// ## 段を決め打ちにしない
//
// テロップの段を V2・V3 と決め打つと、**足した段（V4以降）に載せたテロップが
// この道具で一度も選ばれない**。実際に「新しく作ったレーンで効かないものが多い」
// として出ていた不具合の1つ。載れるのは「V1 以外の映像の段」——移動と同じ決まり。
//
// ## なぜ state/useTimelineDrag から出したか（2026-08-04）
//
// あちらは596行で話題が4つあった。記号解決で測ったら、この群は
// **受け取る1・返す0**——しかも受け取る1つは `SegLayout` の型だけで、
// 局所の名前は1つも要らなかった（`引き継ぎ-心臓の分け直し.md`）。
//
// ## 中身
//
// - `useTrackSelectTool` … `maybeTrackSelect` を返す唯一の入口
// - `trackSelect` … クリック位置から左／右を全部選ぶ（Shift でその段だけ）
// - `maybeTrackSelect` … この道具中なら選んで true。**各入口の先頭で呼ぶ**
import { type SegLayout } from '../lib/projectTypes'
import type { Cue } from '../lib/srt'
import type { Tool } from './useAppChrome'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'

export interface UseTrackSelectToolDeps {
  /** いまの道具（選択・レザー・トラック選択） */
  tool: Tool
  /** 段の当たり判定（state/useLaneGeometry） */
  laneAtY: (yRel: number) => string | null
  /** タイムラインの中身。当たり判定はこの矩形が基準 */
  trackInnerRef: React.RefObject<HTMLDivElement | null>
  /** 横の拡大率（px/秒） */
  zoomRef: React.MutableRefObject<number>
  /** 本編の並び（切片の時刻とレーン） */
  segLayout: SegLayout[]
  cueTrack: (c: Cue) => string
  trackNum: (id: string) => number
  /** 重ねた動画の長さ。**正典は shared/timeline の vcLen** */
  vcLen: (c: { srcStart: number; srcEnd: number }) => number
}

export function useTrackSelectTool(deps: UseTrackSelectToolDeps) {
  const { tool, laneAtY, trackInnerRef, zoomRef, segLayout, cueTrack, trackNum, vcLen } = deps
  const { cues, seClips, imgClips, vClips } = useDoc()
  const {
    setSelectedIds, setSelectedVideoIds, setSelectedAudioIds,
    setSelectedSeIds, setSelectedImgIds, setSelectedVClipIds,
    setSelectedTrackId, clearAll
  } = useSel()
  const { tracks } = useTracksCtx()

  // ---- トラック選択ツール（プレミア準拠: クリック位置から左/右を全選択）----
  /** 各トラック行の縦位置（trackInner の上端からの相対 px） */
  // 段の縦位置と落とし先の判定は shared/lanes（画面を起動せずに確かめられる）。
  // **外したときに本編へ落とさない**決まりもそこに書いてある

  function trackSelect(e: React.PointerEvent, dir: number): void {
    const inner = trackInnerRef.current
    if (!inner) return
    const rect = inner.getBoundingClientRect()
    const T = (e.clientX - rect.left) / zoomRef.current
    const single = e.shiftKey // Shift = マウスのいるレーンだけ
    const laneId = laneAtY(e.clientY - rect.top)
    const fwd = dir > 0
    const want = (id: string): boolean => !single || laneId === id
    // 右方向=クリップが T より右に伸びている / 左方向=T より左から始まっている
    // **テロップの段を V2・V3 と決め打ちにしない。**
    // 段を足した先（V4以降）に載せたテロップが、この道具で一度も選ばれなかった
    //（本人から「新しく作ったレーンで効かないものが多い」と出ていた物の1つ）。
    // テロップが載れるのは「V1 以外の映像の段」——移動の TELOP_ORDER と同じ決まり。
    const telopLane = (id: string | null): boolean =>
      !!id && id !== 'V1' && tracks.some((t) => t.id === id && t.kind === 'video')
    setSelectedIds(
      !single || telopLane(laneId)
        ? cues
            .filter(
              (c) => (fwd ? c.end > T : c.start < T) && (!single || cueTrack(c) === laneId)
            )
            .map((c) => c.id)
        : []
    )
    const segHit = (L: SegLayout): boolean => (fwd ? L.tEnd > T : L.tStart < T)
    setSelectedVideoIds(want('V1') ? segLayout.filter(segHit).map((L) => L.seg.id) : [])
    setSelectedAudioIds(want('A1') ? segLayout.filter(segHit).map((L) => L.seg.id) : [])
    // SE/BGM・画像は「そのクリップが載っているトラック」で判定（A2決め打ちにしない）
    const clipHit = (c: { tStart: number; duration: number }): boolean =>
      fwd ? c.tStart + c.duration > T : c.tStart < T
    setSelectedSeIds(
      seClips.filter((c) => want(c.track) && clipHit(c)).map((c) => c.id)
    )
    setSelectedImgIds(
      imgClips.filter((c) => want(c.track) && clipHit(c)).map((c) => c.id)
    )
    // 映像レイヤー（映像側の行 or 対の音声側の行を指していれば対象）
    setSelectedVClipIds(
      vClips
        .filter((c) => {
          const len = vcLen(c)
          const hit = fwd ? c.tStart + len > T : c.tStart < T
          return hit && (want(c.track) || want('A' + trackNum(c.track)))
        })
        .map((c) => c.id)
    )
  }
  // トラック選択ツール中なら選択して true。各ポインタハンドラの先頭で使う。
  function maybeTrackSelect(e: React.PointerEvent): boolean {
    if (tool !== 'trackFwd' && tool !== 'trackBack') return false
    if (e.button !== 0) return false
    e.stopPropagation()
    e.preventDefault()
    setSelectedTrackId(null)
    setSelectedIds([])
    clearAll()
    trackSelect(e, tool === 'trackFwd' ? 1 : -1)
    return true
  }

  return { maybeTrackSelect }
}

