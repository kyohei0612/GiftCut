// 書き出しの設定を、どの区画からでも触れるようにする。
// 置き場所の考え方は state/layoutContext.tsx と同じ。

import { createContext, useContext, type ReactNode } from 'react'
import { useExportSettings, type ExportSettings } from './useExportSettings'

const Ctx = createContext<ExportSettings | null>(null)

export function ExportProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useExportSettings()}>{children}</Ctx.Provider>
}

/** 書き出しの設定を見に行く。囲いの外で呼んだら、その場で落とす */
export function useExportCtx(): ExportSettings {
  const v = useContext(Ctx)
  if (!v) throw new Error('useExportCtx は ExportProvider の中でしか使えません')
  return v
}
