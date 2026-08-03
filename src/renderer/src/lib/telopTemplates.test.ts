// @vitest-environment jsdom
//
// テロップ置き場の保存は、**その1件の操作だけを書く**こと。
//
// ## 直した症状（2026-08-04。⑦の残り）
//
// プロジェクトを開くと、そのプロジェクトが持っている ★・分類・自作フォルダ・
// 自作テロップを**混ぜて画面に出す**（保存はしない。`useProjectTemplates` を見ること）。
//
// **穴が残っていた**——開いている間に自分で★を1つ押すと、
// `saveFavorites(画面に出ている一覧)` を呼んでいたので、
// **触っていないプロジェクト由来の物まで全部一緒に焼き付いた。**
//
// 直し方は「アプリ側とプロジェクト由来を別々に持つ」ではなく、**保存する物を変える**。
// 押した1件だけを、保存済みの一覧へ当てる。画面の一覧を渡さないので**混ざりようがない**。
//
// ## ここで見張る2つ
//
//   ① `persist*` が「保存済み ＋ その1件」になっている（画面の一覧を見ていない）
//   ② **`lib/telopTemplates.ts` の外から、丸ごと保存する関数を呼んでいない**
//      ——②が本命。①だけ通っていても、どこか1か所が丸ごと書けば元に戻る。
//      実際、直したとき `useLabelsPresets` に**同じことをする2つ目の道**が残っていた
//      （`saveCurrentAsTemplate` と `savePreset`。grep で数えて初めて見つかった）
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadCatOverrides,
  loadCustomCats,
  loadFavorites,
  loadUserTemplates,
  persistCat,
  persistCustomCat,
  persistDropCat,
  persistFav,
  persistUserTemplateAdd,
  persistUserTemplateRemove,
  saveCatOverrides,
  saveCustomCats,
  saveFavorites,
  saveUserTemplates
} from './telopTemplates'

const style = (): never => ({}) as never

describe('保存するのは「その1件の操作」だけ', () => {
  beforeEach(() => localStorage.clear())

  it('★ … 押した1件だけが増える（画面に出ていた物は増えない）', () => {
    saveFavorites(['自分で付けた'])
    // 画面には「自分で付けた」＋プロジェクト由来2件が出ている、という場面
    persistFav('プロジェクト由来A', true)
    expect(loadFavorites()).toEqual(['自分で付けた', 'プロジェクト由来A'])
    // **触っていない「プロジェクト由来B」は入らない**——ここが直した所
    expect(loadFavorites()).not.toContain('プロジェクト由来B')
  })

  it('★ … 外すと消える。保存済みに無い物を外しても増えない', () => {
    saveFavorites(['A', 'B'])
    persistFav('A', false)
    expect(loadFavorites()).toEqual(['B'])
    // 画面では★が付いていた（プロジェクト由来）が、保存済みには無い物を外す道
    persistFav('プロジェクト由来', false)
    expect(loadFavorites()).toEqual(['B'])
  })

  it('★ … 同じ物を2回付けても重ならない', () => {
    persistFav('A', true)
    persistFav('A', true)
    expect(loadFavorites()).toEqual(['A'])
  })

  it('分類 … 1件だけ入る／null で外れる', () => {
    saveCatOverrides({ 既存: 'そのまま' })
    persistCat('押した物', 'フォルダ1')
    expect(loadCatOverrides()).toEqual({ 既存: 'そのまま', 押した物: 'フォルダ1' })
    persistCat('押した物', null)
    expect(loadCatOverrides()).toEqual({ 既存: 'そのまま' })
  })

  it('自作フォルダ … 足す／消す。同じ key は増えない', () => {
    saveCustomCats([{ key: '既存', label: '既存' }])
    persistCustomCat('新しい', '新しい')
    persistCustomCat('新しい', '新しい')
    expect(loadCustomCats()).toEqual([
      { key: '既存', label: '既存' },
      { key: '新しい', label: '新しい' }
    ])
    persistCustomCat('既存', null)
    expect(loadCustomCats()).toEqual([{ key: '新しい', label: '新しい' }])
  })

  it('フォルダを消すと、そこを指していた上書きだけ外れる', () => {
    saveCatOverrides({ a: '消す方', b: '残る方', c: '消す方' })
    persistDropCat('消す方')
    expect(loadCatOverrides()).toEqual({ b: '残る方' })
  })

  it('自作テロップ … 足した1つだけ入る。**消すのは名前で**', () => {
    saveUserTemplates([{ name: '自分の', style: style() }])
    persistUserTemplateAdd({ name: '足した', style: style() })
    expect(loadUserTemplates().map((t) => t.name)).toEqual(['自分の', '足した'])
    // **番号ではなく名前。** 画面の一覧はプロジェクト由来が混ざって並びが違う
    persistUserTemplateRemove('自分の')
    expect(loadUserTemplates().map((t) => t.name)).toEqual(['足した'])
  })

  it('自作テロップ … 同じ名前で足すと置き換わる（二重に並ばない）', () => {
    persistUserTemplateAdd({ name: '同名', style: style() })
    persistUserTemplateAdd({ name: '同名', style: style() })
    expect(loadUserTemplates()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// ② こちらが本命。**丸ごと保存する道が1つでも残っていたら意味が無い。**
// ---------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url))
const RENDERER = join(HERE, '..')
const OWNER = 'lib/telopTemplates.ts'

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p)
  }
  return out
}

describe('画面に出ている一覧を、丸ごと保存しない', () => {
  it(`**丸ごと保存する関数を呼ぶのは ${OWNER} だけ**`, () => {
    const bad: string[] = []
    for (const p of walk(RENDERER)) {
      const rel = relative(RENDERER, p).split(sep).join('/')
      if (rel === OWNER) continue
      readFileSync(p, 'utf8')
        .split(/\r?\n/)
        .forEach((l, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(l)) return // 説明文の中の save… は見ない
          const m = /\bsave(Favorites|CatOverrides|CustomCats|UserTemplates)\s*\(/.exec(l)
          if (m) bad.push(`${rel}:${i + 1}  ${l.trim()}`)
        })
    }
    expect(
      bad,
      '\n' +
        bad.join('\n') +
        '\n\n**画面の一覧にはプロジェクト由来が混ざっている。** 丸ごと書くと、\n' +
        `触っていない物まで焼き付く。${OWNER} の persist* を使うこと（上の説明を読むこと）`
    ).toEqual([])
  })
})
