// **中身が同じなら、前と同じ物を返す。** 毎コマ作り直る囲い（context）の値に当てる。
//
// ## なぜ要るか（2026-11-08）
//
// `currentTime`（毎コマ変わる）を読む囲いは、毎コマ新しい値の物を作る。中身が同じでも
// 物が違えば、React はそれを読んでいる側を全部描き直す。実測（再生5秒・初期の素材）で
// AppInner＝画面全体が毎コマ描き直り、巻き添えの ClipBand が 1,216回/秒だった。
// 帯は数に比例して増えるので「編集を続けるほど重い」になる。
//
// 変わるのは切片をまたぐ・テロップが出入りする・動きが付いている時だけなので、
// 「同じか」を中身で見て、同じなら前の物を返す。読んでいる側は本当に変わった時だけ描き直る。
//
// ## 2つの比べ方
//
// - `useStableValue(next, same)` … 比べ方を自分で渡す（配列の中身の同一性など）
// - `useStableByKey(next, keyOf)` … 文字列の鍵（JSON など）で比べる。鍵は前回の物を覚えるので
//   1コマに1回しか作らない
//
// どちらも**同じ物を返している間、その物の中の ref は最新**（useRef の箱は同じ物を指すため）。
import { useRef } from 'react'

/** `same(prev, next)` が真なら prev を返し続ける */
export function useStableValue<T>(next: T, same: (prev: T, next: T) => boolean): T {
  const ref = useRef<T>(next)
  if (!same(ref.current, next)) ref.current = next
  return ref.current
}

/** `keyOf(next)` が前回と同じ文字列なら前の物を返し続ける */
export function useStableByKey<T>(next: T, keyOf: (v: T) => string): T {
  const ref = useRef<{ key: string; value: T } | null>(null)
  const key = keyOf(next)
  if (!ref.current || ref.current.key !== key) ref.current = { key, value: next }
  return ref.current.value
}

/** 配列の**要素が同じ物**（長さと各要素の同一性）か。並びが同じで中身の物も同じなら真 */
export function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
