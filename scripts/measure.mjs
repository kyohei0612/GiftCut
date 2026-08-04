// **測り直しの口**。`npm run measure`
//
// ## 何のためか
//
// 「やらない／あとにする」と決めた判断には数字が添えてある。
// **その根拠が古くなっても、誰も気づかない。**
//
// 実例（2026-08-03）: 「エフェクトのD&Dは、札を増やすと `useAppWiring` が上限
// ぎりぎりなので、リファクタで場所を空けてから」と見送っていたが、
// **実際に測ったら壁に当たらなかった**（札は `useBandDrag` が持っていて、
// `useAppWiring` は受け渡すだけ。1行も増えなかった）。何日か眠っていた。
//
// → 見送りには「測った日」を書く。そして**測り直せる口**を用意する。それがこれ。
//
// ## ここに出す物・出さない物
//
// **`npm run verify` が出す数字は、ここに出さない。**
// 同じ物を2か所に持つと、片方が必ず古くなる（記録でも1度やった——
// `やること.md` に「残り0行」と書いた表が、同じ日のうちに全部嘘になった）。
//
//   verify が出す   … ファイルの行数（`fileSize.test.ts` が毎回名指しする）
//   ここが出す      … verify が出さない物（下の3つ）
//
// ## git に入れない（出力も、この結果も）
//
// 呼ぶたびに数える。**生成物を置くと腐る**——`lib/telopAnim.ts` に本体の無い
// 説明だけが残って誰も気づかなかったのと、同じ壊れ方をする。
//
// ## 数えられない物は「数えられない」と出す
//
// 「境目をまたぐ名前の数」（割る／割らないの判断に使う唯一の数字）は
// **自動では出せない**。測り方が「先に切り出してから `npm run typecheck` を回して
// `Cannot find name` を全部拾う」で、**割らないと測れない**ため。
// 無い物を無いと出すのは正しい（次に読む人が「measure が全部見ている」と
// 誤解しないように、最後に明記する）。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['node_modules', 'out', 'dist', '.git', 'shots', '.company'])

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e)) out.push(p)
  }
  return out
}
const rel = (p) => relative(REPO, p).split(sep).join('/')
const files = walk(join(REPO, 'src')).map((p) => ({ path: rel(p), src: readFileSync(p, 'utf8') }))

const bar = (s) => `\n\x1b[1m${s}\x1b[0m`
const dim = (s) => `\x1b[90m${s}\x1b[0m`

// ---------------------------------------------------------------------------
// ① 受け取り口の `any`
//
// 区画・フックは「受け取る物の形」を自分で宣言する。そこが `any` だと、
// **存在しない物を触っても、引数の数を間違えても、型検査が素通りする。**
// 2026-08-03 の不具合11件のうち2件がその型。
//
// 心臓の受け口（`*Context.tsx`）は同じ日に 0 にして `ctxTypes.test.ts` で止めた。
// **フックの `deps` はまだ残っている**ので、その残数をここで出す
// （閾値で赤くはしない——いま 0 にはできないので、常時赤の検査は効かなくなる）。
// ---------------------------------------------------------------------------
function anyReport() {
  const rows = []
  for (const f of files) {
    if (!f.path.startsWith('src/renderer/src/state/')) continue
    if (/\.test\.tsx?$/.test(f.path)) continue
    let n = 0
    for (const l of f.src.split(/\r?\n/)) {
      const t = l.trimStart()
      if (t.startsWith('//') || t.startsWith('*')) continue
      if (/\bany\b/.test(l)) n++
    }
    if (n) rows.push([f.path, n])
  }
  rows.sort((a, b) => b[1] - a[1])
  const total = rows.reduce((s, r) => s + r[1], 0)
  // 数え方: `: any` だけでなく `as any` `Record<string, any>` `any[]` も1件に数える
  // （どれも「型検査が素通りする」点では同じ）。コメント行だけ除く。
  // **`grep -c ": any"` より多く出る**ので、その数字と突き合わせないこと
  console.log(bar(`① any の残り（state/ 配下・コメント行は除く）  合計 ${total}件`))
  if (!total) {
    console.log('   無し')
    return
  }
  for (const [p, n] of rows.slice(0, 8)) console.log(`   ${String(n).padStart(4)}  ${p}`)
  if (rows.length > 8) console.log(dim(`   … ほか ${rows.length - 8}ファイル`))
  console.log(dim('   心臓の受け口（*Context.tsx）は 0 で固定（shared/ctxTypes.test.ts が止める）'))
}

