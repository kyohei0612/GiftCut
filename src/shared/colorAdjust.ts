// 色調整（明るさ・コントラスト・彩度）を ffmpeg のフィルタにする。
//
// ## なぜ eq を使わないか
//
// 素直に書くなら `eq=brightness=…:contrast=…:saturation=…` だが、
// **eq は GPL 専用のフィルタで、同梱している LGPL 版の ffmpeg には入っていない。**
//
//     No such filter: 'eq'
//
// 開発機は PATH に GPL 版が入っていて通ってしまうため気づけない。
// 配布物では**書き出しがエラーで止まる**（静かに効かないのではなく、失敗する）。
//
// ## 代わりに何を使うか
//
// `lutyuv`（LGPL）で、eq と同じ計算を書く。eq の中身は「値ごとの対応表」なので、
// 同じ式を書けば同じ絵になる。実際に eq の対応表を吸い出して突き合わせた:
//
//     明るさだけ        … 完全一致
//     明るさ＋コントラスト＋彩度 … ずれは最大 1〜4 / 255（目には見えない）
//
// ## 式（eq の対応表から割り出したもの）
//
//     Y   = C * (val - 128) + 128 + B * 255
//     U,V = S * (val - 128) + 128
//
// **`maxval` / `minval` は使わないこと。** yuv では制限レンジ（16〜235）を指すので、
// 255 のつもりで書くと絵が変わる（これで一度ハマった）。

/** 画面側（CSS filter）と同じ意味の3つ。1 が無調整 */
export interface Adjust {
  /** 明るさ。1 が無調整 */
  b: number
  /** コントラスト。1 が無調整 */
  c: number
  /** 彩度。1 が無調整 */
  s: number
}

/** 実質「無調整」か（無調整ならフィルタを1段挟むだけ無駄なので付けない） */
export function isNeutralAdjust(a?: Adjust): boolean {
  return (
    !a || (Math.abs(a.b - 1) <= 1e-3 && Math.abs(a.c - 1) <= 1e-3 && Math.abs(a.s - 1) <= 1e-3)
  )
}

/**
 * 色調整のフィルタ文字列。無調整なら空文字（呼ぶ側はそのまま繋げてよい）。
 *
 * 明るさは画面側が倍率（1=無調整）で持っているのに対し、ffmpeg 側は
 * 足し算なので `b - 1` を渡す。これは eq を使っていた頃からの決まりで、
 * 見た目を変えないためにそのまま踏襲している。
 */
export function colorAdjustFilter(a?: Adjust): string {
  if (isNeutralAdjust(a)) return ''
  const B = (a!.b - 1).toFixed(3)
  const C = a!.c.toFixed(3)
  const S = a!.s.toFixed(3)
  const y = `clip(${C}*(val-128)+128+(${B})*255,0,255)`
  const uv = `clip(${S}*(val-128)+128,0,255)`
  return `lutyuv=y='${y}':u='${uv}':v='${uv}'`
}
