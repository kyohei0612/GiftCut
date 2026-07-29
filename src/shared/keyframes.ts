// キーフレーム（時間で変わる値）。
//
// クリップの「拡大」「位置」は、いままでクリップ全体で1つの固定値だった。
// これを **時間の関数** にする。プレミアと同じ考え方:
//
//   ストップウォッチを押すと、その時刻に印（キー）が置かれる
//   別の時刻で値を変えると、そこにも印が置かれ、間はなめらかにつながる
//   印が1つも無ければ、今までどおりの固定値
//
// 時刻は**クリップの先頭からの秒**で持つ。タイムライン上の絶対時刻で持つと、
// クリップを動かした瞬間に動きが置いていかれる。
//
// 書き出しでも同じ計算を使う（ffmpeg へ渡す式もここから作る）。
// プレビューと書き出しで別々に計算すると、聴いた音と書き出した音が違う、と
// 同じ種類の事故になる。

export type Easing = 'linear' | 'hold' | 'ease'

export interface Key<T> {
  /** クリップの先頭からの秒 */
  t: number
  v: T
  /** 次のキーまでのつなぎ方。既定は linear */
  e?: Easing
}

/** 数値のキーフレーム列。時刻の昇順で持つ */
export type Keys = Key<number>[]

/** なめらかに（両端がゆっくり）。プレミアの「イーズイン/アウト」に相当 */
function easeInOut(k: number): number {
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
}

/**
 * その時刻の値。
 * キーが無ければ fallback、1つならその値、範囲外は端の値で止める（プレミアと同じ）。
 */
export function valueAt(keys: Keys | undefined, t: number, fallback: number): number {
  if (!keys || keys.length === 0) return fallback
  if (keys.length === 1) return keys[0].v
  if (t <= keys[0].t) return keys[0].v
  const last = keys[keys.length - 1]
  if (t >= last.t) return last.v
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    // 区間は「次のキーの手前まで」。ちょうど次のキーの時刻になったら次の区間の話
    // （hold のとき、境目でどちらの値かが書き出しの式とズレる）
    if (t >= a.t && t < b.t) {
      if (a.e === 'hold') return a.v
      const span = b.t - a.t
      const k = span <= 0 ? 1 : (t - a.t) / span
      const p = a.e === 'ease' ? easeInOut(k) : k
      return a.v + (b.v - a.v) * p
    }
  }
  return last.v
}

/** 時刻順に整える。同じ時刻に2つ置かない（後から置いた方が勝つ） */
export function sortKeys(keys: Keys): Keys {
  const out = [...keys].sort((a, b) => a.t - b.t)
  return out.filter((k, i) => i === out.length - 1 || Math.abs(out[i + 1].t - k.t) > 1e-4)
}

/** その時刻にキーを置く（同じ時刻にあれば置き換え） */
export function putKey(keys: Keys | undefined, t: number, v: number, e?: Easing): Keys {
  const rest = (keys ?? []).filter((k) => Math.abs(k.t - t) > 1e-4)
  return sortKeys([...rest, { t, v, ...(e ? { e } : null) }])
}

/** その時刻のキーを消す。無くなったら undefined（＝固定値に戻る） */
export function removeKey(keys: Keys | undefined, t: number): Keys | undefined {
  const rest = (keys ?? []).filter((k) => Math.abs(k.t - t) > 1e-4)
  return rest.length ? rest : undefined
}

/** その時刻にキーがあるか（ストップウォッチの◆を光らせる判定） */
export function keyAt(keys: Keys | undefined, t: number): Key<number> | undefined {
  return (keys ?? []).find((k) => Math.abs(k.t - t) <= 1e-4)
}

/** ひとつ前 / ひとつ後のキーの時刻（◀◆▶ で移動する） */
export function prevKeyTime(keys: Keys | undefined, t: number): number | null {
  const before = (keys ?? []).filter((k) => k.t < t - 1e-4)
  return before.length ? before[before.length - 1].t : null
}
export function nextKeyTime(keys: Keys | undefined, t: number): number | null {
  const after = (keys ?? []).find((k) => k.t > t + 1e-4)
  return after ? after.t : null
}

/** 動きが付いているか（1つでもキーがあれば） */
export function hasKeys(keys: Keys | undefined): boolean {
  return !!keys && keys.length > 0
}

/**
 * ffmpeg の式にする。**プレビューと同じ折れ線**を、そのまま式で表す。
 *
 * 時刻の変数名は呼ぶ側が決める（zoompan なら `on/FPS`、overlay なら `t`）。
 * 区間ごとに if を重ねる形。キーが少ないので式は短く収まる。
 */
export function keysToExpr(keys: Keys | undefined, fallback: number, timeVar: string): string {
  if (!keys || keys.length === 0) return String(round(fallback))
  if (keys.length === 1) return String(round(keys[0].v))
  let expr = String(round(keys[keys.length - 1].v)) // 最後のキーより後ろは、その値のまま
  // 後ろから前へ包んでいく（if(lt(t,境目), 手前の式, 奥の式)）
  for (let i = keys.length - 2; i >= 0; i--) {
    const a = keys[i]
    const b = keys[i + 1]
    const span = b.t - a.t
    let seg: string
    if (a.e === 'hold' || span <= 0) {
      seg = String(round(a.v))
    } else {
      const k = `((${timeVar}-${round(a.t)})/${round(span)})`
      // なめらかは 2k²（前半）/ 1-2(1-k)²（後半）。式でも同じ形にする
      const p = a.e === 'ease' ? `if(lt(${k},0.5),2*${k}*${k},1-2*(1-${k})*(1-${k}))` : k
      seg = `(${round(a.v)}+(${round(b.v - a.v)})*(${p}))`
    }
    expr = `if(lt(${timeVar},${round(b.t)}),${seg},${expr})`
  }
  // いちばん手前のキーより前は、最初の値のまま
  return `if(lt(${timeVar},${round(keys[0].t)}),${round(keys[0].v)},${expr})`
}

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4
}
