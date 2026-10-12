// 背景を当てる模型（ISNet・Apache-2.0）を画面側で動かす。
//
// ## なぜ画面側（onnxruntime-web）か
//
// main 側の native 版（onnxruntime-node）は node_modules に入るので、
// **JS だけの差し替え更新では届かない**（土台の asar は差し替えない）。
// 画面側なら `out/` の中に全部入るので差し替えで届く。速さは WebGPU で十分
// （無い機種は WASM に落ちる。1枚数十秒だが動く）。
//
// ## 模型は同梱しない（179MB）
//
// 初回に落として userData に置く（字幕の聞き取りと同じ。`main/cutout`）。
// 取り寄せ先は rembg が配っている物（`isnet-general-use.onnx`）。
//
// ## 入出力は rembg の DisSession と同じ
//
//   入力 1024×1024 RGB、(x/255 − 0.5) / 1.0、形 [1,3,1024,1024]
//   出力 [1,1,1024,1024]。min–max で 0..1 に伸ばして 0..255 へ
//
// ## 中身
//
// - `MODEL_SIZE`     … 模型に渡す一辺（1024）
// - `ortModule`      … onnxruntime-web を要るときに読む
// - `loadSession`    … 1回だけ作って使い回す
// - `toInput`        … RGBA（1024²）→ 模型の入力
// - `matteFromOutput`… 模型の出力 → アルファ（1024²・0..255）
// - `runMatte`       … 上をつないで1枚ぶん

import type { InferenceSession } from 'onnxruntime-web'

export const MODEL_SIZE = 1024

export interface OrtFiles {
  /** wasm の JS 側（.mjs）と本体（.wasm）の URL。無ければ index.html の隣の ort/ を見る */
  mjs?: string
  wasm?: string
}

let sessionP: Promise<InferenceSession> | null = null
let sessionKey = ''

async function ortModule(): Promise<typeof import('onnxruntime-web')> {
  // 必要になるまで読まない（起動時に数MB の JS を抱えない）
  return (await import('onnxruntime-web/webgpu')) as unknown as typeof import('onnxruntime-web')
}

export async function loadSession(modelUrl: string, files: OrtFiles): Promise<InferenceSession> {
  if (sessionP && sessionKey === modelUrl) return sessionP
  sessionKey = modelUrl
  sessionP = (async () => {
    const ort = await ortModule()
    const base = new URL('ort/', location.href).href
    ort.env.wasm.wasmPaths = {
      mjs: files.mjs ?? base + 'ort-wasm-simd-threaded.jsep.mjs',
      wasm: files.wasm ?? base + 'ort-wasm-simd-threaded.jsep.wasm'
    }
    // file:// の画面は crossOriginIsolated でないので SharedArrayBuffer が無い＝1スレッド
    ort.env.wasm.numThreads = 1
    const hasGpu = !!(navigator as unknown as { gpu?: unknown }).gpu
    try {
      return await ort.InferenceSession.create(modelUrl, {
        executionProviders: hasGpu ? ['webgpu', 'wasm'] : ['wasm']
      })
    } catch (e) {
      if (!hasGpu) throw e
      // WebGPU が立ち上がらない機種（古いドライバ）は WASM で
      return await ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'] })
    }
  })()
  sessionP.catch(() => {
    sessionP = null
  })
  return sessionP
}

/** RGBA（MODEL_SIZE²）→ CHW の float32 */
export function toInput(rgba: Uint8ClampedArray): Float32Array {
  const n = MODEL_SIZE * MODEL_SIZE
  const out = new Float32Array(3 * n)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    out[i] = rgba[p] / 255 - 0.5
    out[n + i] = rgba[p + 1] / 255 - 0.5
    out[2 * n + i] = rgba[p + 2] / 255 - 0.5
  }
  return out
}

/** 模型の出力 → 0..255。min–max で伸ばす（rembg と同じ。出力の絶対値は当てにしない） */
export function matteFromOutput(out: Float32Array): Uint8ClampedArray {
  const n = MODEL_SIZE * MODEL_SIZE
  let mi = Infinity
  let ma = -Infinity
  for (let i = 0; i < n; i++) {
    const v = out[i]
    if (v < mi) mi = v
    if (v > ma) ma = v
  }
  const a = new Uint8ClampedArray(n)
  const span = ma - mi
  if (!(span > 1e-9)) return a.fill(255)
  for (let i = 0; i < n; i++) a[i] = Math.round(((out[i] - mi) / span) * 255)
  return a
}

export async function runMatte(session: InferenceSession, rgba1024: Uint8ClampedArray): Promise<Uint8ClampedArray> {
  const ort = await ortModule()
  const input = new ort.Tensor('float32', toInput(rgba1024), [1, 3, MODEL_SIZE, MODEL_SIZE])
  const res = await session.run({ [session.inputNames[0]]: input })
  const out = res[session.outputNames[0]].data as Float32Array
  return matteFromOutput(out)
}
