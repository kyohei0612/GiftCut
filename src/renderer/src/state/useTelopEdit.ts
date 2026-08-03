// テロップを足す・書き換える・出入りの演出を付ける。
//
// ## 新しく足すときの段
//
// **本編（V1）には置かない。** そこは動画のカット列なので、テロップを置くと
// 映像と取り合いになる。V2 から上を使い、埋まっていれば段を足す。
//
// ## 出入りの演出（アニメ）
//
// クリップの頭と尻に別々に付く。掴んで落とした位置で頭か尻かが決まるので、
// 中央より手前なら頭、奥なら尻として扱う。
import { clamp } from '../../../shared/timeline'
import { firstFreeLane, type LaneItem } from '../../../shared/telopLane'
import { adjustRuns } from '../lib/textRuns'
import {
  defaultAnim,  hasAnim,  type AnimIn,
  type TelopAnim
} from '../lib/telopStyle'
import type { Cue } from '../lib/srt'
import { newTrackState } from '../lib/trackState'
import { DEFAULT_LABEL } from '../lib/labels'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'
import { useProjectStateCtx } from './projectStateContext'
import { usePlaybackCtx } from './playbackContext'
import { useExportCtx } from './exportContext'
import { useViewCtx } from './viewContext'
import { useIconsCtx } from './iconsContext'

