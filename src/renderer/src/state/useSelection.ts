// 「いま何を選んでいるか」を、ひとまとまりで持つ。
//
// ## なぜまとめるか
//
// **選べる物が13種類あって、それぞれ別の状態に散っていた。**
// テロップ・動画の切片（映像／音を別々に）・効果音・画像・映像クリップ・
// トランジション・テロップの出入り・トラック・目印・素材ビン・
// プレビューの枠——どれも「選んでいる」だけなのに、置き場所が13か所ある。
//
// これが原因で、**解除が部分的にしか効かない**事故が繰り返し起きた。
// 消し忘れた1つが残っていて、
//
//   ・動画クリップを消したのに、目印だけ消える
//   ・Ctrl+A → Delete が無反応
//   ・プレビューの枠から抜けられない
//
// が同時に出ていた。解除の入口を1つにするために、まず持ち場を1つにする。
//
// ## 決まりごと
//
// **解除は必ず clearAll を通す。** 部分的に消したいときだけ個別に触る。
// 新しく「選べる物」を足したら、clearSegSel か clearAll に必ず足すこと
//（足し忘れると、上の事故がそのまま戻ってくる）。

import { useState } from 'react'

/** 動画クリップのトランジション（頭・尻・カット間） */
export interface TransSel {
  segId: number
  kind: 'in' | 'out' | 'xfade'
}
/** テロップの出入りアニメ */
export interface TelopTransSel {
  cueId: number
  kind: 'in' | 'out'
}

export interface Selection {
  /** テロップ */
  selectedIds: number[]
  setSelectedIds: React.Dispatch<React.SetStateAction<number[]>>
  /** 動画の切片。映像と音を別々に選べる（音だけ差し替える作業があるため） */
  selectedVideoIds: number[]
  setSelectedVideoIds: React.Dispatch<React.SetStateAction<number[]>>
  selectedAudioIds: number[]
  setSelectedAudioIds: React.Dispatch<React.SetStateAction<number[]>>
  /** 効果音・画像・映像クリップ */
  selectedSeIds: number[]
  setSelectedSeIds: React.Dispatch<React.SetStateAction<number[]>>
  selectedImgIds: number[]
  setSelectedImgIds: React.Dispatch<React.SetStateAction<number[]>>
  selectedVClipIds: number[]
  setSelectedVClipIds: React.Dispatch<React.SetStateAction<number[]>>
  /** つなぎ目の演出 */
  selectedTrans: TransSel | null
  setSelectedTrans: React.Dispatch<React.SetStateAction<TransSel | null>>
  selectedTelopTrans: TelopTransSel | null
  setSelectedTelopTrans: React.Dispatch<React.SetStateAction<TelopTransSel | null>>
  /** 段（トラック）そのもの。残ったまま Delete するとトラック削除に化ける */
  selectedTrackId: string | null
  setSelectedTrackId: React.Dispatch<React.SetStateAction<string | null>>
  /** 目印 */
  selectedMarkerId: number | null
  setSelectedMarkerId: React.Dispatch<React.SetStateAction<number | null>>
  editingMarkerId: number | null
  setEditingMarkerId: React.Dispatch<React.SetStateAction<number | null>>
  /** 文字を打ち替え中のテロップ */
  editingId: number | null
  setEditingId: React.Dispatch<React.SetStateAction<number | null>>
  /** 素材ビンで選んでいる物 */
  selectedMediaId: number | null
  /** 素材ビンの選択。**押した順**（まとめて置くときの並び） */
  selectedMediaIds: number[]
  setSelectedMediaIds: React.Dispatch<React.SetStateAction<number[]>>
  /** 1つだけ選ぶ（null で全部外す）。まとめ選択は setSelectedMediaIds */
  setSelectedMediaId: (id: number | null) => void
  /** プレビューの枠を出しているか（残るとホイールが拡大縮小になる） */
  videoSelected: boolean
  setVideoSelected: React.Dispatch<React.SetStateAction<boolean>>

