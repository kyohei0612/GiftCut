// **読み込み係。** どの JS を動かすかだけを決める。
//
// ## なぜ挟むか（2026-08-06）
//
// 更新のたびに 263MB を全部入れ替えている。**本当に変わるのは 2.6MB**
// （自前のコード）で、Electron 本体 119MB と ffmpeg・whisper 93MB は毎回同じ。
// 「今すぐ再起動」で十数秒待たされるのはこれが理由（`引き継ぎ-差分更新.md`）。
//
// JS だけ差し替えられるようにするには、**どこから読むかを選べる場所**が要る。
// それがここ。
//
// ## いまは何も変わらない
//
// 差し替える仕組み（落とす・展開する）は**まだ入っていない**ので、
// `userData/bundle/` は常に空で、必ず同梱の物を読む。**挙動は 1ミリも変わらない。**
//
// **先にこれだけ配る**のが要点。読み込み係が全員に行き渡ってからでないと、
// 差分を配っても古い版は受け取れない（受け取る口が無いので）。
//
// ## 壊れたときに戻れること（ここが本体）
//
//   1  差し替えた版を読む前に「試した回数」を数える
//   2  無事に起動できたら、本体側が `verified` を立てる
//   3  次に来たとき `verified` が無いまま回数だけ増えていたら
//      ＝**前回この版で起動できなかった**。同梱の物へ戻す
//
// 自動更新は全員に配られるので、**壊れた JS を掴んだまま起動しなくなる**のが
// 一番まずい。読めなければ黙って同梱へ落ちるのではなく、理由を残して落ちる。
//
// ## TypeScript にしていない理由
//
// ここはビルドの成果物（`out/`）より**先**に動く。
// ビルドを通した物に依存すると、ビルドが壊れたときに読み込み係ごと道連れになる。
// 素の JS のまま、`electron-builder.yml` の `files` で同梱する。

const { join } = require('path')
const fs = require('fs')

/** 同梱の物（いままでどおりの道） */
const BUILT_IN = './out/main/index.js'

/** 差し替えた版を読むか決める。読まないなら null */
function pickBundle() {
  try {
    const { app } = require('electron')
    const root = join(app.getPath('userData'), 'bundle')
    const statePath = join(root, 'current.json')
    if (!fs.existsSync(statePath)) return null

    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    if (!state || typeof state.version !== 'string' || !state.version) return null

    const entry = join(root, state.version, 'main', 'index.js')
    if (!fs.existsSync(entry)) return null

    // **一度起動できた版だけ、そのまま読む。**
    if (state.verified === true) return entry

    // まだ確かめていない版。**1回だけ試す。**
    // 2回目に来たということは、前回この版で起動できなかったということ
    const tried = Number(state.tried) || 0
    if (tried >= 1) {
      fs.writeFileSync(
        join(root, 'rejected.log'),
        `${new Date().toISOString()} v${state.version} は起動できなかったので捨てた\n`,
        { flag: 'a' }
      )
      fs.rmSync(statePath, { force: true })
      return null
    }
    fs.writeFileSync(statePath, JSON.stringify({ ...state, tried: tried + 1 }), 'utf8')
    return entry
  } catch {
    // 読めない・壊れている → 同梱へ。**ここで落とさない**
    return null
  }
}

const picked = pickBundle()
if (picked) {
  try {
    require(picked)
  } catch (e) {
    // 差し替えた版が読めなかった。**同梱へ戻して、理由を残す**
    // （黙って落ちると「なぜ古いままなのか」が誰にも分からなくなる）
    console.error('[boot] 差し替えた版を読めませんでした。同梱の物で起動します:', e)
    require(BUILT_IN)
  }
} else {
  require(BUILT_IN)
}
