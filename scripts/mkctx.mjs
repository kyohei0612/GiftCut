// **引数ゼロのフックを「囲い」にする。**（`node scripts/mkctx.mjs <フック名> <話題>`）
//
// ## なぜ道具にするか
//
// 囲いの形は全部同じ（`createContext` → `Provider` → `useXCtx`）。手で書くと
// **型を手書きして実体とズレる**か、`Provider` の中で作らずに外で作って
// 「描き直すたびに値が消える」を踏む。どちらも既にこのリポジトリで起きている。
//
// 出す形は `state/toastContext.tsx` と同じで、違うのは1つだけ:
// **中で1回だけフックを呼ぶ**（値を外から渡さない）。引数ゼロだからそれができる。
//
// ## 型は実体から引く
//
// `ReturnType<typeof useX>`。手で書くと、あちらが変わってもここは黙って通る
//（2026-08-03 に受け口341件が `any` で開いていたのと同じ形）。
import { writeFileSync, existsSync } from 'node:fs'

const [hook, topic] = process.argv.slice(2)
if (!hook || !topic) {
  console.error('使い方: node scripts/mkctx.mjs useBandDrag "帯を運んでいる最中の持ち物"')
  process.exit(1)
}
const base = hook.replace(/^use/, '')
const file = `src/renderer/src/state/${base[0].toLowerCase()}${base.slice(1)}Context.tsx`
if (existsSync(file)) {
  console.error(`既にある: ${file}`)
  process.exit(1)
}

const body = `// ${topic}を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// \`${hook}\` は**引数を1つも取らない葉**なのに、\`useAppWiring\` が呼んで
// 各フックへ配り、束へ詰め直して心臓へ戻していた。**配るだけの名前は配線から消せる**
//（数え方と順番は \`npm run passthrough\`）。
//
// **中身はここで作る。** 上で作って渡す形にすると、囲いを描き直すたびに
// 作り直されて、持っていた値が消える。
//
// ## 中身
//
// - \`${base}Value\` … \`${hook}\` が返す物（**手で書かず実体から引く**）
// - \`${base}Provider\` … 囲い。中で \`${hook}()\` を1回だけ呼ぶ
// - \`use${base}Ctx\` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { ${hook} } from './${hook}'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type ${base}Value = ReturnType<typeof ${hook}>

const Ctx = createContext<${base}Value | null>(null)

export function ${base}Provider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={${hook}()}>{children}</Ctx.Provider>
}

/** ${topic}を見に行く。囲いの外で呼んだら、その場で落とす */
export function use${base}Ctx(): ${base}Value {
  const v = useContext(Ctx)
  if (!v) throw new Error('use${base}Ctx は ${base}Provider の中でしか使えません')
  return v
}
`
writeFileSync(file, body, 'utf8')
console.log(`作った: ${file}`)
console.log(`  App.tsx へ <${base}Provider> を足し、useAppWiring の ${hook}() を use${base}Ctx() に替える`)
