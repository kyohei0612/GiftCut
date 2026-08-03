// 喋っている内容を聞き取る（whisper.cpp を動かす）。
//
// ## なぜ whisper.cpp か
//
// **無料で一番よく当たるのが Whisper**、その中で large-v3-turbo は
// large と同じくらい当たって速い。whisper.cpp は
//
//   ・このPCの中だけで動く（音声をどこにも送らない）
//   ・MIT なので配ってよい（同梱できない SE/テロップ素材とは事情が違う）
//   ・実行ファイル1つ＋模型1つで済む（Python を入れさせない）
//
// ## 置き場
//
// 実行ファイルと模型は **userData の下**（更新でも消えない場所）。
// 模型は 1.6GB あるので配布物には入れず、**初回だけ落とす**。
// 途中で落ちても半端な物を使わないよう、一時名で書いてから置き換える。

import { app, ipcMain } from 'electron'
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
// **spawn は import しない。** 起動は必ず trackedSpawn 経由
// （閉じたときに殺す相手の名簿へ載せるため）
import type { ChildProcess } from 'child_process'
import { get as httpsGet } from 'https'
import { FFMPEG, FFPROBE, trackedSpawn } from './ffmpegRun'
// 出力の読み取りは shared 側（画面も本体も要らずに試せる）
import { parseWhisperLine, type WhisperSeg } from '../shared/whisperOut'
export type { WhisperSeg }

/** 使う模型。turbo は large とほぼ同じ精度で、はるかに速い */
export const MODEL = {
  name: 'ggml-large-v3-turbo-q5_0.bin',
  label: 'large-v3-turbo',
  sizeMB: 574,
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin'
} as const

/**
 * 聞き取りの実行ファイル。**配布物に同梱する**（約10MB・MIT）。
 *
 * 最初は「初回に落とす」形にしていたが、**取得先が版ごとに変わって 404 になった**
 * （v1.7.4 の zip は既に無かった）。使う人の初回に外の都合で失敗するのは、
 * こちらでは直せない。10MB なら本体に入れてしまう方が確実。
 * 置き方は `npm run fetch:whisper`。
 */
const EXE_NAME = 'whisper-cli.exe'

export const dirOf = (): string => join(app.getPath('userData'), 'whisper')
export const modelPath = (): string => join(dirOf(), MODEL.name)
/**
 * 実行ファイルを探す。
 *
 * **同梱を先に見る。** 開発中はリポジトリ直下、配布物では resources に居る。
 * userData も見るのは、自分で新しい版を置いた人を拾うため。
 */
export function findExe(): string | null {
  const cands = [
    join(process.resourcesPath ?? '', 'whisper', EXE_NAME),
    join(app.getAppPath(), 'resources', 'whisper', EXE_NAME),
    join(dirOf(), EXE_NAME)
  ]
  for (const p of cands) if (p && existsSync(p)) return p
  return null
}

/** 模型が使える形で置いてあるか（途中で落ちた欠けを「ある」と数えない） */
export function modelReady(): boolean {
  try {
    return existsSync(modelPath()) && statSync(modelPath()).size > 100 * 1024 * 1024
  } catch {
    return false
  }
}

/**
 * 模型を落とす。**一時名で書いてから置き換える。**
 * 途中で止まった物をそのまま置くと、次に「ある」と誤判定して動かない。
 */
