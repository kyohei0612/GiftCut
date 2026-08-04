// 書き出しの**走らせる側**。ffmpeg の起動・進捗・中止・失敗したときの控え。
//
// ## ここに無い物
//
// **フィルタグラフの組み立ては ./exportOverlays ・ ./exportSegments ・ ./exportAudioMix
// にある。** 受け口（IPC・出す先を
// 決める・PNG を焼く）は ./exportRun。ここは「組み上がった引数を渡されて、
// 走らせて、結果を返す」だけを持つ。
//
// ## 中止の印がここに居る理由
//
// 「いま書き出し中か」は**自動更新が見ている**（途中で再起動されると、何分も
// かけた変換が消えて、しかも出来かけのファイルが残る）。走っているプロセスを
// 知っているのはここだけなので、印も一緒に置いてある。
//
// **ffmpeg が始まる前でも中止を覚える。** 書き出しの前半はテロップの画像作りで、
// ここは ffmpeg がまだ動いていない。以前は「動いていなければ何もしない」だった
// ので、その間に中止を押しても黙って書き出しが続いていた。
//
// ## 中身
//
// - `isExporting` … いま書き出し中か（自動更新が見ている）
// - `beginExport` … 中止の印を落とす。書き出しを始める頭で呼ぶ
// - `cancelExport` … 中止の印を立て、動いていれば殺す
// - `pipeProgress` … ffmpeg の言い分を溜めつつ `time=` から進捗%を送る
// - `trimLog` … 言い分を切り詰める。**頭も残す**
// - `saveDiag` … 失敗したときの控えを一時フォルダへ残す
// - `runExportFfmpeg` … 走らせて結果を返す。GPU で失敗したら CPU でやり直す
import { existsSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
// **spawn は import しない。** 起動は必ず trackedSpawn 経由
// （直に spawn すると、アプリを閉じた後も変換が走り続ける＝追跡から漏れる）
import type { ChildProcess, ChildProcessWithoutNullStreams } from 'child_process'
import { ENCODERS } from './encoders'
import { FFMPEG, liveTmpDirs, trackedSpawn, tryEncoder, useEncoder } from './ffmpegRun'

// 書き出し中の ffmpeg プロセス（キャンセル用）。exportCanceled でユーザー中断とエラーを区別する。
let currentExportFf: ChildProcess | null = null
let exportCanceled = false

/**
 * いま書き出している最中か。
 *
 * **自動更新が見ている。** 書き出しの途中で再起動されると、何分もかけた変換が
 * 消えて、しかも出来かけのファイルが残る。
 */
export function isExporting(): boolean {
  return !!currentExportFf
}

/**
 * 中止の印を落とす。**書き出しを始める頭で呼ぶ。**
 *
 * 前回の中止が残っていると、次の書き出しが始まった瞬間に止まる。
 */
export function beginExport(): void {
  exportCanceled = false
}

/** 中止。**ffmpeg が始まる前でも印だけは立てる**（上の注意書きのとおり） */
export function cancelExport(): { ok: boolean } {
  exportCanceled = true
  if (currentExportFf) {
    try {
      currentExportFf.kill('SIGKILL')
    } catch {
      /* noop */
    }
    return { ok: true }
  }
  return { ok: false }
}

/**
 * ffmpeg の言い分を溜めつつ、`time=` を出力尺で割って進捗%を送る。
 *
 * **GPU で失敗して CPU でやり直すときに、まったく同じ物が要る。**
 * 2026-08-03 まで同じ11行が2か所に書いてあった（＝片方だけ直せる形）。
 * 戻り値は「いままでに溜まった言い分」を取り出す関数。
 */
function pipeProgress(
  ff: ChildProcessWithoutNullStreams,
  totalDur: number,
  onProgress: (percent: number) => void
): () => string {
  let err = ''
  ff.stderr.on('data', (d) => {
    const s = d.toString()
    err += s
    const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(s)
    if (m && totalDur > 0) {
      const cur = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3])
      onProgress(Math.min(99, Math.max(0, Math.round((cur / totalDur) * 100))))
    }
  })
  return () => err
}

