// 利用者が自分でいじった物を、**ファイルとして残す**ための決まり。
//
// ## なぜ要るか
//
// お気に入り・自作のテロップスタイル・人物・アイコンの割り当て・自分の動きは、
// 画面側の保存領域（localStorage）に入っている。更新では消えないが、
//
//   - **人の目に見えない**（フォルダを開いても、それらしいファイルが無い）
//   - **持ち出せない**（別の機械へ移すには、内部フォルダを丸ごと写すしかない）
//   - **読み込み元の仕組みを変えた瞬間に、黙って全部消える**
//
// という弱さがある。作った本人にとっては「消えた」としか見えない。
//
// なので**同じ内容をファイルにも書いておき、無ければそこから戻す**。
// ファイルは更新で消えない置き場に置くので、入れ直しても・配り直しても・
// 別の機械へ移しても、そのファイルさえ持っていけば元に戻る。
//
// ## どちらが本物か
//
// **動いている間は localStorage が本物。ファイルはその写し。**
// 起動のときに「localStorage に無い鍵」だけをファイルから戻す。
// 両方にある鍵は触らない——いま使っている方を勝手に上書きするのが一番危ない。

/** 残す対象の鍵。この2つで始まる物が「利用者がいじった物」 */
export const USER_KEY_PREFIXES = ['giftcut.', 'gc.'] as const

/** 残さない鍵。**その場限りの物や、機械が変われば意味が無くなる物** */
const SKIP = new Set([
  'giftcut.e2e.probe' // 自動チェックが使う一時的な鍵
])

export function isUserKey(k: string): boolean {
  if (SKIP.has(k)) return false
  return USER_KEY_PREFIXES.some((p) => k.startsWith(p))
}

/** いまの保存領域から、残す物だけを抜き出す */
export function pickUserData(all: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(all).sort()) if (isUserKey(k)) out[k] = all[k]
  return out
}

/**
 * ファイルから戻す物を決める。
 *
 * **いま入っている鍵は返さない。** 動いている方を上書きしないため。
 * （別の機械の設定ファイルを持ってきたとき、こちらの設定が消えるのを防ぐ）
 */
export function keysToRestore(
  current: Record<string, string>,
  saved: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(saved)) {
    if (!isUserKey(k)) continue
    if (current[k] !== undefined) continue
    const v = saved[k]
    if (typeof v === 'string') out[k] = v
  }
  return out
}

/** 中身が変わったか（変わっていなければ書かない。画像を含むので毎回書くと重い） */
export function changed(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return true
  for (const k of ka) if (a[k] !== b[k]) return true
  return false
}
