// 同梱素材（SE・テロップ素材）のパスを、いまの置き場へ繋ぎ直す。
//
// ## なぜ要るか（実際に起きた壊れ方）
//
// 家庭用の exe（portable）は**起動のたびに自分をランダムな一時フォルダへ展開する**。
// そこに置いた SE を使うと、プロジェクトには
//
//     C:/…/Temp/3HBMBwOyIyB8apVvBvy5DY9nFbX/resources/SE/…/ショック①.mp3
//
// という**その回限りのパス**が残る。閉じるとそのフォルダは消えるので、
// 次に開いたときファイルが無い＝音が鳴らない。
//
// たちが悪いのは、**同梱の素材を使ったときだけ**起きること。自分で足した素材は
// 場所が変わらないので普通に鳴る。だから「SEが鳴ったり鳴らなかったりする」に見える。
//
// 「SE より後ろの相対部分」さえ合っていれば同じ物なので、そこを頼りに探し直す。

/**
 * 見つからないパスを、置き場の一覧から探し直す。
 *
 * @param p       いま持っているパス
 * @param folder  素材の入れ物の名前（SE / telop-presets）
 * @param roots   いまの置き場の候補
 * @param exists  そこにファイルがあるか（本体側は fs、テストは差し替える）
 */
export function relinkBundledPath(
  p: string,
  folder: string,
  roots: string[],
  exists: (path: string) => boolean
): string {
  if (!p || exists(p)) return p // 見つかっているなら触らない
  const norm = p.split('\\').join('/')
  const at = norm.toLowerCase().lastIndexOf(`/${folder.toLowerCase()}/`)
  if (at < 0) return p // 同梱素材ではない（自分で足した物）＝触らない
  const rel = norm.slice(at + folder.length + 2)
  for (const r of roots) {
    const cand = r.split('\\').join('/').replace(/\/$/, '') + '/' + rel
    if (exists(cand)) return cand
  }
  return p // どこにも無ければそのまま（勝手に別の物を指さない）
}
