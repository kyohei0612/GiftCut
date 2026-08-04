// **配線から「素通しの名前」を数える。**（`npm run passthrough`）
//
// ## 何を数えるか
//
// `useAppWiring` は心臓（context）から名前を取り出し、それを各フックの deps へ
// 配っている。そのうち **「取り出して、フックへ渡すだけ」の名前**は、
// 渡すのをやめて**フック側に自分で心臓を見に行かせれば消せる**。
//
//   const { iconAuto, setIconAnchorPos } = useIconsCtx()   ← ここの1行と
//   useTelopBox({ …, iconAuto, setIconAnchorPos })          ← ここの2つが消える
//
// 2026-08-04 に `useTimelineEdit` を 959 → 176行にしたのがこの手。
// あちらは**心臓を1つも見に行かなくなった**（区画が自分で見に行くから）。
//
// ## なぜ道具にするか
//
// 目で探すと必ず数え落とす。しかも「1個だけ他でも使っている」名前を素通しと
// 誤って数えると、動かした先で足りなくなる。**使われている場所を全部数えて、
// 全部が deps の中なら素通し**、と機械で決める。
//
// ## 出る物
//
//   ① 素通しの名前（フックごと）… そのフックへ「自分で見に行かせる」と消える数
//   ② 素通しでない名前 … ここで実際に使っているので残る
//
// **①が大きいフックから順に直せば、1つ直すごとに配線が縮む。**
// 一度に全部やる必要はない（`引き継ぎ-心臓の分け直し.md`）。
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const TARGET = process.env.TARGET ?? 'src/renderer/src/state/useAppWiring.tsx'
const FN = process.env.FN ?? 'useAppWiring'

const cfgPath = join(ROOT, 'tsconfig.web.json')
const cfg = ts.parseJsonConfigFileContent(
  ts.readConfigFile(cfgPath, ts.sys.readFile).config,
  ts.sys,
  ROOT
)
const program = ts.createProgram([join(ROOT, TARGET)], cfg.options)
const checker = program.getTypeChecker()
const sf = program.getSourceFile(join(ROOT, TARGET))
if (!sf) throw new Error(`読めない: ${TARGET}`)

let fn = null
sf.forEachChild((n) => {
  if (ts.isFunctionDeclaration(n) && n.name?.text === FN) fn = n
})
if (!fn?.body) throw new Error(`${FN} の本体が見つからない`)

/** 心臓（context）から取り出した名前 → その宣言の位置 */
const fromCtx = new Map() // pos -> { name, ctx }
/** フックの呼び出し → その deps の中に現れる識別子 */
const hookCalls = [] // { hook, line, argIdents: Set<pos> }

const isCtxCall = (init) =>
  ts.isCallExpression(init) &&
  ts.isIdentifier(init.expression) &&
  /^use([A-Z].*Ctx|Doc|Sel|Layout|LaneHeights)$/.test(init.expression.text)

// **心臓から取り出した物と、フックが返した物の両方**を数える。
// 前者は「渡すのをやめて向こうに見に行かせる」、後者は「向こうに心臓へ書かせる」。
for (const st of fn.body.statements) {
  if (!ts.isVariableStatement(st)) continue
  for (const d of st.declarationList.declarations) {
    if (!d.initializer || !ts.isObjectBindingPattern(d.name)) continue
    const isCall =
      ts.isCallExpression(d.initializer) && ts.isIdentifier(d.initializer.expression)
    if (!isCall || !/^use[A-Z]/.test(d.initializer.expression.text)) continue
    const ctx = d.initializer.expression.getText()
    const kind = isCtxCall(d.initializer) ? '心臓' : 'フック'
    for (const el of d.name.elements) {
      if (!ts.isIdentifier(el.name)) continue
      fromCtx.set(el.name.getStart(), { name: el.name.text, ctx, kind })
    }
  }
}

/** その識別子が、どのフック呼び出しの deps の中に居るか（居なければ null） */
function hookArgOwner(node) {
  let cur = node.parent
  let inArg = false
  while (cur && cur !== fn) {
    if (
      ts.isCallExpression(cur) &&
      ts.isIdentifier(cur.expression) &&
      /^use[A-Z]/.test(cur.expression.text)
    ) {
      return inArg ? cur.expression.text : null
    }
    // 引数の中に入ったか（呼び出しの引数リストの下にいる）
    if (cur.parent && ts.isCallExpression(cur.parent) && cur.parent.arguments.includes(cur)) {
      inArg = true
    }
    cur = cur.parent
  }
  return null
}

/** 名前ごとの使われ方 */
const uses = new Map() // declPos -> { name, ctx, inDeps: Map<hook,count>, other: number }
for (const [pos, info] of fromCtx) uses.set(pos, { ...info, inDeps: new Map(), other: 0, inBundle: 0 })

