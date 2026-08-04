// プレビューに出す「いまの絵」（回転・拡大・つなぎ目の演出を1枚に合成した物）を、
// どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `usePreviewFrame` が要る5つは**全部すでに心臓から取れる**のに、配線が
// わざわざ取り出して渡し、返ってきた8つを束へ詰め直して心臓へ戻していた
//（`npm run passthrough` の「往復」）。ここで直に取れば、配線から名前が消える。
//
// **中身はここで作る。** 上（App）で作って渡すと、囲いを描き直すたびに
// 作り直される。
//
// ## 出す値は毎回作り直しでよい
//
// 中身は全部**その場で計算した見た目**（transform 文字列・重ねる色）で、
// 持ち越す物が1つも無い。`useMemo` で包んでも中の object が毎回変わるので
// 効かない——包まないことを選んである。
//
// ## 中身
//
// - `PreviewFrameValue` … `usePreviewFrame` が返す物（**手で書かず実体から引く**）
// - `PreviewFrameProvider` … 囲い。中で `usePreviewFrame()` を1回だけ呼ぶ
// - `usePreviewFrameCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useCurrentLookCtx } from './currentLookContext'
import { useMediaCtx } from './mediaContext'
import { useProxyCtx } from './proxyContext'
import { useSegLayoutCtx } from './segLayoutContext'
import { usePreviewFrame } from './usePreviewFrame'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type PreviewFrameValue = ReturnType<typeof usePreviewFrame>

const Ctx = createContext<PreviewFrameValue | null>(null)

export function PreviewFrameProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { segLayout } = useSegLayoutCtx()
  const { srcOfSeg } = useMediaCtx()
  const { curSegZoom, curCropInset } = useCurrentLookCtx()
  const { previewUrl } = useProxyCtx()
  const value = usePreviewFrame({ segLayout, srcOfSeg, curSegZoom, curCropInset, previewUrl })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** プレビューの「いまの絵」を見に行く。囲いの外で呼んだら、その場で落とす */
export function usePreviewFrameCtx(): PreviewFrameValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePreviewFrameCtx は PreviewFrameProvider の中でしか使えません')
  return v
}
