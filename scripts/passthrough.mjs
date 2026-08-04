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
import { readFileSync, readdirSync } from 'node:fs'
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

// **心臓の一覧は名前で決めない。** `state/*Context.tsx` が実際に export している
// 「見に行く関数」を読む。名前の形（`…Ctx`）で判定していた頃は `useLaneHeights` を
// 心臓と数えていて、**上げられないフックを「上げられる」と出していた**（2026-08-04）。
const CTX_HOOKS = new Set()
for (const f of readdirSync(join(ROOT, 'src/renderer/src/state'))) {
  if (!f.endsWith('Context.tsx')) continue
  const src = readFileSync(join(ROOT, 'src/renderer/src/state', f), 'utf8')
  for (const m of src.matchAll(/^export function (use\w+)\s*\(/gm)) CTX_HOOKS.add(m[1])
}
if (CTX_HOOKS.size < 10) throw new Error(`心臓が ${CTX_HOOKS.size} 個しか見つからない（探し方が壊れている）`)

const isCtxCall = (init) =>
  ts.isCallExpression(init) &&
  ts.isIdentifier(init.expression) &&
  CTX_HOOKS.has(init.expression.text)

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

// ---- ③ いま囲いへ上げられるフック
//
// **基準は「引数ゼロ」ではない。** 要る物が全部**心臓から取れる**なら上げられる。
// だから**葉を上げると、次の層が葉になる**（玉ねぎを剥く形で終わりまで進む）。
//
//   心臓から取れる物   … 心臓の分割代入・import・上げ済みのフック
//   まだ取れない物     … 配線の中の別のフックが作った物・配線が自分で書いた関数
const fromHook = new Map() // declPos -> そのフック名
const hookOf = new Map() // フック名 -> { names: 個数, deps: Set<フック名>, local: Set<名前> }
for (const st of fn.body.statements) {
  if (!ts.isVariableStatement(st)) continue
  for (const d of st.declarationList.declarations) {
    if (!d.initializer || !ts.isObjectBindingPattern(d.name)) continue
    if (!ts.isCallExpression(d.initializer) || !ts.isIdentifier(d.initializer.expression)) continue
    const h = d.initializer.expression.text
    if (!/^use[A-Z]/.test(h) || isCtxCall(d.initializer)) continue
    hookOf.set(h, { names: d.name.elements.length, deps: new Set(), local: new Set(), node: d })
    for (const el of d.name.elements) if (ts.isIdentifier(el.name)) fromHook.set(el.name.getStart(), h)
  }
}
for (const [h, info] of hookOf) {
  const walkArgs = (n) => {
    if (ts.isIdentifier(n)) {
      let pos = null
      if (ts.isShorthandPropertyAssignment(n.parent)) {
        const sym = checker.getShorthandAssignmentValueSymbol(n.parent)
        const dd = sym?.declarations?.[0]
        const nn = dd && (ts.isBindingElement(dd) || ts.isVariableDeclaration(dd)) ? dd.name : dd
        pos = nn && ts.isIdentifier(nn) ? nn.getStart() : null
      } else pos = declPosOf(n)
      if (pos != null) {
        if (fromHook.has(pos) && fromHook.get(pos) !== h) info.deps.add(fromHook.get(pos))
        else if (!uses.has(pos)) {
          // 心臓でもフックでもない＝配線が自分で書いた物か import。
          // **配線の中で宣言された物だけ**を「まだ取れない」に数える
          const inWiring = pos > fn.body.getStart() && pos < fn.body.getEnd()
          if (inWiring) info.local.add(n.text)
        }
      }
    }
    n.forEachChild(walkArgs)
  }
  for (const a of info.node.initializer.arguments) walkArgs(a)
}
const ready = [...hookOf.entries()].filter(([, i]) => !i.deps.size && !i.local.size)
const blocked = [...hookOf.entries()].filter(([, i]) => i.deps.size || i.local.size)

// **どれだけ先を解くか**を数える（直接だけでなく、その先まで辿る）。
// 数の多い名前から片付けるより、**詰まりを解く順**の方が早く終わる。
const unlockCount = (start) => {
  const seen = new Set()
  const stack = [start]
  while (stack.length) {
    const cur = stack.pop()
    for (const [h, i] of hookOf) {
      if (seen.has(h) || !i.deps.has(cur)) continue
      seen.add(h)
      stack.push(h)
    }
  }
  return seen.size
}

console.log(`\n\x1b[1m③ いま囲いへ上げられるフック\x1b[0m（要る物が全部 心臓から取れる）: ${ready.length} 本`)
console.log('   **順番は「名前の多さ」ではなく「どれだけ先を解くか」。** 上から片付ける\n')
const withUnlock = ready.map(([h, i]) => [h, i, unlockCount(h)])
withUnlock.sort((a, b) => b[2] - a[2] || b[1].names - a[1].names)
for (const [h, i, u] of withUnlock)
  console.log(`  ${String(i.names).padStart(3)} 個 ／ 先を ${String(u).padStart(2)} 本 解く   ${h}`)

console.log(`\n   待ち: ${blocked.length} 本。**何が来るのを待っているか**（多い順）:`)
const blocker = new Map()
for (const [, i] of blocked) for (const d of i.deps) blocker.set(d, (blocker.get(d) ?? 0) + 1)
for (const [h, n] of [...blocker.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6))
  console.log(`     ${String(n).padStart(2)} 本が待っている: ${h}${hookOf.get(h)?.deps.size ? '（これも待ち）' : ''}`)

console.log(`\n\x1b[1m④ ここで実際に使っている\x1b[0m（残る）: ${kept.length} 個`)
console.log(`  ${kept.join(' ')}\n`)
console.log('**①→②の順に、数の大きいフックから片付ける。** 1本ごとに配線が縮む。')
console.log('一度に全部やらないこと（`引き継ぎ-心臓の分け直し.md`）。')
