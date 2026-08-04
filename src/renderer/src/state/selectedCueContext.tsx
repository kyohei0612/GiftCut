// 「いま設定パネルが見ているテロップ」＝選んでいるうちの先頭を、
// どの区画からでも触れるようにする。
//
// ## なぜ1行のために囲いを作るか（2026-08-04）
//
// 中身は `cues.find(c => c.id === selectedIds[0])` の1行だが、**これを配線が
// 持っていたせいで3本のフックが上げられなかった**（`npm run passthrough` の
// 「詰まりの根」で最多）。選んだ物と中身の**両方**を見ないと出せないので、
// `selectionContext` にも `contentContext` にも置けない。
//
// ## `selectedIds[0]` を各所で書き直さないこと
//
// 「先頭が代表」という決まりはここだけが持つ。写すと、複数選択の扱いを
// 変えたときに片方だけ直る（このリポジトリで何度も出ている型）。
//
// ## 中身
//
// - `SelectedCueValue` … 先頭の id と、その中身
// - `SelectedCueProvider` … 囲い
// - `useSelectedCue` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import type { Cue } from '../lib/srt'

export interface SelectedCueValue {
  /** 選んでいるテロップの先頭の id（何も選んでいなければ null） */
  primaryId: number | null
  /** その中身。id が消えている（消した直後など）なら null */
  selected: Cue | null
}

const Ctx = createContext<SelectedCueValue | null>(null)

export function SelectedCueProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { cues } = useDoc()
  const { selectedIds } = useSel()
  const value = useMemo(() => {
    const primaryId = selectedIds[0] ?? null
    return { primaryId, selected: cues.find((c) => c.id === primaryId) ?? null }
  }, [cues, selectedIds])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** 選んでいるテロップの先頭を見に行く。囲いの外で呼んだら、その場で落とす */
export function useSelectedCue(): SelectedCueValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSelectedCue は SelectedCueProvider の中でしか使えません')
  return v
}
