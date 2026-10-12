// 画像の背景を透過する（切り抜き）の、main 側。**模型の取り寄せと、出来上がりの置き場。**
//
// 計算は全部画面側（`renderer/lib/cutout`）。ここが持つのは
//
//   1. 模型（ISNet・Apache-2.0）を初回に落として userData に置く
//      （字幕の聞き取りと同じ流れ。`subtitles.ts` の downloadTo を借りる）
//   2. 出来上がった PNG を `userData/giftcut-cutouts/` に置き、gcfile で配れるようにする
//   3. wasm（onnxruntime-web）と模型の**パス**を画面へ教える
//
// ## 模型は2つ（2026-10-12・同じ絵で比べた）
//
//   anime   … isnet-anime。VTuber の立ち絵を髪の毛先・衣装まで綺麗に抜いた。**既定**
//   general … isnet-general-use。写真向け。アニメ絵では白い衣装を背景と間違えて体が消えた
//
// 出来上がりは派生物。元画像が変わったら画面側が作り直す（設定はプロジェクトに入っている）。
//
// ## 中身
//
// - `MODELS`                 … 模型の名前・大きさ・取り寄せ先（id ごと）
// - `idOf`                   … 画面から来た id を anime / general に畳む
// - `modelPath`              … 模型の置き場
// - `modelReady`             … 使える形で在るか
// - `cutoutDir`              … 出来上がりの置き場
// - `ortFile`                … 同梱の wasm の在り処（out/renderer/ort）
// - `registerCutoutHandlers` … ipc の受け口
import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { allowFile } from './allowList'
import { downloadTo } from './subtitles'

/** rembg（MIT）が配っている ISNet（Apache-2.0）の ONNX */
const REMBG = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/'
export const MODELS = {
  anime: { name: 'isnet-anime.onnx', label: 'アニメ・VTuber', sizeMB: 168, url: REMBG + 'isnet-anime.onnx' },
  general: { name: 'isnet-general-use.onnx', label: '写真・実写', sizeMB: 171, url: REMBG + 'isnet-general-use.onnx' }
} as const
export type CutoutModelId = keyof typeof MODELS
const idOf = (v: unknown): CutoutModelId => (v === 'general' ? 'general' : 'anime')

export const modelPath = (id: CutoutModelId): string => join(app.getPath('userData'), 'cutout', MODELS[id].name)
/** 途中で落ちた欠けを「ある」と数えない（どちらも 176〜179MB） */
export function modelReady(id: CutoutModelId): boolean {
  try {
    return existsSync(modelPath(id)) && statSync(modelPath(id)).size > 150 * 1024 * 1024
  } catch {
    return false
  }
}

export const cutoutDir = (): string => join(app.getPath('userData'), 'giftcut-cutouts')

/** 同梱の wasm。開発中も配布物も `out/renderer/ort/` に在る（scripts/copy-ort.mjs） */
export function ortFile(name: string): string | null {
  const p = join(app.getAppPath(), 'out', 'renderer', 'ort', name)
  return existsSync(p) ? p : null
}

const cancel = { canceled: false }

export function registerCutoutHandlers(): void {
  ipcMain.handle('cutout:status', () => {
    // asyncify＝WebGPU 用／jsep＝CPU 用（scripts/copy-ort.mjs）。画面が使い分ける
    const ort: Record<string, { mjs: string | null; wasm: string | null }> = {}
    for (const b of ['asyncify', 'jsep']) {
      const mjs = ortFile(`ort-wasm-simd-threaded.${b}.mjs`)
      const wasm = ortFile(`ort-wasm-simd-threaded.${b}.wasm`)
      if (mjs) allowFile(mjs)
      if (wasm) allowFile(wasm)
      ort[b] = { mjs, wasm }
    }
    const models: Record<string, { ready: boolean; path: string | null; label: string; sizeMB: number }> = {}
    for (const id of Object.keys(MODELS) as CutoutModelId[]) {
      const ready = modelReady(id)
      if (ready) allowFile(modelPath(id))
      models[id] = { ready, path: ready ? modelPath(id) : null, label: MODELS[id].label, sizeMB: MODELS[id].sizeMB }
    }
    return { ok: true, models, ort }
  })
  ipcMain.handle('cutout:fetchModel', async (e, rawId: unknown) => {
    const id = idOf(rawId)
    cancel.canceled = false
    if (modelReady(id)) {
      allowFile(modelPath(id))
      return { ok: true, path: modelPath(id) }
    }
    const send = (percent: number): void => {
      if (!e.sender.isDestroyed()) e.sender.send('cutout:progress', { percent })
    }
    const r = await downloadTo(MODELS[id].url, modelPath(id), send, cancel)
    if (!r.ok) return { ok: false, error: r.error }
    allowFile(modelPath(id))
    return { ok: true, path: modelPath(id) }
  })
  ipcMain.handle('cutout:cancel', () => {
    cancel.canceled = true
    return { ok: true }
  })
  /** 出来上がりを置く。**一時名で書いてから置き換える**（読んでいる最中に途中の物を見せない） */
  ipcMain.handle('cutout:save', (_e, key: string, bytes: Uint8Array) => {
    try {
      mkdirSync(cutoutDir(), { recursive: true })
      const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_')
      const dst = join(cutoutDir(), `${safe}.png`)
      const tmp = dst + '.tmp'
      writeFileSync(tmp, Buffer.from(bytes))
      renameSync(tmp, dst)
      allowFile(dst)
      return { ok: true, path: dst, mtimeMs: statSync(dst).mtimeMs }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
  ipcMain.handle('cutout:remove', (_e, p: string) => {
    try {
      if (p && p.startsWith(cutoutDir())) rmSync(p, { force: true })
    } catch {
      /* 消せなくても次で上書きされる */
    }
    return { ok: true }
  })
}
