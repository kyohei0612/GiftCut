// 音を解析する——波形のピークと、喋っていない所。
//
// ## なぜ「素材の下ごしらえ」から出したか
//
// 元は `mediaProbe.ts` に居たが、**あのファイルの頭のコメントは焼き直しの話しか
// していなかった**（波形も無音探しも1行も出てこない）。とくに `audio:silences` は
// ファイル名にも冒頭にも現れない、完全に宣言の無い話題だった。
// またぐ名前は 0 / 0（2026-08-03。中身は変えていない）。
//
// ## ここに来る前、コメントが混ざっていた
//
// 波形の説明の途中から「喋っていない所を探す。」に切り替わり、**波形の説明文が
// 無音探しの頭に付いていた**（本来の波形は40行あと）。移すときに戻してある。
//
// ## どちらも「音そのもの」を見る
//
// 文字起こしは使わない。音の大きさだけで判断する（ブリューの無音カットと同じ考え方）。
// どこまでを「無音」とするかは人によって違うので、しきい値と最短の長さは呼ぶ側から渡す。

import { ipcMain } from 'electron'
import { FFMPEG, trackedSpawn } from './ffmpegRun'
import { isAllowed } from './allowList'

/** 音の解析の受け口（波形・無音探し）。**app.whenReady() の中で1回だけ呼ぶ。** */
export function registerMediaAudioHandlers(): void {
// 喋っていない所を探す。
//
// 音の大きさだけで見る（文字起こしは使わない）。ブリューの無音カットも同じ考え方で、
// これだけで実用になる。どこまでを「無音」とするかは人によって違うので、
// しきい値と最短の長さは呼ぶ側から渡す。
ipcMain.handle(
  'audio:silences',
  async (_e, videoPath: string, noiseDb = -35, minSec = 0.35) => {
    if (!videoPath) return { ok: false, error: 'パスがありません' }
    if (!isAllowed(videoPath))
      return { ok: false, error: '許可されていないファイルです' }
    const db = Math.min(-5, Math.max(-90, Number(noiseDb) || -35))
    const min = Math.min(5, Math.max(0.05, Number(minSec) || 0.35))
    return await new Promise((resolve) => {
      const p = trackedSpawn(FFMPEG, [
        '-v', 'info',
        '-i', videoPath,
        '-map', '0:a:0?',
        '-af', `silencedetect=noise=${db}dB:d=${min}`,
        '-f', 'null',
        '-'
      ])
      let err = ''
      p.stderr?.on('data', (d) => (err += d.toString()))
      p.on('error', (e2) => resolve({ ok: false, error: 'ffmpeg起動失敗: ' + e2.message }))
      p.on('close', () => {
        // silencedetect は「開始」と「終了＋長さ」を別々の行で出す。
        // 終了行だけを見ると、最後まで無音のまま終わった区間を取りこぼす。
        const out: { start: number; dur: number }[] = []
        const re = /silence_start:\s*(-?[\d.]+)|silence_end:\s*(-?[\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g
        let m: RegExpExecArray | null
        let pending: number | null = null
        while ((m = re.exec(err))) {
          if (m[1] !== undefined) pending = parseFloat(m[1])
          else if (m[2] !== undefined && m[3] !== undefined) {
            const dur = parseFloat(m[3])
            const start = pending ?? parseFloat(m[2]) - dur
            out.push({ start: Math.max(0, start), dur })
            pending = null
          }
        }
        // 最後まで無音で終わった場合（終了行が出ない）
        if (pending !== null) {
          const dm = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(err)
          if (dm) {
            const total = +dm[1] * 3600 + +dm[2] * 60 + parseFloat(dm[3])
            if (total > pending) out.push({ start: pending, dur: total - pending })
          }
        }
        resolve({ ok: true, silences: out })
      })
    })
  }
)


// 波形のピーク値を解析（PCMのバケットごとの min/max を返す）。
// 精度のポイント: ダウンサンプリングすると リサンプラのローパスで真のピークが潰れるため、
// 高レート(48kHz)の実サンプルから min/max を取る（ClipGift 相当の正確さ）。
// 長尺でもメモリを食わないよう、チャンクを溜めずに逐次(ストリーミング)でバケット集計する。
ipcMain.handle('audio:waveform', async (_e, videoPath: string) => {
  if (!videoPath) return { ok: false, error: 'パスがありません' }
  if (!isAllowed(videoPath))
    return { ok: false, error: '許可されていないファイルです' }
  const rate = 48000 // 解析サンプルレート（Hz）。高レートの実サンプルからピークを取る
  const perSec = 300 // 秒あたりバケット数（表示密度）
  const per = Math.max(1, Math.round(rate / perSec)) // 1バケットのサンプル数(=160)
  // -ac 1 でモノラル化（L/R の大きい方を拾うため amerge ではなく単純平均だが、
  // ピーク検出には十分。aresample は 48k 化のみで実質ダウンサンプリングしない）
  const args = ['-v', 'error', '-i', videoPath, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-']
  return await new Promise((resolve) => {
    const ff = trackedSpawn(FFMPEG, args)
    const mins: number[] = []
    const maxs: number[] = []
    let curMin = 0
    let curMax = 0
    let cnt = 0
    let total = 0
    let leftover: Buffer = Buffer.alloc(0)
    let err = ''
    ff.stdout.on('data', (d: Buffer) => {
      const buf = leftover.length ? Buffer.concat([leftover, d]) : d
      const full = Math.floor(buf.length / 4)
      for (let i = 0; i < full; i++) {
        const v = buf.readFloatLE(i * 4)
        if (v > curMax) curMax = v
        if (v < curMin) curMin = v
        total++
        if (++cnt >= per) {
          maxs.push(curMax)
          mins.push(curMin)
          curMin = 0
          curMax = 0
          cnt = 0
        }
      }
      leftover = buf.subarray(full * 4)
    })
    ff.stderr.on('data', (d) => {
      err += d.toString()
    })
    ff.on('error', (e) => resolve({ ok: false, error: 'ffmpeg起動失敗: ' + e.message }))
    ff.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: '音声解析失敗（音声がない可能性）\n' + err.slice(-200) })
        return
      }
      if (cnt > 0) {
        maxs.push(curMax)
        mins.push(curMin)
      }
      if (!maxs.length) {
        resolve({ ok: false, error: '音声サンプルがありません' })
        return
      }
      // 長尺でバケットが多すぎる場合は隣接をmin/maxマージ（ピークは保持）してIPC/メモリを抑える
      let fmin = mins
      let fmax = maxs
      const CAP = 300000
      if (maxs.length > CAP) {
        const g = Math.ceil(maxs.length / CAP)
        const gm: number[] = []
        const gx: number[] = []
        for (let i = 0; i < maxs.length; i += g) {
          let mn = 0
          let mx = 0
          for (let j = i; j < Math.min(i + g, maxs.length); j++) {
            if (maxs[j] > mx) mx = maxs[j]
            if (mins[j] < mn) mn = mins[j]
          }
          gx.push(mx)
          gm.push(mn)
        }
        fmin = gm
        fmax = gx
      }
      let peak = 1e-6
      for (let b = 0; b < fmax.length; b++) {
        if (fmax[b] > peak) peak = fmax[b]
        if (-fmin[b] > peak) peak = -fmin[b]
      }
      resolve({
        ok: true,
        min: fmin.map((x) => x / peak),
        max: fmax.map((x) => x / peak),
        duration: total / rate
      })
    })
  })
})
}
