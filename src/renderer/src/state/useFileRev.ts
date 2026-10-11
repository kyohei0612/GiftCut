// 参照している素材ファイルの「版」。外から書き換えられたら画面を取り直させる。
//
// ## なぜ要るか
//
// 素材は写しを取らず、置いてある場所（Downloads など）をそのまま参照している。
// 本人の指定（2026-10-11）: 「使っている最中にその画像が別の物に上書きされたら、
// 入れ替えなくてもアプリも変わるように」。
//
// 画面（Chromium）は**同じ URL の <img>/<video> を取り直さない**。書き換わったことは
// main（`main/fileWatch`）が見張って知らせてくるので、こちらはそのファイルの版を
// 1つ上げ、URL の末尾に `?v=版` を付けて別の URL にする。それだけで画面は取り直す。
// `gcfile://` の受け口は pathname しか見ないので、query は配信に影響しない。
//
// ## 中身
//
// - `useFileRev` … 版の表と、版を上げる口、版つきの URL を返す口
// - `keyOf`      … パスの比べ方（main の名簿と同じ。区切りを揃え、大文字小文字は見ない）
import { useCallback, useRef, useState } from 'react'
import { toGcUrl } from '../lib/gcUrl'

/** パスの比べ方は main の名簿（allowList）と同じ: 区切りを揃え、大文字小文字は見ない */
const keyOf = (p: string): string => p.replace(/\\/g, '/').toLowerCase()

export function useFileRev() {
  const [revs, setRevs] = useState<Record<string, number>>({})
  // 描き直しを待たずに読む側（URL を組む所）のために写しも持つ
  const revsRef = useRef(revs)
  revsRef.current = revs

  /** そのファイルの版を1つ上げる（main から「書き換わった」が来たとき） */
  const bump = useCallback((path: string): void => {
    setRevs((prev) => ({ ...prev, [keyOf(path)]: (prev[keyOf(path)] ?? 0) + 1 }))
  }, [])

  /** そのファイルの、いまの版 */
  const revOf = useCallback((path: string): number => revsRef.current[keyOf(path)] ?? 0, [])

  /**
   * 版つきの URL。**素材を画面に出す所は全部これを通す**（`toGcUrl` を直に使うと、
   * 書き換わっても古い絵のまま）。版が 0 なら今までと同じ URL
   */
  const urlOf = useCallback(
    (path: string): string => {
      const r = revsRef.current[keyOf(path)] ?? 0
      return r ? `${toGcUrl(path)}?v=${r}` : toGcUrl(path)
    },
    // revs が変わるたびに新しい関数にして、使う側の memo を解く
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revs]
  )

  return { revs, bump, revOf, urlOf }
}
