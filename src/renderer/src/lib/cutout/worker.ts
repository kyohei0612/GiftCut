// 模型（ISNet）を**裏の作業員（Web Worker）**で動かす。画面のスレッドを塞がない。
//
// 同じスレッドで動かすと、模型を読む・当てる数十秒のあいだ画面が完全に固まり、
// 使う人には「落ちた」に見える（2026-10-12 に実物で出た。スクショすら撮れなかった）。
//
// 受け取る物: { id, modelUrl, files, input(Float32Array 1×3×1024×1024), ep }
// 返す物:     { id, ok, out(Float32Array), tLoad, tRun } か { id, ok:false, error }
// 途中経過:   { id, phase: 'load' | 'run' }
//
// ep は 'webgpu'（asyncify 版の wasm）か 'wasm'（jsep 版・CPU）。どちらを使うかと
// 固まったときの見切りは呼ぶ側（./model）が持つ——この作業員は言われた1つしか試さない。
/// <reference lib="webworker" />
import type { InferenceSession } from 'onnxruntime-web'

type Req = {
  id: number
  modelUrl: string
  files: { mjs: string; wasm: string }
  input: Float32Array
  ep: 'webgpu' | 'wasm'
}

let session: InferenceSession | null = null
let sessionKey = ''

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, modelUrl, files, input, ep } = e.data
  try {
    const ort = (ep === 'webgpu'
      ? await import('onnxruntime-web/webgpu')
      : await import('onnxruntime-web')) as unknown as typeof import('onnxruntime-web')
    ort.env.wasm.wasmPaths = { mjs: files.mjs, wasm: files.wasm }
    ort.env.wasm.numThreads = 1
    const key = `${ep}|${modelUrl}`
    const t0 = performance.now()
    if (!session || sessionKey !== key) {
      self.postMessage({ id, phase: 'load' })
      session = await ort.InferenceSession.create(modelUrl, {
        executionProviders: ep === 'webgpu' ? ['webgpu'] : ['wasm']
      })
      sessionKey = key
    }
    const tLoad = performance.now() - t0
    self.postMessage({ id, phase: 'run' })
    const t1 = performance.now()
    const tensor = new ort.Tensor('float32', input, [1, 3, 1024, 1024])
    const res = await session.run({ [session.inputNames[0]]: tensor })
    const out = new Float32Array(res[session.outputNames[0]].data as Float32Array)
    self.postMessage({ id, ok: true, out, tLoad, tRun: performance.now() - t1 }, [out.buffer])
  } catch (err) {
    session = null
    sessionKey = ''
    self.postMessage({ id, ok: false, error: String(err) })
  }
}