/**
 * ffmpeg の言い分を切り詰める。**頭も残す。**
 *
 * 前は末尾だけ残していた。しかし「なぜ最初の1フレームも作れなかったか」は
 * 頭の方に出る（フィルタの組み立て失敗・入力が開けない など）。末尾には
 * "Conversion failed!" のような結果しか無いので、**本当の原因が読めない**。
 * 実際に、書き出し失敗の報告を受けても切り分けられなかった。
 */
function trimLog(s: string, keep: number): string {
  if (s.length <= keep * 2) return s
  return `${s.slice(0, keep)}\n……（中略 ${s.length - keep * 2}字）……\n${s.slice(-keep)}`
}

/**
 * 書き出しが失敗したときの控え。画面のお知らせは1行しか出ないので、
 * 原因を切り分けられるだけの中身をファイルに残す。
 */
function saveDiag(o: ExportSpawnOpts, why: string, detail = ''): void {
  try {
    const lines = [
      why,
      `使った ffmpeg: ${FFMPEG}（ある: ${existsSync(FFMPEG)}）`,
      `作業フォルダ: ${o.tmp}（ある: ${existsSync(o.tmp)}）`,
      `出力先: ${o.outPath}`,
      // **数がおかしいときは、ここを見れば分かる。**
      // テロップ1枚が入力1つになるので、増えすぎるとコマンドラインの
      // 上限や開けるファイル数に当たる。落ちてから数えられないと切り分けできない
      `入力の数: ${o.args.filter((a) => a === '-i').length}（うちテロップ画像 ${o.pngCount} 枚）`,
      `フィルタの長さ: ${o.filterLen}字`
    ]
    if (detail) lines.push('---- ffmpeg の言い分 ----', detail)
    // userData は確認の後片付けで消えることがあるので、OS の一時フォルダへ
    writeFileSync(join(tmpdir(), 'giftcut-last-export-error.txt'), lines.join('\n'), 'utf-8')
  } catch {
    /* 控えが残せなくても続行 */
  }
}

export interface ExportSpawnOpts {
  /** 組み上がった ffmpeg の引数（出力先まで入っている） */
  args: string[]
  /** 作業フォルダ。テロップPNGとフィルタ本文が入っている。cwd もここ */
  tmp: string
  /** 出力先（絶対パス）。中断したときに書きかけを消すのにも使う */
  outPath: string
  /** 進捗%を出すための出力尺。0なら進捗を出さない */
  totalDur: number
  /** CPU でやり直すときにエンコーダの引数を組み直すのに要る */
  crf: number
  width: number
  height: number
  outFps: number
  /** 控え用。テロップ画像の枚数 */
  pngCount: number
  /** 控え用。フィルタ本文の長さ */
  filterLen: number
  onProgress: (percent: number) => void
}

export type ExportResult =
  | { ok: true; outPath: string }
  | { ok: false; error?: string; canceled?: boolean }

/**
 * ffmpeg を走らせて結果を返す。**GPU で失敗したら CPU でやり直す。**
 *
 * 起動時は通ったのに、長い書き出しの途中でドライバが落ちることがある。
 * ここで諦めると「書き出せないアプリ」になってしまう。
 *
 * 作業フォルダの後片付けは**全部この中**でやる（呼ぶ側は消さない）。
 * 片付けを外に出すと、やり直しの前に消される事故が起きる（下の注意書き）。
 */
