// 同じ物を2か所に書いていないかを、機械で見張る。
//
// ## なぜ機械で見るのか
//
// **これがこのプロジェクトで一番たちの悪い壊れ方をする。**
// 同じ問いに2つの答えがあると、片方だけ直したときに気づけない。しかも
// 画面と書き出しでズレた場合、**画面では正しく見える**ので発覚が遅れる。
//
// 実際に 2026-08-02 に見つかった例（これを見つけたのがこの検査を作った理由）:
//
//   isNeutralZoom が3か所にあり、**そのうち1つだけ「ぴったり比較」**だった。
//   つまみで戻して 1.0000001 になると、画面は「等倍」として何も出さないのに、
//   書き出しは「等倍ではない」と見て zoompan を1段掛けていた。
//
// 過去にも「同じ物が2回以上書かれていた」を6件まとめて直した記録がある
//（クロップの押し戻し規則／トランジションの編集画面／テロップの出入りの帯／
//  帯の色の塗り方／ミキサーのつまみ／comboFromEvent）。**放っておくと必ず増える。**
//
// ## 見るのは3つ（欲張ると使われなくなる）
//
//   ① shared/ に出してある名前を、他所で作り直していないか
//   ② 同じ中身の塊が、別のファイルにそっくり入っていないか
//   ③ **正典のある式を、他所で生のまま書いていないか**（下の CANON）
//
// 「同じ物」の完全な判定は無理なので、**実際に事故になった型だけ**を見る。
// これで捕まらない二重実装はある。それは人が気づくしかない。
//
// ## ③ を足した理由（2026-08-03）
//
// ①②は**名前で見ている**。だから 08-03 に見つかった8件のうち**5件がすり抜けた**——
// 名前が違い、式が関数の中に埋まっていたから。
//
// そして**「よく読めば気づく」では直らない。2個目は別のファイルにあるから。**
// どれだけ丁寧に1ファイルを読んでも隣は見えない。実際に散っていた数:
//
//   重ねた動画の長さ    15か所
//   時間の計算          shared/timeline を main/exportRun が手書き（3か所）
//   ズーム変換の文字列  3か所（うち1つだけ 08-03 に直して、2つ残した）
//
// 一番たちが悪かったのはこれ:
//
//   shared/timeline.ts:95   Math.max(0, srcEnd - srcStart) / 速度
//   main/exportRun.ts:438        (srcEnd - srcStart) / 速度   ← Math.max(0,) が無い
//
// **片方だけ直した跡がそのまま残っていた。** 画面は0で止まるのに書き出しは負になる。
//
// **③ は式で見るので、読んでいなくても止まる。忘れても止まる。**
//
// ## 赤くなったら
//
// **消す前に、2つが本当に同じか確かめること。** わざと違えている場合もある
//（その場合は下の ALLOW に理由付きで足す）。同じなら、片方を消して
// もう片方から import する。**新しく作る方を shared/ に置く**のが原則。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SKIP = new Set(['node_modules', 'out', 'dist', '.git', 'shots'])

/**
 * 見逃してよい物。**必ず理由を書く。**
 *
 * 「たまたま同じ名前」と「本当に同じ物」は違う。前者だけをここへ入れる。
 */
const ALLOW = new Set([
  // 型の受け渡しは preload と main で必ず同じ形になる（片方だけ直せば型検査が捕まえる）
  'src/preload/index.ts',
  'src/preload/index.d.ts',
  // 心臓（useAppWiring）が **詰める** 並びと、区画が **取り出す** 並びは必ず同じ形になる。
  // 省略記法で書くので字面まで一致するが、これは二重実装ではなく「包む／解く」の対で、
  // 片方を消して import する、という直し方が存在しない。
  // ズレたら RightPanelValue の型検査が必ず捕まえる（実際 draggingEmphasisRef を
  // 足したとき TS2339 / TS2739 で止まった）ので、見張りは型側に任せる。
  'src/renderer/src/components/panels/RightPanelArea.tsx'
])

