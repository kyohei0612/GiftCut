// 画面の配置を、どの区画からでも触れるようにする。
//
// ## なぜ props で渡さないか
//
// **試しに左パネルを部品にしたら、App から渡す物が73個になった。**
// 22が状態で、51が操作。props で渡す形だと、区画を切り出すたびに
// この受け渡しが増えて、App は小さくなっても全体は読みにくくなる。
//
// 代わりに「区画が自分で見に行く」形にする。区画は props を受け取らず、
// `useLayout()` を呼ぶだけでよくなる。
//
// ## 置き場所の決まり
//
// ここに入れるのは**区画をまたいで使う物だけ**。
// その区画の中だけで使う物は、その区画に置いたままにする
// （何でもここに入れると、結局1か所に全部集まる形に戻る）。

import { createContext, useContext, type ReactNode } from 'react'
import { usePanelLayout, type PanelLayout } from './usePanelLayout'

const Ctx = createContext<PanelLayout | null>(null)

export function LayoutProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const layout = usePanelLayout()
  return <Ctx.Provider value={layout}>{children}</Ctx.Provider>
}

/**
 * 画面の配置を見に行く。
 *
 * **囲いの外で呼んだら、その場で落とす。** 黙って既定値を返すと、
 * 「動かしても幅が変わらない」という形で表に出て、原因を探すのに時間がかかる。
 */
export function useLayout(): PanelLayout {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLayout は LayoutProvider の中でしか使えません')
  return v
}
