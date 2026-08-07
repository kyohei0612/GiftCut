// 再生の「今」を、どの区画からでも触れるようにする。
//
// 置き場所の考え方は state/layoutContext.tsx と同じ。
//
// ## **中身はここで作る**（2026-08-08 に App から移した）
//
// 前は「入口（App）で作って渡す」と書いてあり、そうしていた。**それが
// アプリ全体を毎秒60回作り直していた。**
//
// `currentTime` は再生中 60回/秒 変わる。持ち主が App だったので、
// **変わるたびに App 自身が作り直され**、下にある物が全部巻き添えになる
//（タイムラインの帯には `memo` が無い）。**切れば切るほど1回が重くなるので、
// 編集を続けるほど悪化する。**
//
// 実測（本人のプレテスト）。作り直しが増えるほど、絵の遅れがそのまま増えた:
//
//   作り直し 18回/秒 → 遅れ   0ms
//   　　　　 61回/秒 → 遅れ  56ms
//   　　　　 79回/秒 → 遅れ 339ms
//
// **囲いの中で作れば、作り直されるのは囲いだけ。** 子は同じ物が渡るので
// React が飛ばす（見に行っている所だけが作り直される）。
// このリポジトリの他の囲い（`ContentProvider` `IconsProvider` `ExportProvider` …）は
// 元からこの形で、**`playback` が数少ない例外だった。**
//
// ※ 「囲いの中で作ると描き直しのたびに作り直される」と書いてあったが、
//   **囲いは自分の state が変わった時しか描き直さない**ので、持っていた値は消えない。
//   `value` を渡す形の方が、渡す側（App）を巻き込むぶん危ない。
//
// ## `currentTime` が要らない所は `currentTimeRef` を見ること
//
// **context は「どの項目を読んだか」では分けられない。** 分割代入から外しても、
// 同じ囲いを見に行っていれば作り直される（2026-08-08 にそれで一度失敗した）。
// 毎コマの値が要らないなら、**囲いではなく ref を見る**。

import { createContext, useContext, type ReactNode } from 'react'
import { FPS } from '../lib/appConst'
import { usePlayback, type Playback } from './usePlayback'

const Ctx = createContext<Playback | null>(null)

export function PlaybackProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={usePlayback(FPS)}>{children}</Ctx.Provider>
}

/** 再生の「今」を見に行く。囲いの外で呼んだら、その場で落とす */
export function usePlaybackCtx(): Playback {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePlaybackCtx は PlaybackProvider の中でしか使えません')
  return v
}
