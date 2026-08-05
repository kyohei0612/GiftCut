// **落ちたことを、アプリ自身が知る。**
//
// ## なぜ要るか（2026-08-05）
//
// 外部のレビューで「クラッシュレポートが手動運用だと、一般の人は落ちたときに
// わざわざ書き出して送ってくれない。黙ってアンインストールするだけ」と指摘された。
// 調べたら、**その手前で止まっていた**——`crashReporter` も `render-process-gone` も
// `uncaughtException` も1つも無く、**アプリは落ちたことすら知らなかった。**
//
// 「送る仕組みが無い」ではなく「**記録が無い**」が本当の状態だった。
//
// ## 何を送るか、送らないか
//
// **勝手に外へは出さない。** 落ちた記録は userData に置くだけで、
// 送るかどうかは次の起動で本人が決める（画面側が案内を出す）。
//
//   入れる  版・OS・落ちた種類・出た時刻・エラーの文言と発生位置
//   入れない **プロジェクトの中身・素材の道・テロップの文字**
//
// 素材の道には人の名前やファイル名が入る。**不具合の再現には要らない**ので、
// `scrubPath` で名前を落としてから書く。「念のため全部入れる」をやると、
// 送るのが怖くなって結局送られない。
//
// ## 「前回落ちた」の見分け方
//
// 起動したら印のファイルを置き、**正常に終わるときに消す**。
// 次の起動でまだ在れば、前回は正常に終わっていない。
//
// 落ちた瞬間に書けるとは限らない（電源断・強制終了・OOM）ので、
// **「終わるときに消す」側に倒す**——書く方に倒すと、書けなかった落ち方を丸ごと見逃す。

import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 記録の置き場（userData 直下。「設定・保存データのフォルダを開く」で辿れる所） */
const dir = (): string => join(app.getPath('userData'), 'crash')
/** 起動中を示す印。正常終了で消す */
const markPath = (): string => join(dir(), 'running.json')
const logPath = (): string => join(dir(), 'crash.log')

/**
 * 人の名前が混ざる所を落とす。
 *
 * Windows の道は `C:\Users\<名前>\...` なので、そのまま書くと**本名が載る**。
 * 素材のファイル名も同様（`2026-08-05 打ち合わせ_田中さん.mp4` など）。
 * 不具合を追うのに要るのは「どの層で落ちたか」であって、どのファイルかではない。
 */
export function scrubPath(s: string): string {
  return s
    .replace(/([A-Za-z]:\\Users\\)[^\\/:*?"<>|\r\n]+/g, '$1<利用者>')
    .replace(/(\/Users\/)[^/\r\n]+/g, '$1<利用者>')
    .replace(/(\/home\/)[^/\r\n]+/g, '$1<利用者>')
}

export interface CrashEntry {
  /** いつ（ISO） */
  at: string
  /** 何が落ちたか */
  kind: 'render-process-gone' | 'child-process-gone' | 'uncaughtException' | 'renderer-error'
  /** 落ちた理由（Electron が返す reason / 例外の文言） */
  detail: string
}

/** 記録を1件足す（**書けなくても落とさない**。記録のために本体を巻き添えにしない） */
export function record(kind: CrashEntry['kind'], detail: string): void {
  try {
    mkdirSync(dir(), { recursive: true })
    const e: CrashEntry = {
      at: new Date().toISOString(),
      kind,
      detail: scrubPath(String(detail)).slice(0, 4000)
    }
    appendFileSync(logPath(), JSON.stringify(e) + '\n', 'utf-8')
  } catch {
    /* 記録できなくても本体は動かす */
  }
}

/**
 * 起動したことを印に残す。**正常終了で `clearMark()` を呼ぶこと。**
 *
 * @returns 前回の起動が正常に終わっていなければ、そのときの印の中身
 */
export function startSession(version: string): { crashed: boolean; last?: unknown } {
  let last: unknown
  let crashed = false
  try {
    if (existsSync(markPath())) {
      crashed = true
      try {
        last = JSON.parse(readFileSync(markPath(), 'utf-8'))
      } catch {
        last = null
      }
    }
    mkdirSync(dir(), { recursive: true })
    writeFileSync(
      markPath(),
      JSON.stringify({ at: new Date().toISOString(), version, platform: process.platform }),
      'utf-8'
    )
  } catch {
    /* 印が置けない環境では、落ちたかどうかは分からないままにする */
  }
  return { crashed, last }
}

/** 正常に終わった。印を消す */
export function clearMark(): void {
  try {
    rmSync(markPath(), { force: true })
  } catch {
    /* 消せなくても、次の起動で「落ちた」と出るだけ */
  }
}

/** 直近の記録を読む（新しい順・既定10件）。画面側の案内に載せる */
export function recentCrashes(n = 10): CrashEntry[] {
  try {
    return readFileSync(logPath(), 'utf-8')
      .split('\n')
      .filter(Boolean)
      .slice(-n)
      .map((l) => JSON.parse(l) as CrashEntry)
      .reverse()
  } catch {
    return []
  }
}

/**
 * main 側の落ち方を全部拾う。`app.whenReady()` の中で1回だけ呼ぶ。
 *
 * **`uncaughtException` を握っても、そこで終わらせない。**
 * 握って握りつぶすと、壊れた状態のまま動き続けて**もっと分かりにくい壊れ方**をする。
 * 記録してから、いつもどおり落とす。
 */
export function installCrashHooks(): void {
  app.on('render-process-gone', (_e, _wc, d) => record('render-process-gone', d.reason))
  app.on('child-process-gone', (_e, d) => record('child-process-gone', `${d.type}: ${d.reason}`))
  process.on('uncaughtException', (err) => {
    record('uncaughtException', err?.stack ?? String(err))
    throw err
  })
}
