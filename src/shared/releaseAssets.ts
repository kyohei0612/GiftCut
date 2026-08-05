// 「Releases への添付が本当に揃っているか」の判定。
//
// ## なぜ機械で数えるか
//
// `npm run release` は**添付が足りなくても終了コード 0 で終わる。**
// 0.1.11 / 0.1.21 / 0.1.22 / 0.1.23 と**4回連続**で同じ落ち方をした:
// ログには `uploading file=...exe` と出ているのに、実際には上がっていない。
// `publishing` の行が2回出る（発行が二重に走る）のが目印。
//
// これまでは手順書に「2回回す前提」「添付の数を数えるまで出せたと思うな」と
// **人間向けに書いて**しのいでいた。読む人が居なければ効かない決まりなので、
// ここで機械に数えさせる。
//
// ## 足りないと何が起きるか（順に重い）
//
//   latest.yml が無い  … **自動更新が動かない。**使っている人に永遠に届かない
//   exe が無い         … 手で落とす道も無い
//   blockmap が無い    … 差分更新ができず、毎回 120MB を丸ごと落とす
//
// blockmap は「無くても更新はできる」ので見逃しやすいが、
// **見逃しやすい物ほど機械で見る**（気づける物なら人間でよい）。

/** 版から、あるべき添付の名前を出す */
export function expectedAssets(version: string): string[] {
  return [
    `GiftCut-Setup-${version}.exe`,
    `GiftCut-Setup-${version}.exe.blockmap`,
    'latest.yml'
  ]
}

export interface AssetInfo {
  name: string
  size: number
}

export interface AssetVerdict {
  ok: boolean
  /** 名前ごと無い物 */
  missing: string[]
  /** 名前はあるが中身が空（0バイト）の物。**これが一番たちが悪い** */
  empty: string[]
}

/**
 * 添付の一覧を見て、出せているかを判定する。
 *
 * **「数が3つある」で判定しない。** 名前で照合する——
 * 別の版の exe が残っていても数は足りてしまうし、
 * 実際 0.1.23 の1回目は「exe と latest.yml はあるが blockmap が無い」だった
 * （数だけ見ると2で、3を期待していれば落ちるが、**どれが無いか**は言えない）。
 *
 * **0バイトも赤にする。** 上げ損ねると 0 バイトのまま登録されることがあり、
 * 自動更新は「ある」と判断して落としに行って失敗する
 * ——**無い方がまだ分かりやすい**（CLAUDE.md 7番「黙って死ぬ」）。
 */
export function checkAssets(version: string, assets: AssetInfo[]): AssetVerdict {
  const byName = new Map(assets.map((a) => [a.name, a.size]))
  const missing: string[] = []
  const empty: string[] = []
  for (const want of expectedAssets(version)) {
    const size = byName.get(want)
    if (size === undefined) missing.push(want)
    else if (size <= 0) empty.push(want)
  }
  return { ok: missing.length === 0 && empty.length === 0, missing, empty }
}

/** 人が読む形にする（そのまま stderr に出す） */
export function describeVerdict(version: string, v: AssetVerdict): string {
  if (v.ok) return `v${version}: 添付3つとも揃っています`
  const lines = [`v${version}: **出せていません。**`]
  if (v.missing.length) lines.push(`  上がっていない: ${v.missing.join(' / ')}`)
  if (v.empty.length) lines.push(`  0バイト: ${v.empty.join(' / ')}`)
  lines.push(
    '',
    '`npm run release` をもう一度回してください（1回目で足りないのは既知。',
    '4回連続で起きていて、終了コードは 0 と嘘をつきます）。',
    '2回目でも揃わないなら GitHub 側かトークンを疑うこと。'
  )
  return lines.join('\n')
}