export async function runExportFfmpeg(o: ExportSpawnOpts): Promise<ExportResult> {
  const { args, tmp, outPath, totalDur, crf, width, height, outFps, onProgress } = o
  const cleanup = (): void => {
    currentExportFf = null
    liveTmpDirs.delete(tmp)
    try {
      rmSync(tmp, { recursive: true, force: true }) // 一時PNGを削除（蓄積防止）
    } catch {
      /* noop */
    }
  }
  // 準備（テロップの画像作り）の間に中止を押されていたら、ここで止める。
  // ここを見ないと、押しても書き出しが最後まで進んでしまう
  if (exportCanceled) {
    cleanup()
    return { ok: false, canceled: true }
  }
  return await new Promise<ExportResult>((resolve) => {
    // cwd=tmp: テロップPNG・フィルタを相対パスで渡してコマンドライン長を抑える
    // （元動画・出力先は絶対パスなので cwd の影響を受けない）
    // **trackedSpawn を通す。** 直に spawn していたので、書き出し中にアプリを
    // 閉じると killAllChildren の管理外で ffmpeg が裏に残っていた（2026-08-03 に修正）
    const ff = trackedSpawn(FFMPEG, args, 0, { cwd: tmp })
    currentExportFf = ff
    const errOf = pipeProgress(ff, totalDur, onProgress)
    ff.on('error', (er) => {
      saveDiag(o, `ffmpeg起動失敗: ${er.message}`)
      cleanup()
      resolve({ ok: false, error: 'ffmpeg起動失敗: ' + er.message })
    })
    // async にしているのは、GPU で失敗したときに「CPU 側で使える物」を
    // その場で試してから焼き直すため（x264 があるとは限らない）
    ff.on('close', async (code) => {
      // **ここで片付けてはいけない。** 片付けはテロップPNGを置いた作業フォルダを
      // 消す。GPU で失敗して CPU でやり直すとき、その作業フォルダを使うので、
      // 先に消すと「作業フォルダが無い」で必ず失敗する（実際にそうなった）。
      // やり直しの必要が無いと分かってから片付ける。
      if (exportCanceled) {
        cleanup()
        // 中断: 書きかけの出力ファイルを消してキャンセル扱いで返す
        try {
          rmSync(outPath, { force: true })
        } catch {
          /* noop */
        }
        resolve({ ok: false, canceled: true })
        return
      }
      if (code === 0) {
        cleanup()
        resolve({ ok: true, outPath })
        return
      }
      const usedGpu = args.some((a) => a === 'h264_nvenc' || a === 'h264_qsv' || a === 'h264_amf')
      if (usedGpu && !exportCanceled) {
        // CPU で焼き直す。**x264 があるとは限らない**（配布物は LGPL 版で、
        // x264 は入っていない）ので、実際に使える方を選ぶ。
        const x264 = ENCODERS.find((e) => e.v === 'libx264')!
        const oh264 = ENCODERS.find((e) => e.v === 'libopenh264')!
        const cpu = (await tryEncoder(x264)) ? x264 : oh264
        console.warn(`[書き出し] GPU で失敗したので ${cpu.label} でやり直します`)
        useEncoder(cpu) // 以降もこれを使う
        // エンコーダの指定は '-c:v' から '-pix_fmt' の手前までに入っている。
        // そこを丸ごと差し替える（GPU 用の細かい指定も一緒に消える）。
        const fixed = [...args]
        const from = fixed.indexOf('-c:v')
        const to = fixed.indexOf('-pix_fmt')
        if (from >= 0 && to > from)
          fixed.splice(from, to - from, ...cpu.args(crf, { w: width, h: height, fps: outFps }))
        const ff2 = trackedSpawn(FFMPEG, fixed, 0, { cwd: tmp })
        currentExportFf = ff2
        const err2Of = pipeProgress(ff2, totalDur, onProgress)
        ff2.on('error', (er) => {
          cleanup()
          resolve({ ok: false, error: 'ffmpeg起動失敗: ' + er.message })
        })
        ff2.on('close', (c2) => {
          cleanup()
          if (c2 === 0) resolve({ ok: true, outPath })
          else {
            // 1回目（GPU）の言い分も一緒に残す。やり直しの失敗だけ見ても、
            // そもそもなぜ GPU が駄目だったのかが分からない
            saveDiag(
              o,
              `CPUでのやり直しも失敗 (code ${c2})`,
              `【1回目 GPU (code ${code})】\n${trimLog(errOf(), 1500)}\n\n【2回目 CPU】\n${trimLog(err2Of(), 1500)}`
            )
            resolve({ ok: false, error: `ffmpeg失敗 (code ${c2})\n` + err2Of().slice(-600) })
          }
        })
        return
      }
      cleanup()
      saveDiag(o, `ffmpeg失敗 (code ${code})`, trimLog(errOf(), 2000))
      resolve({ ok: false, error: `ffmpeg失敗 (code ${code})\n` + errOf().slice(-600) })
    })
  })
}
