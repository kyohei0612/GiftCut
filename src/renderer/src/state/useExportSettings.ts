// 書き出しの設定と、その進み具合。
//
// ## なぜ心臓に置くか
//
// **設定はプロジェクトの一部で、進み具合は画面の一部。**
// 右パネルは設定を出し、画面の上の帯は進み具合を出し、書き出しの本体は
// 両方を読む。App.tsx に置いたままだと、区画を切り出すたびに一式を渡すことになる。
//
// ## fps を「素材と同じ」にしてある理由
//
// 素材が60fpsなのに黙って30に落ちると、動きがカクついた物ができあがる。
// しかも書き出してから気づく。既定は「素材と同じ」にして、実際の数値への
// 読み替えは**書き出す直前**に行う（素材を差し替えても付いてくる）。

import { useState } from 'react'
import type { ExportOpts } from '../components/dialogs/ProjectDialogs'

/** 画面の縦横比 */
export type Ratio = '16:9' | '9:16' | '1:1'

export interface ExportSettings {
  /** 画面の縦横比（プロジェクトに保存される） */
  ratio: Ratio
  setRatio: React.Dispatch<React.SetStateAction<Ratio>>
  /** 全体の音量 */
  masterVolume: number
  setMasterVolume: React.Dispatch<React.SetStateAction<number>>
  /** 音の大きさを揃える目標（null＝揃えない） */
  loudnormLUFS: number | null
  setLoudnormLUFS: React.Dispatch<React.SetStateAction<number | null>>
  /** 解像度・fps・画質 */
  exportOpts: ExportOpts
  setExportOpts: React.Dispatch<React.SetStateAction<ExportOpts>>
  /** 設定の窓を出しているか。**押してすぐ始めない**（やり直しが利かないので） */
  showExportDialog: boolean
  setShowExportDialog: React.Dispatch<React.SetStateAction<boolean>>
  /** いま何をしているか（null＝書き出していない） */
  exportStatus: string | null
  setExportStatus: React.Dispatch<React.SetStateAction<string | null>>
  /** 進み具合（null＝まだ割合が出せない段階） */
  exportPct: number | null
  setExportPct: React.Dispatch<React.SetStateAction<number | null>>
}

export function useExportSettings(): ExportSettings {
  const [ratio, setRatio] = useState<Ratio>('16:9')
  const [masterVolume, setMasterVolume] = useState(1)
  const [loudnormLUFS, setLoudnormLUFS] = useState<number | null>(-14)
  const [exportOpts, setExportOpts] = useState<ExportOpts>({
    resP: 1080,
    fps: 'source',
    quality: 'high'
  })
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [exportPct, setExportPct] = useState<number | null>(null)

  return {
    ratio,
    setRatio,
    masterVolume,
    setMasterVolume,
    loudnormLUFS,
    setLoudnormLUFS,
    exportOpts,
    setExportOpts,
    showExportDialog,
    setShowExportDialog,
    exportStatus,
    setExportStatus,
    exportPct,
    setExportPct
  }
}