export function downloadTo(
  url: string,
  dest: string,
  onProgress: (percent: number) => void,
  signal: { canceled: boolean }
): Promise<{ ok: boolean; error?: string }> {
  mkdirSync(dirOf(), { recursive: true })
  const tmp = dest + '.part'
  return new Promise((resolve) => {
    const done = (r: { ok: boolean; error?: string }): void => {
      if (!r.ok) {
        try {
          rmSync(tmp, { force: true })
        } catch {
          /* 消せなくても次で上書きする */
        }
      }
      resolve(r)
    }
    const go = (u: string, redirects: number): void => {
      if (redirects > 5) return done({ ok: false, error: '置き場所を辿れませんでした' })
      httpsGet(u, { headers: { 'User-Agent': 'GiftCut' } }, (res) => {
        // 置き場所が変わっている（HuggingFace は実体へ飛ばす）
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          return go(res.headers.location, redirects + 1)
        }
        if (res.statusCode !== 200) {
          res.resume()
          return done({ ok: false, error: `落とせませんでした（${res.statusCode}）` })
        }
        const total = Number(res.headers['content-length'] ?? 0)
        let got = 0
        let last = -1
        const ws = createWriteStream(tmp)
        res.on('data', (c: Buffer) => {
          if (signal.canceled) {
            res.destroy()
            ws.destroy()
            return done({ ok: false, error: 'やめました' })
          }
          got += c.length
          if (total > 0) {
            const p = Math.min(99, Math.round((got / total) * 100))
            if (p !== last) {
              last = p
              onProgress(p)
            }
          }
        })
        res.on('error', (e) => done({ ok: false, error: String(e) }))
        ws.on('error', (e) => done({ ok: false, error: String(e) }))
        ws.on('close', () => {
          if (signal.canceled) return done({ ok: false, error: 'やめました' })
          try {
            renameSync(tmp, dest)
            onProgress(100)
            done({ ok: true })
          } catch (e) {
            done({ ok: false, error: String(e) })
          }
        })
        res.pipe(ws)
      }).on('error', (e) => done({ ok: false, error: String(e) }))
    }
    go(url, 0)
  })
}

/**
 * whisper.cpp を動かして、時刻付きの文字起こしを得る。
 *
 * 進み具合は、出てきた行の時刻 ÷ 全体の長さで出す。
 * **待たされている間、何も出ないのが一番つらい**ので、
 * 正確でなくても進んでいることが分かるようにしておく。
 */
export function runWhisper(
  exe: string,
  wav: string,
  totalSec: number,
  onProgress: (percent: number) => void,
  onProc: (p: ChildProcess) => void
): Promise<{ ok: boolean; segs?: WhisperSeg[]; error?: string }> {
  return new Promise((resolve) => {
    const segs: WhisperSeg[] = []
    const args = [
      '-m', modelPath(),
      '-f', wav,
      '-l', 'ja',
      '-otxt', 'false',
      '--print-progress', 'false',
      // **区切りは短めに。** 長い塊で返されると、割り直しても時刻が合いにくい
      '-ml', '0'
    ]
    let err = ''
    // **trackedSpawn を通す。** 直に spawn していたので、取り消しでは殺せても
    // **アプリを閉じたときに殺す相手（killAllChildren）に入っていなかった**。
    // 聞き取りは数分走るので、閉じたあとも裏で回り続けていた（2026-08-03 に修正）
    const p = trackedSpawn(exe, args)
    onProc(p)
    const onLine = (s: string): void => {
      for (const line of s.split(/\r?\n/)) {
        const seg = parseWhisperLine(line)
        if (!seg) continue
        segs.push(seg)
        if (totalSec > 0) onProgress(Math.min(99, Math.round((seg.end / totalSec) * 100)))
      }
    }
    p.stdout.on('data', (d) => onLine(d.toString()))
    p.stderr.on('data', (d) => {
      const s = d.toString()
      err += s
      onLine(s) // 版によっては時刻付きの行が stderr へ出る
    })
    p.on('error', (e) => resolve({ ok: false, error: `聞き取りを始められません: ${e.message}` }))
    p.on('close', (code) => {
      if (segs.length) return resolve({ ok: true, segs })
      resolve({
        ok: false,
        error: code === 0 ? '何も聞き取れませんでした' : `聞き取りに失敗（${code}）\n${err.slice(-400)}`
      })
    })
  })
}

