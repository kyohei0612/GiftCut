// 字幕づくり（音声から文字起こし）の設定と、いまの進み具合。
//
// ## なぜ押してすぐ走らせないか
//
// 何分もかかるうえ、途中でやめても書きかけが残る。必ず確認の窓を挟む。
// 窓を開けたときに「準備が手元にあるか」を聞くのも、**落とす大きさを
// 先に見せるため**（1.6GB を黙って落とし始めると回線を使い切る）。
import { useEffect, useState } from 'react'
import type { SubtitlePhase, SubtitleModel } from '../components/dialogs/SubtitleDialog'

export function useSubtitlePrefs() {
  const [subtitleOpen, setSubtitleOpen] = useState(false)
  const [subtitleState, setSubtitleState] = useState<SubtitlePhase>({ phase: 'idle' })

  /**
   * 1行の文字数。**描き直しの最中に走る**ので、共通の読み書き（loadLS）は
   * 使えない（定義がこれより後ろにあるため）。直に読む。
   */
  const [subMaxChars, setSubMaxChars] = useState<number>(() => {
    const v = Number(localStorage.getItem('giftcut.subMaxChars'))
    return v >= 10 && v <= 30 ? v : 17
  })
  const [subReplace, setSubReplace] = useState(true)

  const [subModel, setSubModel] = useState<SubtitleModel>({
    ready: false,
    label: 'large-v3-turbo',
    sizeMB: 1600
  })

  // 窓を開けたら、準備が手元にあるかを聞く（落とす大きさを先に見せるため）
  useEffect(() => {
    if (!subtitleOpen) return
    void window.giftcut?.subtitleStatus?.().then((r) => {
      if (!r?.ok) return
      setSubModel({ ready: r.exe && r.model, label: r.label, sizeMB: r.sizeMB })
    })
  }, [subtitleOpen])

  return {
    subtitleOpen,
    setSubtitleOpen,
    subtitleState,
    setSubtitleState,
    subMaxChars,
    setSubMaxChars,
    subReplace,
    setSubReplace,
    subModel
  }
}