/**
 * 正典のある式。**ここに書いた形を、正典以外の場所で書いたら赤。**
 *
 * ## なぜ「名前」ではなく「式」で見るか
 *
 * 足すときに起きるのはこれ:
 *
 *   1. 「動画の長さが要る」
 *   2. **vcLen があることを知らない**
 *   3. `Math.max(0.05, c.srcEnd - c.srcStart)` と書く
 *   4. 動く。試験も緑。誰も気づかない
 *
 * **同じ関数は使われない。使われていたら重複にならない。**
 *
 * 知らない理由は「**props で配られていて import では取れない**」。
 * 決定的な証拠: `LeftPanel.tsx:166` は `vcLen` を props で受け取っておきながら、
 * **同じ名前のローカル定数に生の式を書いて影を作っている**（手に持っているのに書き直した）。
 * `TimelineArea` も `pairedAudioOf` を受け取って子へ渡しながら自分では手書きしている。
 *
 * → **検査（これ）と、正典を `shared/` へ移すことの両方が要る。**
 *    検査だけだと、赤くなったとき「何を import すればいいか」が分からない。
 */
const CANON: {
  what: string
  home: string
  use: string
  re: RegExp
  /** まだ生のまま書いてある場所（ファイル → 件数）。**減らす方向にだけ動かす** */
  debt: Record<string, number>
}[] = [
  {
    what: '重ねた動画クリップの長さ',
    home: 'src/shared/timeline.ts',
    use: 'vcLen(c) を shared/timeline から import する',
    re: /Math\.max\(\s*0\.05\s*,\s*[\w.]+\.srcEnd\s*-\s*[\w.]+\.srcStart\s*\)/,
    debt: {
      // **書き出し側は返済済み**（2026-08-03）。この検査が「正典は shared/timeline だが
      // 実体は useTrackGeom にあって props で配られている」と自分で書いていたので、
      // **正典を本当に shared/timeline へ置いてから** import した（exportRun の2件）。
      // 画面側の11か所は props で受け取れる場所なので、順次ここへ寄せる。
      'src/renderer/src/components/LeftPanel.tsx': 1, // props で受けているのに影を作っている
      'src/renderer/src/state/useClipDrag.ts': 1,
      'src/renderer/src/state/useExport.ts': 1,
      'src/renderer/src/state/useKeyboard.ts': 1,
      'src/renderer/src/state/useMediaDrop.ts': 1,
      'src/renderer/src/state/useSnap.ts': 1,
      'src/renderer/src/state/useTimelineDrag.ts': 2,
      'src/renderer/src/state/useTimelineEdit.ts': 1,
      'src/renderer/src/state/useTimelineSpan.ts': 1,
      'src/renderer/src/state/useTrackGeom.ts': 1, // ← いまの正典。shared へ移したら 0
      'src/renderer/src/state/useVClipEls.ts': 1,
      'src/renderer/src/state/useVideoSync.ts': 1
    }
  },
  {
    what: '切片の再生速度（0以下なら等速）',
    home: 'src/shared/timeline.ts',
    use: 'segSpeed(s) を import する',
    re: /speed\s*&&\s*[\w.]*\.?speed\s*>\s*0\s*\?/,
    // **返済済み**（2026-08-03。exportRun の写しを消して正典を import した）
    debt: {}
  },
  {
    what: '切片のタイムライン長（元の長さ ÷ 速度）',
    home: 'src/shared/timeline.ts',
    use: 'segTLen(s) を import する',
    // **08-03 に見つかった実害**: 正典は Math.max(0, ...) で下を止めているが、
    // exportRun の写しには**それが無い**。画面は0で止まるのに書き出しは負になる。
    re: /\(\s*[\w.]+\.srcEnd\s*-\s*[\w.]+\.srcStart\s*\)\s*\//,
    // exportRun の2件は**返済済み**（2026-08-03）。正典の Math.max(0, …) が
    // 抜けていたのがそこで、画面は0で止まるのに書き出しだけ負の長さになっていた。
    debt: { 'src/renderer/src/state/useSegmentDrag.ts': 1 }
  },
  {
    what: 'ズーム（寄せ）の CSS transform 文字列',
    home: 'src/renderer/src/lib/clipXform.ts',
    use: 'clipXform(c, localT) を import する',
    // 08-03 に clipXform の**並べる順**を直した（反転で左右が真逆になっていた）。
    // 残る2か所は直していない。**同じ間違いが2つ残っている。**
    re: /translate\(\$\{[^}]*\*\s*100\)\.toFixed\(3\)\}%/,
    debt: {
      'src/renderer/src/state/usePlaybackEngine.ts': 1,
      'src/renderer/src/state/usePreviewFrame.ts': 1
    }
  }
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

