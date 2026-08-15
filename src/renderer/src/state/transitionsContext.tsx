// つなぎ目の演出（トランジション）の選択・付け外しを、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// 要る9つは全部すでに心臓から取れる。**最後まで詰まっていたのは `setRightTab`
// 1つだけ**で、それも「演出を付けたら演出のタブへ切り替える」ために書くだけ
// だった。`useAppChrome` へ移して解けた（`npm run passthrough`）。
//
// ## 中身
//
// - `TransitionsValue` … `useTransitions` が返す物（**手で書かず実体から引く**）
// - `TransitionsProvider` … 囲い。中で `useTransitions()` を1回だけ呼ぶ
// - `useTransitionsCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useAppChromeCtx } from './appChromeContext'
import { useBandDragCtx } from './bandDragContext'
import { useProjectStateCtx } from './projectStateContext'
import { useSegLayoutCtx } from './segLayoutContext'
import { useSel } from './selectionContext'
import { useTimelineBoxCtx } from './timelineBoxContext'
import { useTracksAdminCtx } from './tracksAdminContext'
import { useTransitions } from './useTransitions'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type TransitionsValue = ReturnType<typeof useTransitions>

const Ctx = createContext<TransitionsValue | null>(null)

export function TransitionsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { segLayout, segLayoutRef } = useSegLayoutCtx()
  const { draggingTransRef } = useBandDragCtx()
  const { trackInnerRef } = useTimelineBoxCtx()
  const { setRightTab } = useAppChromeCtx()
  const { clearSegSel } = useSel()
  const { mainLocked } = useTracksAdminCtx()
  const { transDur } = useProjectStateCtx()
  const value = useTransitions({
    segLayout, segLayoutRef, draggingTransRef, trackInnerRef, setRightTab,
    clearSegSel, mainLocked, transDur
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** つなぎ目の演出を見に行く。囲いの外で呼んだら、その場で落とす */
export function useTransitionsCtx(): TransitionsValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTransitionsCtx は TransitionsProvider の中でしか使えません')
  return v
}