export interface UseTelopEditDeps {
  cueTrack: (c: import('../lib/srt').Cue) => string
  telopLocked: (c: import('../lib/srt').Cue) => boolean
  idCounter: React.MutableRefObject<number>
  /** 段の名前から番号を取る（V2 → 2） */
  trackNum: (id: string) => number
  /* eslint-disable @typescript-eslint/no-explicit-any */
  /** 段を正しい並びで足す */
  insertTrackOrdered: any
  motionLabel: any
  /** 出入りの演出を掴んでいる最中か */
  draggingTelopAnimRef: any
  setRightTab: any
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export function useTelopEdit(deps: UseTelopEditDeps) {
  const { cueTrack, telopLocked, idCounter, trackNum, insertTrackOrdered, motionLabel, draggingTelopAnimRef, setRightTab } = deps
  const { cues, setCues, vClips, imgClips } = useDoc()
  const { selectedIds, setSelectedIds, selectedTelopTrans, setSelectedTelopTrans, setEditingId, isSelected, clearAll: clearAllSelections, setSelectedTrackId,
    setSelectedVideoIds, setSelectedAudioIds, setSelectedSeIds, 
     setSelectedTrans,  setVideoSelected,
     } = useSel()
  const { tracks, setTracks, trackStates, setTrackStates } = useTracksCtx()
  const { showToast } = useToastCtx()
  const { newTelopStyle,  } = useProjectStateCtx()
  const { currentTimeRef } = usePlaybackCtx()
  const { ratio } = useExportCtx()
  const { iconAuto, iconAnchorPos } = useIconsCtx()
  const { zoomRef } = useViewCtx()

  // アイコン画像をテロップにドロップして適用（個別上書き＋表示。選択の一部なら選択全部に）
  function applyIconToCue(cueId: number, image: string): void {
    const targets = selectedIds.includes(cueId) && selectedIds.length ? selectedIds : [cueId]
    setCues((prev) =>
      prev.map((c) =>
        targets.includes(c.id) ? { ...c, iconImage: image, personIcon: undefined } : c
      )
    )
    // 落とした先を選んでおく（テンプレートを落としたときと同じ扱い）
    setSelectedIds(targets)
  }

  // テロップを新規追加（再生ヘッド位置に2秒）
  // 新しいテロップを置くトラックを決める。
  // 再生ヘッドの位置に既にテロップがあれば1段上へ、無ければ既定の下段(V2)へ。
  // 以前は V2 決め打ちだったため、動画の退避で「テロップを V4 へ移しました」と
  // 出した直後に T を押すと、また V2 にテロップが作られていた。
  function trackForNewTelop(t: number): string {
    // 映像レイヤーが載っているトラックは V{n}/A{n} が対で予約されているので避ける
    const reservedByVideo = new Set(vClips.map((c) => c.track))
    const cands = tracks
      .filter(
        (tr) =>
          tr.kind === 'video' &&
          tr.id !== 'V1' &&
          !trackStates[tr.id]?.locked &&
          !reservedByVideo.has(tr.id)
      )
      .sort((a, b) => trackNum(a.id) - trackNum(b.id)) // 下段から順に見る
      .map((tr) => tr.id)
    // **相手はテロップだけではない。** 同じ段に画像が居ると、作った瞬間から
    // 文字が絵の裏に隠れる。重なりの決まり（頭だけ／尻だけ重なるのも避ける、
    // 端が接しているだけは重ならない）は `shared/telopLane` に置いてある
    const items: LaneItem[] = [
      ...cues.map((c) => ({ track: cueTrack(c), start: c.start, end: c.end })),
      ...imgClips.map((c) => ({ track: c.track, start: c.tStart, end: c.tStart + c.duration }))
    ]
    const free = firstFreeLane(cands, t, t + 2, items)
    if (free) return free
    // 全部埋まっている＝一番上の1段上に新しいトラックを作る
    const maxNum = Math.max(
      1,
      ...tracks.filter((x) => x.kind === 'video').map((x) => trackNum(x.id))
    )
    const id = 'V' + (maxNum + 1)
    setTracks((prev) =>
      prev.some((x) => x.id === id)
        ? prev
        : insertTrackOrdered(prev, { id, name: id, kind: 'video' })
    )
    setTrackStates((prev) => (prev[id] ? prev : { ...prev, [id]: newTrackState(id) }))
    return id
  }

  function addTelop(): void {
    const t = currentTimeRef.current
    const track = trackForNewTelop(t)
    const id = idCounter.current++
    const style = structuredClone(newTelopStyle) // テンプレで選んだ既定スタイルを使う
    // アイコン軸が有効なら新規テロップも軸に整列（アイコンが飛ばないように）
    if (iconAuto && iconAnchorPos) {
      style.anchor = { h: 'l', v: 'm' }
      style.align = 'left'
      delete style.box
    }
    const cue: Cue = {
      id,
      start: t,
      end: t + 2,
      // **空で作る。** 前は「テロップ」と入れていたが、追加したら必ず消してから
      // 打ち始めるので、消す手間が毎回増えるだけだった（本人の指定）。
      // 帯は色（ラベンダー）で見えるので、空でも見失わない
      text: '',
      style,
      label: DEFAULT_LABEL,
      pos: iconAuto && iconAnchorPos ? { ...iconAnchorPos } : { x: 0.5, y: 0.85 },
      track
    }
    setCues((prev) => [...prev, cue].sort((a, b) => a.start - b.start))
    clearAllSelections()
    setSelectedIds([id])
    // 既定の下段以外に置いたときだけ知らせる（どこに出たか分からなくなるため）
    if (track !== 'V2') showToast(track + ' にテロップを追加しました。')
  }

  function updateCueText(id: number, text: string): void {
    setCues((prev) =>
      prev.map((c) => (c.id === id ? { ...c, text, runs: adjustRuns(c.runs, c.text, text) } : c))
    )
  }

  function patchCueAnim(cueId: number, patch: Partial<TelopAnim>): void {
    setCues((prev) =>
      prev.map((c) => {
        if (c.id !== cueId) return c
        const cur = c.style.anim ?? defaultAnim()
        const next = { ...cur, ...patch }
        return { ...c, style: { ...c.style, anim: hasAnim(next) ? next : undefined } }
      })
    )
  }

  // 頭/尻にモーションを付与（長さは既存 or 既定0.3s）。
  function applyTelopAnimSide(cueId: number, kind: 'in' | 'out', type: AnimIn): void {
    const cur = cues.find((c) => c.id === cueId)?.style.anim ?? defaultAnim()
    if (kind === 'in') patchCueAnim(cueId, { in: type, inDur: cur.inDur > 0 ? cur.inDur : 0.3 })
    else patchCueAnim(cueId, { out: type, outDur: cur.outDur > 0 ? cur.outDur : 0.3 })
  }

  // 同じテロップトラック上で、指定テロップの直後に来る次のテロップ（間トランジション用）。
  function nextCueAfter(cue: Cue): Cue | null {
    const following = cues.filter(
      (c) => c.id !== cue.id && cueTrack(c) === cueTrack(cue) && c.start >= cue.end - 0.001
    )
    if (!following.length) return null
    return following.reduce((a, b) => (b.start < a.start ? b : a))
  }

  // テロップアニメD&D: テロップクリップ上のローカルXで 前半=in / 後半=out を判別。
  function resolveTelopTransDrop(
    cue: Cue,
    clientX: number,
    rect: DOMRect
  ): {
    kind: 'in' | 'out' | 'between'
    left: number
    width: number
    label: string
    outId?: number
    inId?: number
  } {
    // マウス位置で3分割: 前1/3=頭 / 中1/3=間(次テロップと) / 後1/3=尻。駐禁なし。
    const z = zoomRef.current
    const type = draggingTelopAnimRef.current?.type ?? 'fade'
    const len = cue.end - cue.start
    const wSec = Math.min(0.3, len)
    const w = wSec * z
    const bw = 0.3 // またぎ帯の総幅（各テロップに半分ずつ）
    const f = (clientX - rect.left) / Math.max(1, rect.width)
    if (f < 1 / 3)
      return { kind: 'in', left: cue.start * z, width: w, label: `頭 ${motionLabel(type)}` }
    if (f < 2 / 3) {
      // 間＝このテロップと次テロップの間。次が無ければ尻にフォールバック。
      const nb = nextCueAfter(cue)
      if (nb) {
        const boundary = (cue.end + nb.start) / 2
        return {
          kind: 'between',
          outId: cue.id,
          inId: nb.id,
          left: (boundary - bw / 2) * z,
          width: bw * z,
          label: `間 ${motionLabel(type)}（次のテロップと）`
        }
      }
    }
    return { kind: 'out', left: (cue.end - wSec) * z, width: w, label: `尻 ${motionLabel(type)}` }
  }

  function applyTelopTransDrop(cue: Cue, clientX: number, rect: DOMRect): void {
    if (telopLocked(cue)) return
    const drag = draggingTelopAnimRef.current
    if (!drag) return
    const r = resolveTelopTransDrop(cue, clientX, rect)
    if (r.kind === 'between' && r.outId != null && r.inId != null) {
      // 左テロップの尻＋右テロップの頭に同じモーション＝テロップ同士の間の切り替え
      applyTelopAnimSide(r.outId, 'out', drag.type)
      applyTelopAnimSide(r.inId, 'in', drag.type)
    } else {
      applyTelopAnimSide(cue.id, r.kind === 'between' ? 'in' : r.kind, drag.type)
    }
    // 落とした先を選んでおく（テンプレート・アイコンを落としたときと同じ扱い）。
    // 落とした直後は長さを詰めたくなるので、選ばれていないと押し直しが要る
    setSelectedIds(
      r.kind === 'between' && r.outId != null && r.inId != null ? [r.outId, r.inId] : [cue.id]
    )
  }

  // 帯クリックでテロップアニメを選択（クリップ本体は選択しない）。
  function selectTelopTrans(cueId: number, kind: 'in' | 'out'): void {
    setSelectedTrackId(null)
    setSelectedIds([])
    setEditingId(null)
    setSelectedVideoIds([])
    setSelectedAudioIds([])
    setSelectedSeIds([])
    setSelectedTrans(null)
    setVideoSelected(false)
    setSelectedTelopTrans({ cueId, kind })
    setRightTab('transition')
  }

  function updateTelopTransDur(dur: number): void {
    if (!selectedTelopTrans) return
    const { cueId, kind } = selectedTelopTrans
    patchCueAnim(cueId, kind === 'in' ? { inDur: dur } : { outDur: dur })
  }

  function setTelopTransType(type: AnimIn): void {
    if (!selectedTelopTrans) return
    const { cueId, kind } = selectedTelopTrans
    patchCueAnim(cueId, kind === 'in' ? { in: type } : { out: type })
  }

  function deleteSelectedTelopTrans(): void {
    if (!selectedTelopTrans) return
    const { cueId, kind } = selectedTelopTrans
    patchCueAnim(cueId, kind === 'in' ? { in: 'none' } : { out: 'none' })
    setSelectedTelopTrans(null)
  }

  // 強調（揺れ/脈動）は範囲を持たないので選択テロップにトグルで付与/解除。
  function toggleTelopEmphasis(em: 'shake' | 'pulse'): void {
    const ids = selectedIds.length ? selectedIds : selectedTelopTrans ? [selectedTelopTrans.cueId] : []
    if (!ids.length) {
      showToast('先にテロップを選択してください（またはタイムラインのテロップに帯をドラッグ）。')
      return
    }
    ids.forEach((id) => {
      const cur = cues.find((c) => c.id === id)?.style.anim
      patchCueAnim(id, { emphasis: cur?.emphasis === em ? 'none' : em })
    })
  }

  // 選択テロップをフレーム内の指定位置へ揃える（Excelの配置ボタン風。端に詰める）
  // 選択テロップをフレーム内の固定位置へ（現在位置に依らず、画面のその場所へ置く）
  function alignTelop(hx: 'l' | 'c' | 'r', vy: 't' | 'm' | 'b'): void {
    if (!selectedIds.length) return
    const mx = 0.05 // フレーム端の余白（幅比）
    const my = 0.07 // 〃（高さ比）
    const aspect = ratio === '16:9' ? 16 / 9 : ratio === '9:16' ? 9 / 16 : 1
    setCues((prev) =>
      prev.map((c) => {
        if (!isSelected(c.id)) return c
        if (c.style.box) {
          // 固定ボックスは中心配置なので、箱がフレーム内に収まる中心座標を計算
          const bwf = c.style.box.w / (1080 * aspect) // フレーム幅に対する箱幅比
          const bhf = c.style.box.h / 1080
          const x = hx === 'l' ? mx + bwf / 2 : hx === 'r' ? 1 - mx - bwf / 2 : 0.5
          const y = vy === 't' ? my + bhf / 2 : vy === 'b' ? 1 - my - bhf / 2 : 0.5
          return { ...c, pos: { x: clamp(x, 0, 1), y: clamp(y, 0, 1) } }
        }
        // 非ボックス: pos=フレーム内の固定点、anchor=その隅（箱のその隅が pos に来る＝はみ出さない）
        const x = hx === 'l' ? mx : hx === 'r' ? 1 - mx : 0.5
        const y = vy === 't' ? my : vy === 'b' ? 1 - my : 0.5
        return { ...c, pos: { x, y }, style: { ...c.style, anchor: { h: hx, v: vy } } }
      })
    )
  }

  return { applyIconToCue, trackForNewTelop, addTelop, updateCueText, patchCueAnim, applyTelopAnimSide, nextCueAfter, resolveTelopTransDrop, applyTelopTransDrop, selectTelopTrans, updateTelopTransDur, setTelopTransType, deleteSelectedTelopTrans, toggleTelopEmphasis, alignTelop }
}
