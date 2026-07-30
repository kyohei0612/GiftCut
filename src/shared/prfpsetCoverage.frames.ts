// 実物のプリセット集で「いま何個そのまま再現できるか」を数え直す（npm run frames）
//
// ## なぜ手で書かないか
//
// 一度これを手で書いて、**次の日には古くなっていた**（20個時代の表が残ったまま
// 中身は40個になっていた）。数える相手はこちらのコードなので、コードから数える。
//
// ## 素材は置かない
//
// .prfpset は再配布が許可されていないので、リポジトリにも配布物にも入れない。
// **場所は環境変数で渡す**。無ければ何もせず飛ばす（他の PC で `npm run frames`
// が落ちないように。落とすと「動きの確認」ごと回されなくなる）。
//
//     GIFTCUT_PRFPSET="C:/…/[ONE_telop01].prfpset" npm run frames
//
// 出来上がるのは e2e/frames/coverage.md。○＝取りこぼし無し、△＝一部だけ。

import { describe, it } from 'vitest'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parsePrfpset, type PrEffect } from './prfpset'
import { toMotion, isFullyCopyable } from './prfpsetImport'

const ROOT = resolve(__dirname, '..', '..')
const OUT = join(ROOT, 'e2e', 'frames', 'coverage.md')
const SRC = process.env.GIFTCUT_PRFPSET

/** エフェクト1つだけを見て、こちらで持てる種類か */
const handled = (e: PrEffect): boolean => isFullyCopyable({ name: '', effects: [e] })

describe('取り込みの再現範囲', () => {
  it.skipIf(!SRC || !existsSync(SRC))('実物を数えて coverage.md を書き直す', () => {
    const presets = parsePrfpset(readFileSync(SRC!, 'utf8'))
    const rows: string[] = []
    let full = 0
    // 足りない物を種類ごとに数える（次にどれを作れば一番効くかが、そのまま出る）
    const missCount = new Map<string, number>()
    for (const p of presets) {
      const { motion, skipped } = toMotion(p)
      const chans = Object.keys(motion)
      // ○ = 知らないエフェクトが無く、かつ拾えなかった項目も無い
      const ok = isFullyCopyable(p) && skipped.length === 0
      if (ok) full++
      const miss = [...new Set([...p.effects.filter((e) => !handled(e)).map((e) => e.matchName), ...skipped])]
      for (const m of miss) missCount.set(m, (missCount.get(m) ?? 0) + 1)
      rows.push(`| ${p.name} | ${ok ? '○' : '△'} | ${chans.join(' ') || '—'} | ${miss.join(' / ') || '—'} |`)
    }
    const ranked = [...missCount].sort((a, b) => b[1] - a[1])
    const md = [
      '# 取り込みの再現範囲',
      '',
      '<!-- npm run frames で自動生成（src/shared/prfpsetCoverage.frames.ts）。手で直さない -->',
      '',
      `- 全部で ${presets.length} 個`,
      `- そのまま再現できる: ${full} 個`,
      '',
      '## 次にどれを作れば効くか（足りない物の多い順）',
      '',
      '| 足りないもの | 件数 |',
      '|---|---|',
      ...ranked.map(([n, c]) => `| ${n} | ${c} |`),
      '',
      '## 1つずつ',
      '',
      '| 番号・名前 | 再現 | 取れた動き | 足りないもの |',
      '|---|---|---|---|',
      ...rows,
      ''
    ].join('\n')
    writeFileSync(OUT, md, 'utf8')
    // eslint-disable-next-line no-console
    console.log(`coverage.md を書き直した: ${full} / ${presets.length}`)
  })
})
