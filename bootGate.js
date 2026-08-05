// **どの JS を動かすかの判断だけ。** ファイルも electron も触らない。
//
// ## なぜ boot.js から分けたか（2026-08-06）
//
// ここを間違えると**アプリが起動しなくなる**。自動更新で全員に配られるので、
// 気づいたときには全員の手元に壊れた物が残っている。
// **だから試験できる形でなければならない。**
//
// ところが `boot.js` は読み込まれた瞬間に本体を `require` するので、
// 試験から呼ぶと本体まで動いてしまう。副作用のあるものは試験できない。
// → **判断（ここ）と、実行（boot.js）を分ける。**
//
// ## 素の JS のままにしてある理由
//
// `boot.js` と同じで、**ビルドの成果物（`out/`）より先に動く**。
// TypeScript にすると、ビルドが壊れた日に読み込み係ごと道連れになる。
// 試験（`bootGate.test.ts`）は vitest から素の JS をそのまま読む。
//
// ## 差し替えを**断る**条件が本体
//
// 通すか通さないかで言えば、**断る側が難しい**。通すのは1通りしかないが、
// 断り損ねる形は何通りもある:
//
//   土台が違う      Electron が上がった後に、古い JS を読む＝一番たちが悪い壊れ方
//   同梱の方が新しい  後からインストーラを当てた。差し替えは**過去へ戻す**ことになる
//   前回起動できなかった  1回だけ試して、駄目なら捨てる
//
// **迷ったら同梱を読む。** 同梱は必ず動く（インストーラが入れた物なので）。

/**
 * 版を比べる（`1` なら a が新しい）。
 *
 * semver を丸ごと持ち込まない——ここは `out/` より先に動くので
 * node_modules へ依存させたくない。使うのは `0.1.27` の形だけ。
 * 数として比べる（`0.1.9` < `0.1.27`。文字列の比較だと逆になる）。
 */
function compareVersion(a, b) {
  const part = (s) =>
    String(s || '')
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0)
  const x = part(a)
  const y = part(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

/**
 * **土台の指紋。** JS だけ差し替えてよいのは、土台が同じときだけ。
 *
 * Electron の版が変われば、V8 も Node も差し替わる。そこへ古い JS を載せると
 * 「新しい本体を古いコードが呼ぶ」という、直しようのない壊れ方をする。
 *
 * `format` は package.json の `bundleFormat`。**ffmpeg や同梱物の作りを変えた
 * ときに、こちらで上げる**（版番号では表せないため）。上げると、それ以前に
 * 配った差し替えは全部無効になる——**無効にできることが要点。**
 */
function makeFingerprint(electronVersion, format) {
  return `electron${electronVersion}-format${format}`
}

/**
 * 差し替えた版を読むかどうか。
 *
 * @param {object} o
 * @param {object|null} o.state        userData/bundle/current.json の中身
 * @param {boolean} o.entryExists      その版の main/index.js が実在するか
 * @param {string} o.builtInVersion    同梱（インストーラが入れた物）の版
 * @param {string} o.fingerprint       いま動いている土台の指紋
 * @returns {{use: boolean, discard?: boolean, writeTried?: number, reason: string}}
 */
function decide(o) {
  const { state, entryExists, builtInVersion, fingerprint } = o

  if (!state || typeof state !== 'object') return { use: false, reason: '差し替えは無い' }
  if (typeof state.version !== 'string' || !state.version)
    return { use: false, discard: true, reason: '版が書かれていない' }

  // **土台が違ったら、その場で捨てる。**
  // 残しておくと、次に Electron が戻ったときに生き返ってしまう
  if (state.fingerprint !== fingerprint)
    return {
      use: false,
      discard: true,
      reason: `土台が違う（差し替え ${state.fingerprint} / いま ${fingerprint}）`
    }

  // **同梱の方が新しいか同じなら、差し替えは用済み。**
  // 後からインストーラを当てた形。読むと過去へ戻ることになる
  if (compareVersion(state.version, builtInVersion) <= 0)
    return {
      use: false,
      discard: true,
      reason: `同梱の方が新しい（差し替え ${state.version} / 同梱 ${builtInVersion}）`
    }

  if (!entryExists) return { use: false, discard: true, reason: '中身が無い' }

  // 一度起動できた版は、そのまま読む
  if (state.verified === true) return { use: true, reason: `確認済み v${state.version}` }

  // まだ確かめていない版。**1回だけ試す。**
  // 2回目に来たということは、前回この版で起動できなかったということ
  const tried = Number(state.tried) || 0
  if (tried >= 1)
    return { use: false, discard: true, reason: `v${state.version} は前回起動できなかった` }

  return { use: true, writeTried: tried + 1, reason: `v${state.version} を初めて試す` }
}

module.exports = { compareVersion, makeFingerprint, decide }