/** 束（配る先の心臓へ詰め直す object literal）の中に居るか */
const BUNDLES = new Set([
  'timelineOps', 'timelineView', 'previewCtx', 'leftPanel',
  'rightPanel', 'header', 'menus', 'dialogs'
])
function bundleOwner(node) {
  let cur = node.parent
  while (cur && cur !== fn) {
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name) && BUNDLES.has(cur.name.text))
      return cur.name.text
    cur = cur.parent
  }
  return null
}

const declPosOf = (node) => {
  let sym = checker.getSymbolAtLocation(node)
  if (!sym) return null
  if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym)
  const d = sym.declarations?.[0]
  if (!d) return null
  const nameNode = ts.isBindingElement(d) || ts.isVariableDeclaration(d) ? d.name : d
  return ts.isIdentifier(nameNode) ? nameNode.getStart() : null
}

const walk = (n) => {
  if (ts.isIdentifier(n)) {
    // 省略記法（`{ foo }`）は**値の方**を解く。解かないと嘘が出る
    let pos = null
    if (ts.isShorthandPropertyAssignment(n.parent)) {
      const s = checker.getShorthandAssignmentValueSymbol(n.parent)
      const d = s?.declarations?.[0]
      const nameNode = d && (ts.isBindingElement(d) || ts.isVariableDeclaration(d)) ? d.name : d
      pos = nameNode && ts.isIdentifier(nameNode) ? nameNode.getStart() : null
    } else {
      pos = declPosOf(n)
    }
    if (pos != null && uses.has(pos) && pos !== n.getStart()) {
      const u = uses.get(pos)
      const hook = hookArgOwner(n)
      if (hook) u.inDeps.set(hook, (u.inDeps.get(hook) ?? 0) + 1)
      else if (bundleOwner(n)) u.inBundle++
      else u.other++
    }
  }
  n.forEachChild(walk)
}
walk(fn.body)

// ---- まとめる
const passthrough = new Map() // hook -> 名前[]
const kept = []
/** 心臓から出して束へ詰め直し、また心臓へ入れているだけの物（**往復**） */
const roundTrip = []
for (const u of uses.values()) {
  const hooks = [...u.inDeps.keys()]
  if (u.other === 0 && hooks.length > 0) {
    // **1つのフックへしか行っていない物だけ**を素通しとする。
    // 2つ以上へ配っている物は、両方に見に行かせても消えるが、
    // 「どちらが持ち主か」を人が決める必要があるので分けて出す。
    const key = hooks.length === 1 ? hooks[0] : `（${hooks.length}つへ配る）`
    if (!passthrough.has(key)) passthrough.set(key, [])
    passthrough.get(key).push(u.name)
  } else if (u.other === 0 && u.inBundle > 0) {
    // **どのフックが作った物か**まで出す（直す相手がそのまま出る）
    roundTrip.push({ name: u.name, owner: u.ctx })
  } else if (u.other > 0) {
    kept.push(u.name)
  }
}

const rows = [...passthrough.entries()].sort((a, b) => b[1].length - a[1].length)
const total = rows.reduce((s, [, v]) => s + v.length, 0)

console.log(`\n配線が抱えている名前: \x1b[1m${uses.size} 個\x1b[0m`)
console.log(`  素通し ${total} ／ 往復 ${roundTrip.length} ／ ここで使う ${kept.length}\n`)

console.log(`\x1b[1m① 素通し\x1b[0m（取り出して、そのフックへ渡すだけ）: ${total} 個`)
console.log('   → **そのフックに自分で見に行かせる**と、配線から消える\n')
for (const [hook, names] of rows) {
  if (names.length < 2) continue
  console.log(`  ${String(names.length).padStart(3)} 個  ${hook}`)
  console.log(`         ${names.join(' ')}`)
}
const ones = rows.filter(([, v]) => v.length === 1)
if (ones.length) console.log(`\n  1個だけのフック: ${ones.length} 本`)

// ---- ② 往復。**束にしか使われていない＝配り役が要らない**
const byOwner = new Map()
for (const r of roundTrip) {
  const k = r.owner ?? '（不明）'
  if (!byOwner.has(k)) byOwner.set(k, [])
  byOwner.get(k).push(r.name ?? r)
}
console.log(`\n\x1b[1m② 往復\x1b[0m（作った物を束へ詰め直し、また心臓へ入れているだけ）: ${roundTrip.length} 個`)
console.log('   → **作った側に心臓へ直接書かせる**と、配線からも束からも消える\n')
for (const [owner, names] of [...byOwner.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(names.length).padStart(3)} 個  ${owner}`)
  console.log(`         ${names.join(' ')}`)
}

console.log(`\n\x1b[1m③ ここで実際に使っている\x1b[0m（残る）: ${kept.length} 個`)
console.log(`  ${kept.join(' ')}\n`)
console.log('**①→②の順に、数の大きいフックから片付ける。** 1本ごとに配線が縮む。')
console.log('一度に全部やらないこと（`引き継ぎ-心臓の分け直し.md`）。')
