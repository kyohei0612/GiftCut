// **配線（useAppWiring）が、また太らないようにする。**
//
// ## なぜ検査が要るか
//
// 同じ事故を**2回**やっている:
//
//   App.tsx        11,404 → 198行（2026-07-31〜08-02）
//   useAppWiring    1,229 →  362行（2026-08-04）
//
// どちらも「フックを1本呼んで、名前を配る」が積み上がった結果で、
// **1回ずつでは誰も気づけない大きさ**でしか増えない。剥がすのに丸1日かかった。
//
// 2026-08-04 に決まりを言葉にした:
//
//   フックを1本足すとき、配線には書かない。**囲い（*Context.tsx）を作る。**
//
// **ただし、書いただけの決まりは守られない**（`.company/engineering/CLAUDE.md`）。
// 3回目を止めるのはこのファイル。
//
// ## 何を数えるか
//
// 行数ではなく「**配線が自分で呼んでいる話題のフック**」を数える。行数は
// コメントで揺れるが、こちらは意味がそのまま出る。数えないのは3種類:
//
//   心臓        `state/*Context.tsx` が export している物。**見に行くのは正しい**
//   束の組み立て `use*Value`。8本で固定（増やす物ではない）
//   React       useEffect / useRef / useState / useMemo
//
// 残るのが「配線がここで走らせているフック」。**増えたら赤**。
//
// ## 赤くなったら
//
// 上限を上げない。**囲いを作って、使う側に見に行かせる。**
// 順番は `npm run passthrough` が出す。
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const STATE = dirname(fileURLToPath(import.meta.url))
const WIRING = join(STATE, 'useAppWiring.tsx')

/**
 * 心臓の一覧は**名前の形で決めない**。`state/*Context.tsx` が実際に export して
 * いる「見に行く関数」を読む。名前（`…Ctx`）で判定していた頃、`npm run passthrough` は
 * `useLaneHeights` を心臓と数えて**上げられないフックを「上げられる」と出していた**。
 */
function ctxHooks(): Set<string> {
  const out = new Set<string>()
  for (const f of readdirSync(STATE)) {
    if (!f.endsWith('Context.tsx')) continue
    const src = readFileSync(join(STATE, f), 'utf8')
    for (const m of src.matchAll(/^export function (use\w+)\s*\(/gm)) out.add(m[1])
  }
  return out
}

const REACT = new Set(['useEffect', 'useRef', 'useState', 'useMemo', 'useCallback'])

/** 配線が自分で走らせているフック（心臓でも束でも React でもない物） */
function ownHooks(): string[] {
  const src = readFileSync(WIRING, 'utf8')
  const body = src.slice(src.indexOf('export function useAppWiring()'))
  const ctx = ctxHooks()
  const out = new Set<string>()
  for (const m of body.matchAll(/(?:^|[^.\w])(use[A-Z]\w*)\s*\(/gm)) {
    const n = m[1]
    if (n === 'useAppWiring' || REACT.has(n) || ctx.has(n)) continue
    if (/Value$/.test(n)) continue // 束の組み立て（use*Value）
    out.add(n)
  }
  return [...out].sort()
}

/**
 * いまの本数。**上げないこと。**
 *
 * 内訳（2026-08-04）: 走らせるだけで戻り値を持たない効果ばかり。
 * useDiagnostics / useSelectionCleanup / useNestSelectSync / useVideoSync /
 * useTimelineWheel / useDismissOnOutside / useWindowDrop / useSessionMemory /
 * useHistoryCoalesce / useAutosaveDraft / useMainEvents / useKeyboard
 *
 * このうち3本（useSessionMemory → useHistoryCoalesce → useAutosaveDraft）は
 * **走る順に意味がある**ので、ここに残すのが正しい。残りは順が要らないので、
 * 減らす余地がある（減らす方向にだけ動かす）。
 */
const MAX_OWN_HOOKS = 12

/**
 * 行数の上限。全体の上限（1,250行・`shared/fileSize.test.ts`）とは別に、
 * 配線にだけ低い天井を置く。**いまは 363行**なので、増えても気づける幅にしてある。
 */
const MAX_LINES = 450

describe('配線が、また太らないようにする', () => {
  it('見張る対象が見つかっている（歩き方が壊れていないか）', () => {
    expect(ctxHooks().size, '心臓が見つからない（探し方が壊れている）').toBeGreaterThan(10)
    expect(ownHooks().length, '数え方が壊れている（0本になっている）').toBeGreaterThan(0)
  })

  it(`**配線が自分で呼ぶフックを増やさない**（いま ${MAX_OWN_HOOKS} 本）`, () => {
    const own = ownHooks()
    expect(
      own.length,
      '配線が呼ぶフックが増えている:\n  ' +
        own.join('\n  ') +
        '\n\n**上限を上げないこと。** フックを足すなら囲い（state/*Context.tsx）を作り、\n' +
        '使う側に自分で見に行かせる。順番は `npm run passthrough` が出す。\n' +
        'ここを緩めると App.tsx（11,404行）と同じ道をもう一度たどる。'
    ).toBeLessThanOrEqual(MAX_OWN_HOOKS)
  })

  it(`**${MAX_LINES}行を超えない**`, () => {
    const n = readFileSync(WIRING, 'utf8').split(/\r?\n/).length
    expect(n, `useAppWiring.tsx が ${n} 行。太った理由を先に潰すこと`).toBeLessThanOrEqual(
      MAX_LINES
    )
  })
})
