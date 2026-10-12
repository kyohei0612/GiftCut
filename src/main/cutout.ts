// 画像の背景を透過する（切り抜き）の、main 側。**模型の取り寄せと、出来上がりの置き場。**
//
// 計算は全部画面側（`renderer/lib/cutout`）。ここが持つのは
//
//   1. 模型（ISNet・179MB・Apache-2.0）を初回に落として userData に置く
//      （字幕の聞き取りと同じ流れ。`subtitles.ts` の downloadTo を借りる）
//   2. 出来上がった PNG を `userData/giftcut-cutouts/` に置き、gcfile で配れるようにする
//   3. wasm（onnxruntime-web）と模型の**パス**を画面へ教える
//
// 出来上がりは派生物。元画像が変わったら画面側が作り直す（設定はプロジェクトに入っている）。
//
// ## 中身
//
// - `MODEL`                  … 模型の名前・大きさ・取り寄せ先
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

export const MODEL = {
  name: 'isnet-general-use.onnx',
  label: 'ISNet',
  sizeMB: 171,
  // rembg（MIT）が配っている ISNet（Apache-2.0）の ONNX。md5 fc16ebd8b0c10d971d3513d564d01e29
  url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx'
} as const

export const modelPath = (): string => join(app.getPath('userData'), 'cutout', MODEL.name)
/** 途中で落ちた欠けを「ある」と数えない（178,648,008 バイトが本物） */
export function modelReady(): boolean {
  try {
    return existsSync(modelPath()) && statSync(modelPath()).size > 170 * 1024 * 1024
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
    const mjs = ortFile('ort-wasm-simd-threaded.jsep.mjs')
    const wasm = ortFile('ort-wasm-simd-threaded.jsep.wasm')
    if (mjs) allowFile(mjs)
    if (wasm) allowFile(wasm)
    const ready = modelReady()
    if (ready) allowFile(modelPath())
    return {
      ok: true,
      model: ready,
      modelPath: ready ? modelPath() : null,
      label: MODEL.label,
      sizeMB: ready ? 0 : MODEL.sizeMB,
      ort: { mjs, wasm }
    }
  })
  ipcMain.handle('cutout:fetchModel', async (e) => {
    cancel.canceled = false
    if (modelReady()) {
      allowFile(modelPath())
      return { ok: true, path: modelPath() }
    }
    const send = (percent: number): void => {
      if (!e.sender.isDestroyed()) e.sender.send('cutout:progress', { percent })
    }
    const r = await downloadTo(MODEL.url, modelPath(), send, cancel)
    if (!r.ok) return { ok: false, error: r.error }
    allowFile(modelPath())
    return { ok: true, path: modelPath() }
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
