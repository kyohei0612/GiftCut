// 更新の記録をファイルに残す。
//
// ## なぜ要るか（2026-08-06）
//
// 「更新が遅い」「差分になっていないのでは」を調べようとして、
// **調べる手段が1つも無い**ことに気づいた。
//
//   何MB落としたか        分からない（electron-updater はログに出すが、
//                         配布版では console がどこにも出ない）
//   入れ替えに何秒か      分からない（体感だけが根拠）
//   差分が効いているか    分からない
//
// **測れないまま作り替えると、速くなったかを確かめられない。**
// 今日ずっと「測る側が壊れていないか」を疑ってきたのに、
// ここは測る側が存在しなかった。
//
// ## 何を残すか
//
// electron-updater が吐く行をそのまま。差分の実績はこの中に出る:
//
//   `Download block maps (base=... new=...)`
//   `Full: 121,514 KB, To download: 3,240 KB (3%)`   ← **これが見たい**
//
// 加えて、こちらで測った時間（確認・落とし始め・落とし終わり・入れ替え開始）。
//
// ## 置き場と大きさ
//
// userData/update.log。**回さないと際限なく増える**ので、
// 大きくなったら古い方を捨てる（測定の一時フォルダで 82GB 貯めた前科がある）。

import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** これを超えたら1回だけ退避して新しくする（バイト） */
const MAX_BYTES = 512 * 1024

const logPath = (): string => join(app.getPath('userData'), 'update.log')

/** 1行足す。**書けなくても本体は止めない**（記録のために更新を巻き添えにしない） */
export function logUpdate(line: string): void {
  try {
    const p = logPath()
    mkdirSync(app.getPath('userData'), { recursive: true })
    // 大きくなったら1つ前として退避（2世代だけ持つ）
    if (existsSync(p) && statSync(p).size > MAX_BYTES) renameSync(p, p + '.1')
    appendFileSync(p, `${new Date().toISOString()} ${line}\n`, 'utf-8')
  } catch {
    /* 書けなくても更新は動く */
  }
}

/**
 * 経過を測る道具。**「始まった」だけでは遅さの場所が分からない。**
 *
 * 確認 → 落とし始め → 落とし終わり → 入れ替え開始、の各区間を出す。
 * どこが長いかが分かって初めて、直す場所が決まる。
 */
export function makeStopwatch(): (label: string) => void {
  let last = Date.now()
  const start = last
  return (label: string): void => {
    const now = Date.now()
    logUpdate(
      `[経過] ${label}  この区間 ${((now - last) / 1000).toFixed(1)}秒 ` +
        `／ 始めから ${((now - start) / 1000).toFixed(1)}秒`
    )
    last = now
  }
}
