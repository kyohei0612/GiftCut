// ffmpeg / ffprobe を「どこから起動し、どう焼くか」。
//
// ## この置き場の役目
//
// 読み込み・波形・サムネ・焼き直し（プロキシ）・書き出し——**ffmpeg を呼ぶ所は全部
// ここを通す**。直に `spawn('ffmpeg', …)` と書かない。理由は3つあり、どれも
// 一度やらかしている:
//
//   1. 配った先に ffmpeg は無い（同梱した物を絶対パスで呼ぶ必要がある）
//   2. 終了時に殺し損ねると、画面が無いまま変換が走り続ける
//   3. 使えるエンコーダは PC ごとに違う（一覧に載っている＝使える、ではない）
//
// ## 同梱しているのは LGPL 版
//
// GPL 版（x264 入り）を同梱すると、アプリ全体を GPL で配ることになり
// ソース公開の義務が付く。LGPL 版には x264 が入っていないので、
// CPU で焼くときは OpenH264 を使う（Cisco が特許料を肩代わりしている配布形態）。
//
// **同梱 ffmpeg に無い物を名指ししない。** 開発機は PATH の ffmpeg（x264 入り）を
// 拾ってしまうので、名指ししても気づけず「配布物でだけ壊れる」型の不具合になる。
import { app } from 'electron'
import { join, resolve } from 'path'
import { existsSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'child_process'
import { ENCODERS, type Enc } from './encoders'

/** 走っている子プロセス。終了時にまとめて殺す */
const liveProcs = new Set<ChildProcess>()
/** 書き出し用の一時フォルダ。終了時にまとめて消す（残すと temp に PNG が数百枚） */
export const liveTmpDirs = new Set<string>()

/**
 * 同梱した ffmpeg / ffprobe の場所。
 *
 * **必ず絶対パスにする。** 書き出しは cwd を一時フォルダに変えて実行するので、
 * 相対パスのままだと「そこには無い」で起動に失敗する（実際に ENOENT で落ちた）。
 */
function ffBin(name: 'ffmpeg' | 'ffprobe'): string {
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  const cands = app.isPackaged
    ? [join(process.resourcesPath, 'ffmpeg', exe)]
    : [
        join(app.getAppPath(), 'resources', 'ffmpeg', exe),
        join(process.cwd(), 'resources', 'ffmpeg', exe)
      ]
  for (const c of cands) {
    if (existsSync(c)) return resolve(c)
  }
  return name // 同梱が無ければ PC のものを使う（開発中はこれで足りる）
}

export const FFMPEG = ffBin('ffmpeg')
export const FFPROBE = ffBin('ffprobe')

/** 実際に1枚焼いてみて、そのエンコーダが本当に使えるか確かめる */
export function tryEncoder(enc: Enc): Promise<boolean> {
  return new Promise((res) => {
    const p = spawn(FFMPEG, [
      '-v', 'error',
      '-f', 'lavfi',
      '-i', 'color=c=black:s=320x240',
      '-frames:v', '1',
      ...enc.args(23, { w: 320, h: 240, fps: 30 }),
      '-f', 'null',
      '-'
    ])
    let done = false
    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      res(ok)
    }
    p.on('error', () => finish(false))
    p.on('close', (code) => finish(code === 0))
    // 応答が無いドライバに引きずられない
    setTimeout(() => {
      try {
        p.kill()
      } catch {
        /* noop */
      }
      finish(false)
    }, 8000)
  })
}

// フィルタは長くなるのでファイルに書いて渡す（Windows のコマンドライン長 32767 を
// 超えると起動できない。テロップが増えるとすぐ超える）。
//
// 渡し方が ffmpeg の版で違う:
//   〜7系: -filter_complex_script <file>
//   8系〜: -/filter_complex <file>（前者は削除された）
// **同梱するのは新しい版だが、PC に入っている古い ffmpeg を使うこともある**ので、
// 実際に試して通った方を使う。
let filterOptPick: Promise<string[]> | null = null
export function filterScriptArgs(file: string): Promise<string[]> {
  void file
  if (!filterOptPick) {
    filterOptPick = (async () => {
      // 判定用の短いフィルタを一時的に置く
      const probe = join(tmpdir(), `giftcut-filterprobe-${Date.now()}.txt`)
      try {
        writeFileSync(probe, 'color=c=black:s=32x32:d=1[v]', 'utf-8')
        for (const opt of ['-/filter_complex', '-filter_complex_script']) {
          const p2 = probe
          const ok = await new Promise<boolean>((res) => {
            const pr = spawn(FFMPEG, ['-v', 'error', opt, p2, '-map', '[v]', '-frames:v', '1', '-f', 'null', '-'])
            pr.on('error', () => res(false))
            pr.on('close', (code) => res(code === 0))
          })
          if (ok) {
            console.log(`[書き出し] フィルタの渡し方: ${opt}`)
            return [opt]
          }
        }
      } catch {
        /* 判定できなければ古い書き方で試す */
      } finally {
        try {
          rmSync(probe, { force: true })
        } catch {
          /* noop */
        }
      }
      return ['-filter_complex_script']
    })()
  }
  return filterOptPick
}

