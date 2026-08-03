// テロップを字幕ファイル（.srt）として保存する。
//
// **中身を組み立てるのは画面側**（`renderer/src/lib/srt.ts`）。こちらは
// 保存先を聞いて書くだけ。テロップの並びや時刻の書式を知る必要がない。
//
// ※ 聞き取り（whisper）の `./subtitles.ts` とは別物。あちらは音から字幕を作る側。
import { dialog, ipcMain } from 'electron'
import { writeFileSync } from 'fs'

/** 字幕書き出しの受け口。**`registerProjectFileHandlers()` から1回だけ呼ぶ。** */
export function registerSrtHandlers(): void {
  ipcMain.handle('srt:export', async (_e, content: string) => {
    const save = await dialog.showSaveDialog({
      title: 'SRT を書き出し',
      defaultPath: 'subtitles.srt',
      filters: [{ name: 'SubRip', extensions: ['srt'] }]
    })
    if (save.canceled || !save.filePath) return { ok: false, error: 'キャンセル' }
    try {
      writeFileSync(save.filePath, content, 'utf-8')
      return { ok: true, path: save.filePath }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
}
