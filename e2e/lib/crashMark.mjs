// 「前回は落ちた」印を userData に置く（確認用の素材づくりが使う）。
//
// 2026-10-11 から、アプリが下書きの復元を聞くのは**前回が正常に終わらなかったとき**だけ
// （本人の指定: 普通に起動したら新規でよい、毎回聞くな）。印が無いと「復元しますか」が出ず、
// 復元の経路で開く確認（e2e の1章・bench の読み込み）が始まらない。
//
// 2026-11-08 まで e2e の素材づくりだけが印を置いていて、bench の素材づくり（./fixture.mjs）は
// 置いていなかった。bench は 10-11 以降ずっと起動直後の「復元」待ちで落ちていた（誰も気づかなかった）。
// 印の置き方を2か所に書くとまた片方だけ古くなるので、ここ1つから呼ぶ。
// 印の場所はアプリ側 main/crashLog と同じ（userData/crash/running.json）。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function markPrevRunCrashed(userData, extra = {}) {
  mkdirSync(join(userData, 'crash'), { recursive: true })
  writeFileSync(
    join(userData, 'crash', 'running.json'),
    JSON.stringify({ at: new Date().toISOString(), ...extra }),
    'utf-8'
  )
}
