// 背景を当てる模型（ISNet・Apache-2.0）を画面側で動かす。**本体は裏の作業員（./worker）。**
//
// ## なぜ画面側（onnxruntime-web）か
//
// main 側の native 版（onnxruntime-node）は node_modules に入るので、
// **JS だけの差し替え更新では届かない**（土台の asar は差し替えない）。
// 画面側なら `out/` の中に全部入るので差し替えで届く。
//
// ## WebGPU を試し、固まったら CPU へ見切る
//
// 1.30 の WebGPU は asyncify 版の wasm で動くが、機種によっては読み込みで
// 返ってこないことがある（2026-10-12 に実物で3分以上）。作業員なので画面は固まらないが、
// 待ち続けても仕方ない——**時間で見切って作業員ごと捨て、CPU（jsep 版）でやり直す**。
// 同じスレッドで動かしていたら、この見切りはそもそも作れない（固まった側から抜けられない）。
//
// ## 模型は同梱しない（176〜179MB）
//
// 初回に落として userData に置く（字幕の聞き取りと同じ。`main/cutout`）。
//
// ## 入出力は rembg の DisSession と同じ
//
//   入力 1024×1024 RGB、(x/255 − 0.5) / 1.0、形 [1,3,1024,1024]
//   出力 [1,1,1024,1024]。min–max で 0..1 に伸ばして 0..255 へ
//
// ## 中身
//
// - `MODEL_SIZE`     … 模型に渡す一辺（1024）
// - `toInput`        … RGBA（1024²）→ 模型の入力
// - `matteFromOutput`… 模型の出力 → アルファ（1024²・0..255）
// - `getWorker`      … 作業員を1人だけ持つ（ep が変わったら作り直す）
// - `runOnce`        … 1回当てさせる。見切りの時間を過ぎたら作業員ごと捨てる
// - `inferMatte`     … 作業員に当てさせる（WebGPU → 見切り → CPU）。時間も返す

export const MODEL_SIZE = 1024

export interface OrtFiles {
  /** WebGPU 用（asyncify）と CPU 用（jsep）の wasm。それぞれ .mjs と .wasm の URL */
  asyncify?: { mjs: string; wasm: string }
  jsep?: { mjs: string; wasm: string }
}

export interface MatteResult {
  matte: Uint8ClampedArray
  ep: 'webgpu' | 'wasm'
  /** 模型を読んだ時間・当てた時間（ms） */
  tLoad: number
  tRun: number
}

/** WebGPU の読み込みをここまで待つ。超えたら作業員ごと捨てて CPU へ */
const WEBGPU_TIMEOUT_MS = 90_000

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

let worker: Worker | null = null
let workerEp: 'webgpu' | 'wasm' | null = null
let reqId = 0

function getWorker(ep: 'webgpu' | 'wasm'): Worker {
  if (worker && workerEp === ep) return worker
  worker?.terminate()
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  workerEp = ep
  return worker
}

function runOnce(
  ep: 'webgpu' | 'wasm',
  modelUrl: string,
  files: { mjs: string; wasm: string },
  input: Float32Array,
  onPhase: (p: 'load' | 'run') => void,
  timeoutMs: number
): Promise<MatteResult> {
  return new Promise((resolve, reject) => {
    const w = getWorker(ep)
    const id = ++reqId
    let timer: ReturnType<typeof setTimeout> | null = null
    const arm = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        // 返ってこない作業員は捨てる（次は作り直す）
        w.terminate()
        worker = null
        workerEp = null
        reject(new Error(`timeout(${ep})`))
      }, timeoutMs)
    }
    arm()
    const onMsg = (e: MessageEvent): void => {
      const d = e.data
      if (d.id !== id) return
      if (d.phase) {
        onPhase(d.phase)
        arm()
        return
      }
      if (timer) clearTimeout(timer)
      w.removeEventListener('message', onMsg)
      if (d.ok) resolve({ matte: matteFromOutput(d.out), ep, tLoad: d.tLoad, tRun: d.tRun })
      else reject(new Error(d.error))
    }
    w.addEventListener('message', onMsg)
    // 入力は写して渡す（渡した側でも使い回せるように）
    w.postMessage({ id, modelUrl, files, input: new Float32Array(input), ep })
  })
}

/**
 * 背景を当てる。WebGPU（asyncify）を先に試し、失敗か見切りなら CPU（jsep）。
 * `prefer` で片方に固定できる（確認用）。
 */
export async function inferMatte(
  modelUrl: string,
  files: OrtFiles,
  rgba1024: Uint8ClampedArray,
  onPhase: (p: 'load' | 'run') => void,
  prefer?: 'webgpu' | 'wasm'
): Promise<MatteResult> {
  const input = toInput(rgba1024)
  const hasGpu = !!(navigator as unknown as { gpu?: unknown }).gpu
  const tryGpu = prefer !== 'wasm' && hasGpu && !!files.asyncify
  if (tryGpu) {
    try {
      return await runOnce('webgpu', modelUrl, files.asyncify!, input, onPhase, WEBGPU_TIMEOUT_MS)
    } catch (e) {
      console.warn('[cutout] WebGPU で当てられず CPU へ:', String(e))
      if (prefer === 'webgpu') throw e
    }
  }
  if (!files.jsep) throw new Error('CPU 用の wasm が見つかりません（out/renderer/ort）')
  return runOnce('wasm', modelUrl, files.jsep, input, onPhase, 10 * 60_000)
}
