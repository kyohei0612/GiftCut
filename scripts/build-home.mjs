#!/usr/bin/env node
// ============================================================================
// 身内用の「exe 1つ」を作る（npm run dist:home）
//
//   npm run dist:home
//   → dist-home/GiftCut-家庭用-x.x.x.exe（1ファイル。解凍もインストールも不要）
//
// なぜ別にするか:
//   **効果音とテロップ素材は再配布が許可されていない。** 公開用の配布物には
//   絶対に入れてはならず、`check:packaged` がそれを見張っている。
//   身内の PC へ渡すぶんだけ、手元の判断で同梱する。
//
//   公開用の作り方（electron-builder.yml）には触らない。触ると、あとで
//   人に配るときに巻き添えで入る。ここで一時的な設定を作って使い、必ず消す。
//
// **出来上がりを dist/ ではなく dist-home/ に置く理由（大事）:**
//   同じ dist/ を使うと、この作り方で `dist/win-unpacked/resources/` に
//   SE と telop-presets が残る。次に公開用を作ったとき、その残りが混ざって
//   **再配布禁止の素材を配ってしまう**恐れがある。
//   `npm run check:packaged` は気づけるが、`npm run release` はそれを通らない。
//   置き場所を分けて、混ざりようがない形にしてある。
//
// できる物の性質:
//   - 起動すると一時フォルダへ自分を展開して動く（portable ターゲット）
//   - 素材は exe の中に入っているので、置き場所を気にしなくてよい
//   - **自動更新はできない**（更新の設定を入れていない）。新しい版は作り直して渡す
// ============================================================================
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = join(ROOT, 'electron-builder.yml')
const TMP = join(ROOT, 'electron-builder.home.tmp.yml')

const ver = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version

// 同梱する素材。無ければ「入れられません」と正直に言って続ける
const EXTRAS = [
  { from: 'SE', label: '効果音' },
  { from: 'telop-presets', label: 'テロップ素材' }
]
const found = EXTRAS.filter((e) => existsSync(join(ROOT, e.from)))
for (const e of EXTRAS) {
  console.log(
    existsSync(join(ROOT, e.from))
      ? `  同梱する: ${e.label}（${e.from}）`
      : `  ありません（入れずに進みます）: ${e.label}（${e.from}）`
  )
}

// 公開用の設定を読み、身内用の分だけ足す
let yml = readFileSync(BASE, 'utf-8')
yml = yml.replace(
  /^extraResources:\s*$/m,
  ['extraResources:', ...found.map((e) => `  - from: ${e.from}\n    to: ${e.from}`)].join('\n')
)
// ターゲットを portable（1ファイル）に差し替える
yml = yml.replace(/^ {4}- target: nsis$/m, '    - target: portable')
// **出来上がりは dist-home/ へ。** 公開用の dist/ に素材入りの中間物を残さない
yml = yml.replace(/^ {2}output: dist$/m, '  output: dist-home')
// 自動更新の設定は入れない（身内用は手で渡すため）
yml = yml.replace(/^publish:[\s\S]*?^\n/m, '')
yml += `\nportable:\n  artifactName: GiftCut-家庭用-${ver}.exe\n`
writeFileSync(TMP, yml, 'utf-8')

try {
  const r = spawnSync('npx', ['electron-builder', '--win', 'portable', '--config', TMP], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
  const out = join(ROOT, 'dist-home', `GiftCut-家庭用-${ver}.exe`)
  console.log(
    existsSync(out)
      ? `\n出来ました: ${out}\n  そのまま渡せます（解凍もインストールも不要）。\n` +
          '  ※ 再配布が許可されていない素材が入っています。**身内の PC 以外へ配らないこと。**'
      : '\n出来上がりが見つかりません。上のログを確認してください。'
  )
} finally {
  // **必ず消す。** 残すと、次に公開用を作るときに間違えて使う恐れがある
  rmSync(TMP, { force: true })
}
