// 画面の配置（切り離し・幅と高さ・タブ帯・品書きの位置）を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useAppLayout` が要る20個は**全部すでに心臓から取れる**のに、配線が
// 取り出して渡し、返ってきた11個を束へ詰め直して心臓へ戻していた。
// ここで直に取れば、その31個が配線から消える（`npm run passthrough`）。
//
// **最後まで詰まっていたのは `rightTab` と `PANE_LABEL` の2つだけ**だった。
// 前者は `useAppChrome` へ、後者は `usePanelLayout` へ出して解けた。
//
// ## 中身
//
// - `AppLayoutValue` … `useAppLayout` が返す物（**手で書かず実体から引く**）
// - `AppLayoutProvider` … 囲い。中で `useAppLayout()` を1回だけ呼ぶ
// - `useAppLayoutCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useAppChromeCtx } from './appChromeContext'
import { useLaneHeightsCtx } from './laneHeightsContext'
import { useLayout } from './layoutContext'
import { useAppLayout } from './useAppLayout'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type AppLayoutValue = ReturnType<typeof useAppLayout>

const Ctx = createContext<AppLayoutValue | null>(null)

export function AppLayoutProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const {
    leftW, setLeftW, rightW, setRightW, timelineH, setTimelineH,
    monitorTab, setMonitorTab, tabOrder, setTabOrder,
    popped, setPopped, paneGeom, setPaneGeom
  } = useLayout()
  const { videoTrackH, setVideoTrackH, audioTrackH, setAudioTrackH } = useLaneHeightsCtx()
  const { rightTab, setRightTab } = useAppChromeCtx()
  const value = useAppLayout({
    popped, setPopped, paneGeom, setPaneGeom,
    leftW, setLeftW, rightW, setRightW, timelineH, setTimelineH,
    videoTrackH, setVideoTrackH, audioTrackH, setAudioTrackH,
    tabOrder, setTabOrder, rightTab, setRightTab, monitorTab, setMonitorTab
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** 画面の配置を見に行く。囲いの外で呼んだら、その場で落とす */
export function useAppLayoutCtx(): AppLayoutValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAppLayoutCtx は AppLayoutProvider の中でしか使えません')
  return v
}
