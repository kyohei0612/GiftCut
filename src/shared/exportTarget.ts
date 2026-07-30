// 書き出し先として使ってよいファイルかを見る。
//
// ## なぜ要るか（実際に出た壊れ方）
//
// 前に書き出した mp4 をタイムラインに読み込んだまま、また同じ名前へ書き出すと、
// ffmpeg は **読みながら同じファイルへ書けない**ので必ず失敗する。出るのは
//
//     Output … same as Input #0 - exiting
//     FFmpeg cannot edit existing files in-place.
//
// という英語の壁で、「何をどうすればいいか」がまったく分からない。
// こちらは素材の一覧を持っているので、**始める前に気づけるし、日本語で言える**。

/** パスを比べられる形にそろえる（区切りと大文字小文字の違いを吸収） */
export function normalizePath(p: string): string {
  return p.split('\\').join('/').replace(/\/+$/, '').toLowerCase()
}

/**
 * 書き出し先が、いま素材として使っているファイルと同じなら、その素材のパスを返す。
 * 同じでなければ null。
 */
export function clashingSource(outPath: string, usedPaths: string[]): string | null {
  if (!outPath) return null
  const out = normalizePath(outPath)
  return usedPaths.find((p) => p && normalizePath(p) === out) ?? null
}
