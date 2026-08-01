// 掴んでいる最中に出す物を、どの区画からでも触れるようにする。
//
// 置き場所の考え方は state/layoutContext.tsx と同じ。
// **中身は入口（App）で作って渡す**（囲いの中で作ると、描き直しのたびに
// 作り直されて、掴んでいる途中の影や囲いが消える）。

import { createContext, useContext, type ReactNode } from 'react'
import type { DragPreview } from './useDragPreview'

const Ctx = createContext<DragPreview | null>(null)

export function DragPreviewProvider({
  value,
  children
}: {
  value: DragPreview
  children: ReactNode
}): React.JSX.Element {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** 掴んでいる最中の物を見に行く。囲いの外で呼んだら、その場で落とす */
export function useDragPreviewCtx(): DragPreview {
  const v = useContext(Ctx)
  if (!v) throw new Error('useDragPreviewCtx は DragPreviewProvider の中でしか使えません')
  return v
}