let encoderPick: Promise<Enc> | null = null

/** 使えるエンコーダを1回だけ決める（以降は使い回す） */
export function videoEncoder(): Promise<Enc> {
  if (!encoderPick) {
    encoderPick = (async () => {
      // 上から順に、実際に1枚焼けたものを使う。
      // 最後の1つ（OpenH264）は「これしか無い」ときの砦なので、
      // 試して駄目でもそれを返す（返せる物が無いと書き出し自体ができない）。
      for (const e of ENCODERS.slice(0, -1)) {
        if (await tryEncoder(e)) {
          console.log(`[書き出し] ${e.label} を使います（${e.v}）`)
          return e
        }
      }
      const last = ENCODERS[ENCODERS.length - 1]
      console.log(`[書き出し] ${last.label} を使います（${last.v}）`)
      return ENCODERS[ENCODERS.length - 1]
    })()
  }
  return encoderPick
}

/**
 * 使うエンコーダを外から決め直す。
 *
 * **GPU で焼き始めてから失敗したとき**に、書き出し側が CPU へ切り替えて呼ぶ。
 * 一度切り替えたら以降もそれを使う（同じ失敗を毎回繰り返さないため）。
 */
export function useEncoder(enc: Enc): void {
  encoderPick = Promise.resolve(enc)
}

/**
 * spawn をこれ経由にして、終了時に確実に殺せるようにする（＋任意でタイムアウト）。
 *
 * **直に spawn しないこと。** 追跡から漏れると、アプリを閉じた後も変換が走り続ける。
 *
 * `opts` は 2026-08-03 に足した。**それまで cwd を渡せなかったせいで、
 * 書き出し本体（exportRun）が「直に spawn しないこと」と自分で書いた真下で
 * `spawn(FFMPEG, args, { cwd: tmp })` を呼んでいた**＝一番長く走る物が
 * 追跡から漏れていて、書き出し中に閉じると ffmpeg が裏に残った。
 */
export function trackedSpawn(
  cmd: string,
  args: string[],
  timeoutMs = 0,
  opts?: { cwd?: string }
): ChildProcessWithoutNullStreams {
  const p = spawn(cmd, args, opts)
  liveProcs.add(p)
  let timer: NodeJS.Timeout | null = null
  if (timeoutMs > 0) {
    // 破損ファイルやネットワークドライブで ffprobe がハングしても Promise が永久未解決にならないように
    timer = setTimeout(() => {
      try {
        p.kill('SIGKILL')
      } catch {
        /* noop */
      }
    }, timeoutMs)
  }
  const done = (): void => {
    liveProcs.delete(p)
    if (timer) clearTimeout(timer)
  }
  p.on('close', done)
  p.on('error', done)
  return p
}

/** アプリ終了時。走っている物を全部殺し、一時フォルダを全部消す */
export function killAllChildren(): void {
  for (const p of Array.from(liveProcs)) {
    try {
      p.kill('SIGKILL')
    } catch {
      /* noop */
    }
  }
  liveProcs.clear()
  for (const d of Array.from(liveTmpDirs)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* noop */
    }
  }
  liveTmpDirs.clear()
}

/**
 * 動画に音声があるか。書き出しで音をつなぐかどうかの判定に使う。
 *
 * ffprobe が居ない等は `'unknown'` を返す。呼ぶ側は**「音あり」として扱う**こと
 * （無いものとして進めると、音の出ない動画が黙って出来上がる）。
 */
export function hasAudioStream(path: string): Promise<boolean | 'unknown'> {
  return new Promise((res) => {
    const p = trackedSpawn(FFPROBE, [
      '-v',
      'error',
      '-select_streams',
      'a',
      '-show_entries',
      'stream=index',
      '-of',
      'csv=p=0',
      path
    ], 20000)
    let out = ''
    p.stdout?.on('data', (d) => {
      out += d.toString()
    })
    p.on('error', () => res('unknown')) // ffprobe が見つからない等
    p.on('close', () => res(out.trim().length > 0))
  })
}
