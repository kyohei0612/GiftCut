// **読み込み係。** どの JS を動かすかだけを決める。
//
// ## なぜ挟むか（2026-08-06）
//
// 更新のたびにインストーラが 263MB を書き直している。**本当に変わるのは
// 自前のコードだけ**（`out/` は 737KB）で、Electron 本体 119MB と
// ffmpeg・whisper 93MB は毎回同じ。「今すぐ再起動」で待たされるのはこれが理由。
//
// ※ **落とす量ではない。** 差分ダウンロード（blockmap）は元から効いていて、
//   0.1.26 → 0.1.27 で落ちるのは 1.2MB（1.0%）だった。遅いのは書き直す所だけ。
//   測り方は `scripts/update-diff.mjs`。経緯は `引き継ぎ-差分更新.md`。
//
// JS だけ差し替えられるようにするには、**どこから読むかを選べる場所**が要る。
// それがここ。
//
// ## 判断は bootGate.js にある
//
// ここは**ファイルを触る係**で、通す・断るの判断は持たない。
// 判断に副作用が混ざると試験できず、**起動しなくなる不具合を配ってから気づく**
// ことになるため。条件と、なぜそう決めたかは `bootGate.js`。
//
// ## TypeScript にしていない理由
//
// ここはビルドの成果物（`out/`）より**先**に動く。
// ビルドを通した物に依存すると、ビルドが壊れたときに読み込み係ごと道連れになる。
// 素の JS のまま、`electron-builder.yml` の `files` で同梱する。

const { join, delimiter } = require('path')
const fs = require('fs')
const Module = require('module')
const gate = require('./bootGate.js')

/** 同梱の物（インストーラが入れた、必ず動く方） */
const BUILT_IN = './out/main/index.js'

const pkg = require('./package.json')

/** 記録を残す。**残せなくても起動は続ける**（記録のために落ちる方が困る） */
function note(root, line) {
  try {
    fs.mkdirSync(root, { recursive: true })
    fs.appendFileSync(join(root, 'boot.log'), `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* 残せなくてよい */
  }
}

// **指紋は、ここで作った物をそのまま渡す。**
//
// 動く側（`out/main`）が自分で作り直すと、片方だけ形が変わったときに
// **正しい差し替えまで全部捨てられる**。しかもそう見えない——毎回
// インストーラで更新されるだけなので、誰も気づかないまま差分が死ぬ。
// 作る所を1か所に保つために、環境変数で下ろす。
process.env.GIFTCUT_FINGERPRINT = gate.makeFingerprint(
  process.versions.electron,
  pkg.bundleFormat
)
process.env.GIFTCUT_BUILTIN_VERSION = pkg.version

/** 差し替えた版を読むなら、その入口を返す。読まないなら null */
function pick() {
  let root = ''
  try {
    const { app } = require('electron')
    root = join(app.getPath('userData'), 'bundle')
    const statePath = join(root, 'current.json')

    let state = null
    if (fs.existsSync(statePath)) state = JSON.parse(fs.readFileSync(statePath, 'utf8'))

    const version = state && typeof state.version === 'string' ? state.version : ''
    const entry = version ? join(root, version, 'main', 'index.js') : ''

    const d = gate.decide({
      state,
      entryExists: !!entry && fs.existsSync(entry),
      builtInVersion: pkg.version,
      fingerprint: process.env.GIFTCUT_FINGERPRINT
    })

    if (d.discard) {
      // **捨てるときは、中身ごと消す。**印だけ消すと、置き場所が溜まり続ける
      note(root, `捨てた: ${d.reason}`)
      try {
        fs.rmSync(statePath, { force: true })
        if (version) fs.rmSync(join(root, version), { recursive: true, force: true })
      } catch {
        /* 消せなくても、印が消えていれば読まれない */
      }
      return null
    }
    if (!d.use) return null

    if (d.writeTried != null)
      fs.writeFileSync(statePath, JSON.stringify({ ...state, tried: d.writeTried }), 'utf8')

    note(root, `読む: ${d.reason}`)
    return { entry, root, statePath, version }
  } catch (e) {
    // 読めない・壊れている → 同梱へ。**ここで落とさない**
    if (root) note(root, `判断できなかったので同梱を読む: ${e}`)
    return null
  }
}

/**
 * 差し替えた JS から `electron-updater` などを見つけられるようにする。
 *
 * **node_modules は差し替えに入っていない**（同梱側の asar に在る）。
 * 差し替えは `userData` の下に置くので、そこから上へ辿っても見つからず、
 * `require('electron-updater')` が落ちる。
 *
 * 入れない理由は、それが**土台の側**だから。指紋（Electron の版と
 * `bundleFormat`）が同じなら中身も同じなので、毎回運ぶ意味がない。
 */
function seeAppModules() {
  const here = join(__dirname, 'node_modules')
  process.env.NODE_PATH = process.env.NODE_PATH ? here + delimiter + process.env.NODE_PATH : here
  Module._initPaths()
}

const picked = pick()
if (picked) {
  try {
    seeAppModules()
    // **自分が差し替えで動いていることを、動く側に知らせる。**
    // 自前で調べさせると（`__dirname` を見る等）判断が2か所になる
    process.env.GIFTCUT_BUNDLE_VERSION = picked.version
    process.env.GIFTCUT_BUNDLE_ROOT = picked.root
    require(picked.entry)
  } catch (e) {
    // **読めなかった。同梱へ戻して、その版を捨てる。**
    //
    // ここで捨てておかないと、次の起動で「1回だけ試す」枠を使い切るまで
    // 同じ物をもう一度掴む。読めないと分かっている物を掴み直す意味は無い。
    // 黙って同梱へ落ちるのではなく理由を残す（CLAUDE.md 7番）。
    console.error('[boot] 差し替えた版を読めませんでした。同梱の物で起動します:', e)
    note(picked.root, `読めなかったので捨てた v${picked.version}: ${e}`)
    try {
      fs.rmSync(picked.statePath, { force: true })
      fs.rmSync(join(picked.root, picked.version), { recursive: true, force: true })
    } catch {
      /* 消せなくても、印が消えていれば読まれない */
    }
    require(BUILT_IN)
  }
} else {
  require(BUILT_IN)
}
