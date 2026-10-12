// 画像の背景を透過する（切り抜き）。**設定は素材ビンの画像ごと**に持つ。
//
// ## 流れ
//
//   1. ビンの画像で「透過」を押す → editingId にその画像（窓が開く・CutoutDialog）
//   2. 窓は元画像を読み、模型の答え（computeMatte）と設定から見た目を作って見せる
//   3. 適用 → render が PNG を作って main に置き（userData/giftcut-cutouts）、
//      画像に cutoutPath を付ける
//   4. 画面・書き出し・スクショは displayPathOf(path) で「透過済みのパス」を引く
//
// ## 元画像が外から書き換えられたら、同じ設定で作り直す
//
// 素材は参照のまま（2026-10-11 の決まり）。置き場の画像を別の物にしたら、透過も
// その新しい絵に掛かり直す。設定だけがプロジェクトに入っていて、出来上がりは派生物。
//
// ## 模型は初回に落とす
//
// 自動の抜き方（method: 'auto'）だけが模型（179MB）を要る。無ければ窓の中で落とす
// （進み具合は modelState）。色で抜く（'color'）は模型なしで動く。
//
// ## 中身
//
// - `useCutout`     … 本体
//   - `ensureModel`  … 模型が手元に無ければ落とす
//   - `computeMatte` … 模型に背景を当ててもらう（同じ画像の同じ版は使い回す）
//   - `render`       … 設定どおりの PNG を作って置く
//   - `saveSettings` … 設定と出来上がりを画像に付ける
// - `keyFor`        … 元画像のパス → 出来上がりの名前（同じ画像は同じ名前で上書き）
// - `samePath`      … Windows の大文字小文字と区切りを無視して同じパスか

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMediaCtx } from './mediaContext'
import { useToastCtx } from './toastContext'
import { useFileRevCtx } from './fileRevContext'
import { toGcUrl } from '../lib/gcUrl'
import type { MediaItem } from '../components/panels/ProjectBinTab'
import type { CutoutSettings } from '../lib/cutout/types'
import {
  alphaForSettings, encodePng, loadRgba, resizeAlpha, resizeRgba, type RgbaImage
} from '../lib/cutout/render'
import { MODEL_SIZE, loadSession, runMatte, type OrtFiles } from '../lib/cutout/model'
import { composeAlpha, type Alpha } from '../lib/cutout/mask'

export type CutoutModelState =
  | { phase: 'idle' }
  | { phase: 'download'; percent: number }
  | { phase: 'load' }
  | { phase: 'run' }
  | { phase: 'error'; message: string }

export const samePath = (a: string, b: string): boolean =>
  a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

export function keyFor(path: string): string {
  const s = path.replace(/\\/g, '/').toLowerCase()
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  const base = s.split('/').pop()?.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) ?? 'img'
  return `${base}-${h.toString(16)}`
}