  isSelected: (id: number) => boolean
  isVideoSel: (id: number) => boolean
  isAudioSel: (id: number) => boolean
  anySegSelected: () => boolean
  /** テロップ以外を解除（テロップは残す） */
  clearSegSel: () => void
  /** **解除の唯一の入口。** 全部消す */
  clearAll: () => void
}

export function useSelection(): Selection {
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [selectedVideoIds, setSelectedVideoIds] = useState<number[]>([])
  const [selectedAudioIds, setSelectedAudioIds] = useState<number[]>([])
  const [selectedSeIds, setSelectedSeIds] = useState<number[]>([])
  const [selectedImgIds, setSelectedImgIds] = useState<number[]>([])
  const [selectedVClipIds, setSelectedVClipIds] = useState<number[]>([])
  const [selectedTrans, setSelectedTrans] = useState<TransSel | null>(null)
  const [selectedTelopTrans, setSelectedTelopTrans] = useState<TelopTransSel | null>(null)
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null)
  const [selectedMarkerId, setSelectedMarkerId] = useState<number | null>(null)
  const [editingMarkerId, setEditingMarkerId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  /**
   * 素材ビンで選んでいる物。**押した順を覚える。**
   *
   * まとめてタイムラインへ置くとき、その順に並べる（本人の指定）。
   * 順番を捨てて集合にすると「押した順」が作れない。
   *
   * ※ 1つだけ扱う所のために `selectedMediaId`（最後に押した物）も出しておく。
   *   使う側を全部書き換えると、まとめ選択と関係ない所まで触ることになる。
   */
  const [selectedMediaIds, setSelectedMediaIds] = useState<number[]>([])
  const selectedMediaId = selectedMediaIds.length
    ? selectedMediaIds[selectedMediaIds.length - 1]
    : null
  const setSelectedMediaId = (id: number | null): void =>
    setSelectedMediaIds(id == null ? [] : [id])
  const [videoSelected, setVideoSelected] = useState(false)

  const clearSegSel = (): void => {
    setSelectedVideoIds([])
    setSelectedAudioIds([])
    setSelectedSeIds([])
    setSelectedImgIds([])
    setSelectedVClipIds([])
    setSelectedTrans(null)
    setSelectedTelopTrans(null)
    // 目印も外す（残っていると Delete が目印の削除に横取りされる）
    setSelectedMarkerId(null)
  }

  const clearAll = (): void => {
    clearSegSel()
    setSelectedIds([]) // テロップ
    setSelectedTrackId(null) // 段（残ると Delete がトラック削除に化ける）
    setVideoSelected(false) // プレビューの枠（残るとホイールが拡大縮小になる）
    setSelectedMediaId(null) // 素材ビン（残ると Delete の対象が分からなくなる）
  }

  return {
    selectedIds,
    setSelectedIds,
    selectedVideoIds,
    setSelectedVideoIds,
    selectedAudioIds,
    setSelectedAudioIds,
    selectedSeIds,
    setSelectedSeIds,
    selectedImgIds,
    setSelectedImgIds,
    selectedVClipIds,
    setSelectedVClipIds,
    selectedTrans,
    setSelectedTrans,
    selectedTelopTrans,
    setSelectedTelopTrans,
    selectedTrackId,
    setSelectedTrackId,
    selectedMarkerId,
    setSelectedMarkerId,
    editingMarkerId,
    setEditingMarkerId,
    editingId,
    setEditingId,
    selectedMediaId,
    selectedMediaIds,
    setSelectedMediaIds,
    setSelectedMediaId,
    videoSelected,
    setVideoSelected,
    isSelected: (id) => selectedIds.includes(id),
    isVideoSel: (id) => selectedVideoIds.includes(id),
    isAudioSel: (id) => selectedAudioIds.includes(id),
    anySegSelected: () => selectedVideoIds.length > 0 || selectedAudioIds.length > 0,
    clearSegSel,
    clearAll
  }
}