/**
 * 画面からの受け口（status / cancel / run）。
 *
 * 元は `main/index.ts` に置いてあったが、**あちらには話題を宣言する
 * 冒頭コメントが無く**、窓・配信・ダイアログ・下調べ・設定・聞き取り・計測の
 * 7つが同居していた。775行目に「受け口はそれぞれ別ファイル（この1つのファイルに
 * 全部置くと読み切れなくなる）」と書いてあるのに、ここが残っていた。
 *
 * ここへ移すと**またぐ名前は0個**（要る物は全部このファイルが持っている当人）。
 *
 * 流れ: 音を取り出す → 聞き取る → 呼んだ側（画面）が割って合わせる。
 * **合わせる所は画面側**（カット点を知っているのがそちらなので）。
 * ここは「音を文字にする」までを受け持つ。
 */
export function registerSubtitleHandlers(): void {
  const subCancel = { canceled: false }
  let subProc: ChildProcess | null = null
  /** 動画の長さ（秒）。進み具合を出すのに要る。取れなければ 0 */
  const probeDuration = (path: string): Promise<number> =>
    new Promise((resolve) => {
      const p = trackedSpawn(FFPROBE, [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path
      ])
      let out = ''
      p.stdout?.on('data', (d) => (out += d.toString()))
      p.on('error', () => resolve(0))
      p.on('close', () => {
        const d = parseFloat(out.trim())
        resolve(Number.isFinite(d) && d > 0 ? d : 0)
      })
    })
  ipcMain.handle('subtitles:status', () => ({
    ok: true,
    exe: !!findExe(),
    model: modelReady(),
    label: MODEL.label,
    // 落とすのは模型だけ（実行ファイルは同梱してある）
    sizeMB: modelReady() ? 0 : MODEL.sizeMB
  }))
  ipcMain.handle('subtitles:cancel', () => {
    subCancel.canceled = true
    try {
      subProc?.kill()
    } catch {
      /* すでに終わっている */
    }
    return { ok: true }
  })
  ipcMain.handle('subtitles:run', async (e, videoPath: string) => {
    subCancel.canceled = false
    const send = (s: unknown): void => {
      if (!e.sender.isDestroyed()) e.sender.send('subtitles:progress', s)
    }
    const tmpWav = join(tmpdir(), `giftcut-sub-${Date.now()}.wav`)
    try {
      if (!videoPath || !existsSync(videoPath))
        return { ok: false, error: '聞き取る動画がありません' }

      // 1) 模型を落とす（初回だけ）。実行ファイルは同梱してある
      if (!findExe())
        return {
          ok: false,
          error: '聞き取りの実行ファイルが見つかりません（同梱物が欠けています）'
        }
      if (!modelReady()) {
        send({ phase: 'download', percent: 0 })
        const r = await downloadTo(
          MODEL.url,
          modelPath(),
          (p) => send({ phase: 'download', percent: p }),
          subCancel
        )
        if (!r.ok) return { ok: false, error: `聞き取りの模型を落とせません: ${r.error}` }
      }
      if (subCancel.canceled) return { ok: false, canceled: true }

      // 2) 音を取り出す。**16kHz モノラルの wav**（whisper.cpp が受ける形）
      send({ phase: 'extract' })
      const okWav = await new Promise<boolean>((resolve) => {
        const ff = trackedSpawn(FFMPEG, [
          '-y', '-i', videoPath,
          '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
          tmpWav
        ])
        subProc = ff
        ff.on('error', () => resolve(false))
        ff.on('close', (c) => resolve(c === 0 && existsSync(tmpWav)))
      })
      if (subCancel.canceled) return { ok: false, canceled: true }
      if (!okWav) return { ok: false, error: '音を取り出せませんでした' }

      // 3) 聞き取る
      send({ phase: 'listen', percent: 0 })
      const dur = await probeDuration(videoPath)
      const r = await runWhisper(
        findExe()!,
        tmpWav,
        dur,
        (p) => send({ phase: 'listen', percent: p }),
        (p) => (subProc = p)
      )
      if (subCancel.canceled) return { ok: false, canceled: true }
      if (!r.ok || !r.segs) return { ok: false, error: r.error }
      return { ok: true, segs: r.segs, duration: dur }
    } catch (er) {
      return { ok: false, error: String(er) }
    } finally {
      subProc = null
      try {
        rmSync(tmpWav, { force: true })
      } catch {
        /* 消せなくても結果は変わらない */
      }
    }
  })
}