// ---------------------------------------------------------------------------
// ② 正典を呼んでいる場所の数
//
// **台帳（shared/canon.ts）は「在り処」しか書かない。**
// だから正典を引いただけでは「呼んでいる道が全部そこを通っているか」は分からない。
// 2026-08-03 の事故2件はどちらもこれ（端を伸ばす道／貼り付け・複製が通っていなかった）。
//
// 数え方をここで決めておく（決めないと、数える人ごとに違う数字が出る）:
//
//   数える   … src 配下の .ts / .tsx で、名前が出てくる**ファイル数**
//   除く     … 正典自身のファイル・台帳（canon.ts）・テスト（*.test.*）
//   注意     … **コメント内の言及も1件と数える**（安く正しく除く手が無い）。
//              「1」と出たら実物を見ること
// ---------------------------------------------------------------------------
function canonReport() {
  const src = readFileSync(join(REPO, 'src/shared/canon.ts'), 'utf8')
  const names = [...src.matchAll(/^ {4}name: '([^']+)'/gm)].map((m) => m[1])
  const homes = [...src.matchAll(/^ {4}home: '([^']+)'/gm)].map((m) => m[1])
  const whats = [...src.matchAll(/^ {4}what:/gm)].length
  // **読み違えたら黙って進まない。** 台帳の書き方が変わったらここで落ちる
  if (names.length !== whats || homes.length !== whats)
    throw new Error(
      `台帳が読めない（what ${whats} / name ${names.length} / home ${homes.length}）。` +
        'canon.ts の書き方が変わったら scripts/measure.mjs も直すこと'
    )

  console.log(bar(`② 正典を呼んでいる場所（ファイル数。台帳・自分自身・テストは除く）`))
  const rows = names.map((name, i) => {
    const home = homes[i]
    const re = new RegExp(`\\b${name}\\b`)
    const n = files.filter(
      (f) =>
        f.path !== home &&
        !f.path.endsWith('/canon.ts') &&
        !/\.test\.tsx?$/.test(f.path) &&
        re.test(f.src)
    ).length
    return [name, n, home]
  })
  rows.sort((a, b) => b[1] - a[1])
  for (const [name, n, home] of rows)
    console.log(`   ${String(n).padStart(4)}  ${name.padEnd(22)} ${dim(home)}`)
  console.log(dim('   コメント内の言及も1件に数える。少ない物は実物を見ること'))
}

// ---------------------------------------------------------------------------
// ③ 借金（返す方向にだけ動かす物）
//
// どれも検査が上限を持っているが、**赤くなるまで何も言わない**ので
// 「あといくつ返せるか／近づいているか」が分からない。ここで毎回出す。
// ---------------------------------------------------------------------------
function debtReport() {
  const read = (p) => readFileSync(join(REPO, p), 'utf8')
  const countSet = (src, name) => {
    const at = src.indexOf(`const ${name} = new Set([`)
    if (at < 0) throw new Error(`${name} が読めない`)
    const end = src.indexOf('])', at)
    return src
      .slice(at, end)
      .split(/\r?\n/)
      .filter((l) => /^\s*'/.test(l)).length
  }
  const cap = (src, name) => {
    const m = new RegExp(`${name}\\.size\\)\\s*\\.toBeLessThanOrEqual\\((\\d+)\\)`).exec(src)
    return m ? Number(m[1]) : '?'
  }
  const readable = read('src/shared/readability.test.ts')
  const canon = read('src/shared/canon.ts')
  const noDup = read('src/shared/noDuplicate.test.ts')

  // 生の式の写しは台帳の debt を合計する。
  // **行頭の字下げで拾わない**——`debt: { '…': 1 }` と1行で書く物があり、
  // 字下げを当てにすると静かに数え落とす（実際 3 を 2 と数えた）
  const owed = [...canon.matchAll(/'(?:src\/[^']+)':\s*(\d+)/g)].reduce(
    (s, m) => s + Number(m[1]),
    0
  )
  const owedCap = /expect\(total\)\.toBeLessThanOrEqual\((\d+)\)/.exec(noDup)?.[1] ?? '?'

  console.log(bar('③ 借金（返す方向にだけ動かす）'))
  const line = (label, n, max, where) =>
    console.log(`   ${String(n).padStart(4)} / ${String(max).padEnd(4)} ${label.padEnd(24)} ${dim(where)}`)
  line('取説なしで500行超', countSet(readable, 'DEBT_INDEX'), cap(readable, 'DEBT_INDEX'),
    'readability.test.ts')
  line('冒頭コメント無し', countSet(readable, 'DEBT_HEAD'), cap(readable, 'DEBT_HEAD'),
    'readability.test.ts')
  line('正典のある式の写し', owed, owedCap, 'canon.ts の CANON[].debt')
}

console.log(dim('verify が出す数字（ファイルの行数）はここに出さない。npm run verify を見ること'))
anyReport()
canonReport()
debtReport()
console.log(
  bar('自動では出せない数字') +
    '\n   境目をまたぐ名前の数（割る／割らないの判断に使う唯一の数字）。' +
    '\n   ' +
    dim('測り方は「先に切り出して npm run typecheck を回し Cannot find name を全部拾う」') +
    '\n   ' +
    dim('＝割らないと測れない。手順は 引き継ぎ-心臓の分け直し.md の「7. 測る道具の穴」') +
    '\n'
)