const rel = (p: string): string => relative(REPO, p).split(sep).join('/')
const files = walk(join(REPO, 'src')).map((f) => ({ path: rel(f), src: readFileSync(f, 'utf8') }))

/** その行で新しく生まれる名前（トップレベルだけ） */
function declaredName(line: string): string | null {
  const m =
    line.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/) ??
    line.match(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*[:=]/)
  return m ? m[1] : null
}

describe('同じ物を2か所に書かない', () => {
  it('見張る対象が見つかっている（歩き方が壊れていないか）', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('**shared/ に出してある物を、他所で作り直していない**', () => {
    const shared = new Set<string>()
    for (const f of files.filter((f) => f.path.startsWith('src/shared/'))) {
      for (const l of f.src.split(/\r?\n/)) {
        if (!l.startsWith('export ')) continue
        const n = declaredName(l)
        if (n) shared.add(n)
      }
    }
    const bad: string[] = []
    for (const f of files) {
      if (f.path.startsWith('src/shared/') || ALLOW.has(f.path)) continue
      f.src.split(/\r?\n/).forEach((l, i) => {
        const n = declaredName(l)
        if (n && shared.has(n)) bad.push(`${f.path}:${i + 1}  ${n} は shared/ にもある`)
      })
    }
    expect(bad, '\n' + bad.join('\n') + '\n\n上の説明「赤くなったら」を読むこと').toEqual([])
  })

  it('**同じ中身の塊（12行）が、別のファイルにそっくり入っていない**', () => {
    const WIN = 12
    const seen = new Map<string, string[]>()
    for (const f of files) {
      if (ALLOW.has(f.path)) continue
      const ls = f.src
        .split(/\r?\n/)
        .map((l) => l.trim())
        .map((l) => (l.startsWith('//') || l.startsWith('*') || l.startsWith('/*') ? '' : l))
      for (let i = 0; i + WIN <= ls.length; i++) {
        const w = ls.slice(i, i + WIN)
        // 空行・短い行だらけの窓は「同じ」に見えて当たり前なので数えない
        if (w.filter((x) => x.length > 3).length < WIN) continue
        const key = w.join('')
        if (!seen.has(key)) seen.set(key, [])
        seen.get(key)!.push(`${f.path}:${i + 1}`)
      }
    }
    // 同じ塊が続くと窓の数だけ報告されるので、ファイルの組で1件にまとめる
    const pairs = new Map<string, string>()
    for (const at of seen.values()) {
      const inFiles = [...new Set(at.map((x) => x.split(':')[0]))]
      if (inFiles.length < 2) continue
      pairs.set(inFiles.sort().join(' ↔ '), at.slice(0, 2).join('  '))
    }
    const bad = [...pairs.entries()].map(([k, v]) => `${k}\n      例: ${v}`)
    expect(bad, '\n' + bad.join('\n') + '\n\n上の説明「赤くなったら」を読むこと').toEqual([])
  })

  // ここから ③。**式で見るので、読んでいなくても・忘れても止まる。**
  for (const c of CANON) {
    it(`**「${c.what}」を生の式で書いていない**（正典: ${c.home}）`, () => {
      const bad: string[] = []
      for (const f of files) {
        if (f.path === c.home || ALLOW.has(f.path)) continue
        const hits: number[] = []
        f.src.split(/\r?\n/).forEach((l, i) => {
          if (c.re.test(l)) hits.push(i + 1)
        })
        if (!hits.length) continue
        const owed = c.debt[f.path] ?? 0
        if (hits.length > owed)
          bad.push(
            `${f.path}  ${hits.length}か所（借金は${owed}）  行: ${hits.join(', ')}`
          )
      }
      expect(
        bad,
        '\n' +
          bad.join('\n') +
          `\n\n**${c.use}**\n` +
          '（借金を増やさない。減らすときは debt の数も一緒に減らすこと）'
      ).toEqual([])
    })
  }

  it('**借金は減る方向にだけ動かす**（合計を増やしたら赤）', () => {
    const total = CANON.reduce(
      (n, c) => n + Object.values(c.debt).reduce((a, b) => a + b, 0),
      0
    )
    // 2026-08-03 に 21 で始めて、その日のうちに exportRun の3件を返して 18。
    // さらに書き出しを3つに割ったとき、vcLen を shared/timeline へ置いて2件返して 16。
    // **ここを増やしてはいけない。減らしたら数字も一緒に下げること。**
    expect(total).toBeLessThanOrEqual(16)
  })
})
