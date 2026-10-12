// 透過（切り抜き）の、画像の読み書き。**canvas を使う所だけ**をここに集める。
//
// 計算（`./mask` `./strokes`）は画面に依らないので試験で固定し、
// 模型（`./model`）は 1024² でしか答えないので、元の大きさとの行き来をここで持つ。
//
// ## 中身
//
// - `canvasOf`        … 作業用の canvas
// - `imageDataOf`     … RGBA → ImageData（型の都合の包み）
// - `loadRgba`        … URL → RGBA と大きさ
// - `resizeRgba`      … RGBA を別の大きさへ（模型へ渡す 1024² を作る）
// - `resizeAlpha`     … アルファを別の大きさへ（模型の答えを元の大きさへ戻す）
// - `alphaForSettings`… 設定どおりの最終アルファ（抜き方の選択＋一本道）
// - `encodePng`       … RGBA → PNG のバイト列

import { matteFromKey, runCutoutPipeline, type Alpha } from './mask'
import { rasterizeStrokes } from './strokes'
import type { CutoutSettings } from './types'

export interface RgbaImage {
  rgba: Uint8ClampedArray
  w: number
  h: number
}

/** TS の lib は ImageData に ArrayBuffer 裏付けの配列しか受け付けない（中身は同じ） */
const imageDataOf = (rgba: Uint8ClampedArray, w: number, h: number): ImageData =>
  new ImageData(rgba as unknown as Uint8ClampedArray<ArrayBuffer>, w, h)

function canvasOf(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas が使えません')
  return { c, ctx }
}

export function loadRgba(url: string): Promise<RgbaImage> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth
      const h = img.naturalHeight
      if (!w || !h) return reject(new Error('画像の大きさが読めません'))
      const { ctx } = canvasOf(w, h)
      ctx.drawImage(img, 0, 0)
      resolve({ rgba: ctx.getImageData(0, 0, w, h).data, w, h })
    }
    img.onerror = () => reject(new Error('画像を読めません'))
    img.src = url
  })
}

export function resizeRgba(src: RgbaImage, tw: number, th: number): Uint8ClampedArray {
  const { c } = canvasOf(src.w, src.h)
  c.getContext('2d')!.putImageData(imageDataOf(src.rgba, src.w, src.h), 0, 0)
  const { ctx } = canvasOf(tw, th)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(c, 0, 0, tw, th)
  return ctx.getImageData(0, 0, tw, th).data
}

/** アルファを灰色の絵にして拡縮し、R を読み戻す（canvas の補間をそのまま借りる） */
export function resizeAlpha(a: Alpha, w: number, h: number, tw: number, th: number): Alpha {
  if (w === tw && h === th) return a
  const px = new Uint8ClampedArray(w * h * 4)
  for (let i = 0, p = 0; i < a.length; i++, p += 4) {
    px[p] = px[p + 1] = px[p + 2] = a[i]
    px[p + 3] = 255
  }
  const out = resizeRgba({ rgba: px, w, h }, tw, th)
  const res = new Uint8ClampedArray(tw * th)
  for (let i = 0, p = 0; i < res.length; i++, p += 4) res[i] = out[p]
  return res
}

/**
 * 設定どおりの最終アルファ。
 * auto なら模型の答え（元の大きさに戻した物）、color なら拾った色で抜く。
 * 模型の答えが無い auto は「全部残す」から始める（ペンと境界の整えだけが効く）
 */
export function alphaForSettings(src: RgbaImage, matte: Alpha | null, s: CutoutSettings): Alpha {
  const base =
    s.method === 'color' && s.key
      ? matteFromKey(src.rgba, src.w, src.h, s.key)
      : (matte ?? new Uint8ClampedArray(src.w * src.h).fill(255))
  const labels = rasterizeStrokes(s.strokes, src.w, src.h, src.rgba)
  return runCutoutPipeline(base, labels, s, src.w, src.h)
}

export function encodePng(rgba: Uint8ClampedArray, w: number, h: number): Promise<Uint8Array> {
  const { c, ctx } = canvasOf(w, h)
  ctx.putImageData(imageDataOf(rgba, w, h), 0, 0)
  return new Promise((resolve, reject) => {
    c.toBlob((b) => {
      if (!b) return reject(new Error('PNG にできません'))
      b.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject)
    }, 'image/png')
  })
}
