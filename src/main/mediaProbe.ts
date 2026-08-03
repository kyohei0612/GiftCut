// 素材そのものを尋ねる（長さ・コマ数・大きさ）と、サムネを1枚作る。
//
// ## 元は5つ入っていた
//
// このファイルは 2026-08-03 まで、尋ねる2本・サムネ・焼き直し・波形・無音探しの
// 5つを抱えていた。**頭のコメントが説明していたのは、ほぼ焼き直しだけ**で、
// 他は1行も書かれていなかった（`audio:silences` に至ってはファイル名にも
// 冒頭にも現れなかった）。またぐ名前 0 / 0 で切れた:
//
//   焼き直し（プロキシ）      → ./mediaProxy
//   波形・喋っていない所      → ./mediaAudio
//
// ## 大きさも一緒に返す
//
// 書き出しの既定を素材に合わせるため。画面の <video> から取ると
// **焼き直し（プロキシ）の大きさを拾ってしまう**（360p のプロキシを見て
// 「素材は360p」と誤解する）。

import { app, ipcMain } from 'electron'
import { join } from 'path'
import { readdirSync, rmSync, statSync } from 'fs'
// **spawn は import しない。** 起動は必ず trackedSpawn 経由
// （閉じたときに殺す相手の名簿へ載せるため）
import { FFMPEG, FFPROBE, trackedSpawn } from './ffmpegRun'
import { allowFile, isAllowed } from './allowList'

// サムネイル生成（先頭付近の1フレーム）。ライブラリで複数保持するので削除はしない
// キャッシュのプルーニング: dir 内の match するファイルを新しい順に keep 個だけ残し、古いものを削除。
// ※プロキシは容量ベースのLRUが必要なので pruneProxyCache を使う（こちらはサムネ用）
const pruneCache = (dir: string, match: (f: string) => boolean, keep: number): void => {
  try {
    const files = readdirSync(dir)
      .filter(match)
      .map((f) => {
        try {
          return { f, t: statSync(join(dir, f)).mtimeMs }
        } catch {
          return { f, t: 0 }
        }
      })
      .sort((a, b) => b.t - a.t)
    for (const x of files.slice(keep)) {
      try {
        rmSync(join(dir, x.f), { force: true })
      } catch {
        /* 無視 */
      }
    }
  } catch {
    /* 無視 */
  }
}


/** サムネ・焼き直し・波形の受け口。**app.whenReady() の中で1回だけ呼ぶ。** */

export function registerMediaProbeHandlers(): void {
// ---- 素材そのものを尋ねる（長さ・コマ数・大きさ）----
// 元は main/index.ts に置いてあったが、要る物（ipcMain / FFPROBE / trackedSpawn /
// isAllowed）は**このファイルが最初から全部 import している**当人だった
// ＝またぐ名前は0個（2026-08-03。中身は変えていない）。

// メディアの尺（秒）を取得（SE をタイムラインに置く時の長さ用）
ipcMain.handle('media:duration', async (_e, path: string) => {
  if (!path || !isAllowed(path)) return { ok: false }
  return await new Promise((resolve) => {
    const p = trackedSpawn(FFPROBE, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      path
    ])
    let out = ''
    p.stdout?.on('data', (d) => {
      out += d.toString()
    })
    p.on('error', () => resolve({ ok: false }))
    p.on('close', () => {
      const d = parseFloat(out.trim())
      resolve(d > 0 ? { ok: true, duration: d } : { ok: false })
    })
  })
})

// 動画の実フレームレートと大きさを返す。
//
// fps は素材fps対応用（ffprobe r_frame_rate = "30000/1001" 等）。
// **大きさも一緒に返す**のは、書き出しの既定を素材に合わせるため。
// ここで取らずに画面の <video> から取ると、**焼き直し（プロキシ）の
// 大きさを拾ってしまう**（360p のプロキシを見て「素材は360p」と誤解する）。
//
// `-of default=nw=1` は `key=value` を1行ずつ出す。csv だと並び順が
// 聞いた順ではなくストリームの順になり、どれがどれか分からなくなる。
ipcMain.handle('media:fps', async (_e, path: string) => {
  if (!path || !isAllowed(path)) return { ok: false }
  return await new Promise((resolve) => {
    const p = trackedSpawn(FFPROBE, [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=r_frame_rate,width,height',
      '-of',
      'default=nw=1',
      path
    ])
    let out = ''
    p.stdout?.on('data', (d) => {
      out += d.toString()
    })
    p.on('error', () => resolve({ ok: false }))
    p.on('close', () => {
      const pick = (k: string): string =>
        new RegExp(`^${k}=(.*)$`, 'm').exec(out.trim())?.[1]?.trim() ?? ''
      const s = pick('r_frame_rate')
      const m = /^(\d+)\/(\d+)$/.exec(s)
      const fps = m ? Number(m[1]) / Number(m[2]) : parseFloat(s)
      const w = parseInt(pick('width'), 10)
      const h = parseInt(pick('height'), 10)
      const size = w > 0 && h > 0 ? { w, h } : {}
      resolve(fps > 0 && isFinite(fps) ? { ok: true, fps, ...size } : { ok: false, ...size })
    })
  })
})

ipcMain.handle('video:thumbnail', async (_e, videoPath: string) => {
  if (!videoPath) return { ok: false, error: 'パスがありません' }
  if (!isAllowed(videoPath))
    return { ok: false, error: '許可されていないファイルです' }
  // 古いサムネを掃除（temp に無制限に溜まるのを防ぐ）。最新100枚だけ残す。
  pruneCache(app.getPath('temp'), (f) => /^giftcut_thumb_.*\.png$/.test(f), 100)
  const out = join(app.getPath('temp'), 'giftcut_thumb_' + Date.now() + '.png')
  const args = ['-y', '-ss', '0.5', '-i', videoPath, '-frames:v', '1', '-vf', 'scale=240:-1', out]
  return await new Promise((resolve) => {
    const ff = trackedSpawn(FFMPEG, args)
    let err = ''
    ff.stderr.on('data', (d) => {
      err += d.toString()
    })
    ff.on('error', (e) => resolve({ ok: false, error: e.message }))
    ff.on('close', (code) => {
      if (code === 0) {
        allowFile(out)
        resolve({ ok: true, path: out })
      } else resolve({ ok: false, error: err.slice(-200) })
    })
  })
})


}
