// プレビューの画質と、焼き直した映像（プロキシ）を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// 要る物が全部 心臓にあるのに、配線が呼んで各フックへ配っていた。
// 上げると、これを待っていたフックも順に上げられるようになる（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `ProxyValue` … `useProxy` が返す物（**手で書かず実体から引く**）
// - `ProxyProvider` … 囲い。中で要る物を心臓から読んで1回だけ呼ぶ
// - `useProxyCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useDoc } from './contentContext'
import { useMediaCtx } from './mediaContext'
import { usePlaybackCtx } from './playbackContext'
import { useLibraryCtx } from './libraryContext'
import { useAppChromeCtx } from './appChromeContext'
import { useProxy } from './useProxy'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type ProxyValue = ReturnType<typeof useProxy>

const Ctx = createContext<ProxyValue | null>(null)

export function ProxyProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { loadLS, saveLS } = useLibraryCtx()
  const { playRateRef } = usePlaybackCtx()
  const { sources, setProxyPct } = useMediaCtx()
  const { vClips } = useDoc()
  const { proxyForPathRef } = useAppChromeCtx()
  const value = useProxy({ loadLS, saveLS, playRateRef, sources, vClips, proxyForPathRef, setProxyPct })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** プレビューの画質と、焼き直した映像（プロキシ）を見に行く。囲いの外で呼んだら、その場で落とす */
export function useProxyCtx(): ProxyValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useProxyCtx は ProxyProvider の中でしか使えません')
  return v
}
