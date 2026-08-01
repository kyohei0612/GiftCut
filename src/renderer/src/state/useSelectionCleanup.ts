// 選んだ物が「もう無い物」を指し続けないよう、自動で掃除する。
//
// 消したり Undo で戻したりすると、選択だけが消えた物を指したまま残る。
// **放置すると右パネルが真っ白になり、Delete がそこに吸われて何も起きなくなる**
// （押しているのに反応しない、という一番分かりにくい壊れ方をする）。
//
// ## 中身が変わったときだけ走らせる
//
// 選択そのものを見張ると、掃除→選択が変わる→また掃除、と回り続ける。
// 見るのは中身（切片・テロップ・効果音・画像・目印・映像レイヤー）の方だけ。
//
// ## 変わっていなければ同じ配列を返す
//
// 毎回新しい配列を作ると、選択が変わっていなくても下流が全部作り直される。

import { useEffect } from 'react'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'

export function useSelectionCleanup(): void {
  const { cues, segments, seClips, imgClips, vClips, markers } = useDoc()
  const {
    selectedTrans, setSelectedTrans, selectedTelopTrans, setSelectedTelopTrans,
    setSelectedVideoIds, setSelectedAudioIds, setSelectedSeIds, setSelectedImgIds,
    setSelectedIds, selectedMarkerId, setSelectedMarkerId, setSelectedVClipIds,
    editingId, setEditingId
  } = useSel()
  // 選択が「もう存在しないもの」を指し続けないよう自動で掃除する。
  // 放置すると右パネルが真っ白になり、Delete がそこに吸われて無反応に見える。
  useEffect(() => {
    if (selectedTrans && !segments.some((s) => s.id === selectedTrans.segId))
      setSelectedTrans(null)
    if (selectedTelopTrans && !cues.some((c) => c.id === selectedTelopTrans.cueId))
      setSelectedTelopTrans(null)
    setSelectedVideoIds((prev) =>
      prev.length && prev.some((id) => !segments.some((s) => s.id === id))
        ? prev.filter((id) => segments.some((s) => s.id === id))
        : prev
    )
    setSelectedAudioIds((prev) =>
      prev.length && prev.some((id) => !segments.some((s) => s.id === id))
        ? prev.filter((id) => segments.some((s) => s.id === id))
        : prev
    )
    setSelectedSeIds((prev) =>
      prev.length && prev.some((id) => !seClips.some((c) => c.id === id))
        ? prev.filter((id) => seClips.some((c) => c.id === id))
        : prev
    )
    setSelectedImgIds((prev) =>
      prev.length && prev.some((id) => !imgClips.some((c) => c.id === id))
        ? prev.filter((id) => imgClips.some((c) => c.id === id))
        : prev
    )
    setSelectedIds((prev) =>
      prev.length && prev.some((id) => !cues.some((c) => c.id === id))
        ? prev.filter((id) => cues.some((c) => c.id === id))
        : prev
    )
    if (selectedMarkerId != null && !markers.some((m) => m.id === selectedMarkerId))
      setSelectedMarkerId(null)
    setSelectedVClipIds((prev) =>
      prev.length && prev.some((id) => !vClips.some((c) => c.id === id))
        ? prev.filter((id) => vClips.some((c) => c.id === id))
        : prev
    )
    if (editingId != null && !cues.some((c) => c.id === editingId)) setEditingId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, cues, seClips, imgClips, markers, vClips])
}