export function useCutout() {
  const { mediaItems, setMediaItems } = useMediaCtx()
  const { showToast } = useToastCtx()
  const { urlOf, revOf, bump } = useFileRevCtx()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [modelState, setModelState] = useState<CutoutModelState>({ phase: 'idle' })
  /** 模型の答え（元画像の大きさ）。同じ画像の同じ版なら使い回す（1枚数秒〜数十秒） */
  const matteCache = useRef(new Map<string, Alpha>())
  const itemsRef = useRef(mediaItems)
  itemsRef.current = mediaItems

  const itemFor = (path: string): MediaItem | undefined =>
    itemsRef.current.find((m) => m.kind === 'image' && samePath(m.path, path))

  /** 画面・書き出し・スクショが見るパス。透過を使っていればその PNG */
  const displayPathOf = useCallback(
    (path: string): string => {
      const m = mediaItems.find((x) => x.kind === 'image' && samePath(x.path, path))
      return m?.cutout?.enabled && m.cutoutPath ? m.cutoutPath : path
    },
    [mediaItems]
  )

  async function ensureModel(): Promise<{ modelUrl: string; ort: OrtFiles } | null> {
    const st = await window.giftcut.cutoutStatus()
    let modelPath = st.modelPath
    if (!modelPath) {
      setModelState({ phase: 'download', percent: 0 })
      const off = window.giftcut.onCutoutProgress(({ percent }) =>
        setModelState({ phase: 'download', percent })
      )
      const r = await window.giftcut.cutoutFetchModel()
      off()
      if (!r.ok || !r.path) {
        setModelState({ phase: 'error', message: r.error ?? '模型を落とせませんでした' })
        return null
      }
      modelPath = r.path
    }
    return {
      modelUrl: toGcUrl(modelPath),
      ort: { mjs: st.ort.mjs ? toGcUrl(st.ort.mjs) : undefined, wasm: st.ort.wasm ? toGcUrl(st.ort.wasm) : undefined }
    }
  }

  /** 模型に背景を当ててもらう。模型が無ければ落としてから。失敗は null（窓が文言を出す） */
  async function computeMatte(path: string, src: RgbaImage): Promise<Alpha | null> {
    const key = `${path}@${revOf(path)}`
    const hit = matteCache.current.get(key)
    if (hit) return hit
    const m = await ensureModel()
    if (!m) return null
    try {
      setModelState({ phase: 'load' })
      const session = await loadSession(m.modelUrl, m.ort)
      setModelState({ phase: 'run' })
      const matte1024 = await runMatte(session, resizeRgba(src, MODEL_SIZE, MODEL_SIZE))
      const matte = resizeAlpha(matte1024, MODEL_SIZE, MODEL_SIZE, src.w, src.h)
      matteCache.current.set(key, matte)
      setModelState({ phase: 'idle' })
      return matte
    } catch (e) {
      setModelState({ phase: 'error', message: `自動の切り抜きに失敗: ${String(e)}` })
      return null
    }
  }

  const loadSource = (path: string): Promise<RgbaImage> => loadRgba(urlOf(path))

  /** 設定どおりの PNG を作って置く。返るのは置いたパス（失敗は null） */
  async function render(
    path: string,
    settings: CutoutSettings,
    src?: RgbaImage,
    matte?: Alpha | null
  ): Promise<string | null> {
    const image = src ?? (await loadSource(path))
    const m = settings.method === 'auto' ? (matte ?? (await computeMatte(path, image))) : null
    const alpha = alphaForSettings(image, m, settings)
    const png = await encodePng(composeAlpha(image.rgba, alpha), image.w, image.h)
    const r = await window.giftcut.cutoutSave(keyFor(path), png)
    if (!r.ok || !r.path) {
      showToast(`透過した画像を置けませんでした: ${r.error ?? ''}`, 'error')
      return null
    }
    // 同じ名前で上書きするので、画面が古い絵を使い回さないように版を上げる
    bump(r.path)
    return r.path
  }

  /** 設定と出来上がりを画像に付ける（cutoutPath を渡さなければ今の物を残す） */
  function saveSettings(mediaId: number, settings: CutoutSettings, cutoutPath?: string | null): void {
    setMediaItems((prev) =>
      prev.map((m) =>
        m.id === mediaId
          ? { ...m, cutout: settings, cutoutPath: cutoutPath === undefined ? m.cutoutPath : (cutoutPath ?? undefined) }
          : m
      )
    )
  }

  // 元画像が外から書き換えられた → 同じ設定で作り直す（素材は参照のまま、の約束）
  useEffect(() => {
    const off = window.giftcut?.onMediaChanged?.(({ path }) => {
      const m = itemFor(path)
      if (!m?.cutout?.enabled) return
      void render(path, m.cutout).then((p) => {
        if (p) saveSettings(m.id, m.cutout!, p)
      })
    })
    return () => off?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    /** 窓を開いている画像（素材ビンの id）。null なら閉じている */
    editingId,
    openCutout: (mediaId: number): void => setEditingId(mediaId),
    closeCutout: (): void => setEditingId(null),
    modelState,
    displayPathOf,
    loadSource,
    computeMatte,
    render,
    saveSettings
  }
}
