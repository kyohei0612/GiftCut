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

import { app } from 'electron'
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { spawn, type ChildProcess } from 'child_process'
import { get as httpsGet } from 'https'
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
    const p = spawn(exe, args)
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
