// 「触っていないのと同じか」の判定。拡大・切り抜き・色調整の3つ。
//
// ## なぜ1か所に集めてあるか
//
// **画面と書き出しの両方が、同じ問いに答える必要がある。**
// 片方が「等倍だから何も出さない」と決め、もう片方が「等倍ではない」と決めると、
// **見た絵と出来た絵が違う**——このアプリで二度やらかしている型の事故になる。
//
// 実際、2026-08-02 まで3か所に別々に書かれていて、**そのうち1つだけ規則が違った**:
//
//   画面（lib/clipLook）         Math.abs(scale - 1) < 1e-3   ← 誤差を許す
//   フィルタ（colorAdjust）      Math.abs(b - 1) <= 1e-3      ← 誤差を許す
//   書き出しの組み立て           scale === 1                  ← **許さない**
//
// つまみを戻して 1.0000001 になったとき、画面は「等倍」として何も出さないのに、
// 書き出しは「等倍ではない」と見て zoompan を1段掛けていた。
// 見た目の差は小さいが、**掛ける必要のないフィルタで書き出しが 35% 遅くなる**。
//
// ## 誤差を許す側に揃えてある
//
// つまみやドラッグで戻した値はぴったりにならない。**人が「戻した」と思った物は
// 戻ったものとして扱う**のが正しい。ぴったり比較にすると、見えない差でフィルタが増える。

/** 拡大（リフレーム）。scale・x・y */
export interface Zoom {
  scale: number
  x: number
  y: number
}
/** 切り抜き。各辺の切り取り率（0〜1） */
export interface Crop {
  l: number
  t: number
  r: number
  b: number
}
/** 色調整。明るさ・コントラスト・彩度（1 が素のまま） */
export interface Adjust {
  b: number
  c: number
  s: number
}

/** 1 とみなす幅。つまみで戻したときの誤差を吸収する */
const EPS = 1e-3
/** 0 とみなす幅（切り抜きは率なので、もう一桁細かく見る） */
const EPS_CROP = 1e-4

/** 拡大していないのと同じか */
export function isNeutralZoom(z?: Zoom): boolean {
  return !z || (Math.abs(z.scale - 1) <= EPS && Math.abs(z.x) <= EPS && Math.abs(z.y) <= EPS)
}

/** 切り抜いていないのと同じか */
export function isNeutralCrop(c?: Crop): boolean {
  return (
    !c ||
    (Math.abs(c.l) <= EPS_CROP &&
      Math.abs(c.t) <= EPS_CROP &&
      Math.abs(c.r) <= EPS_CROP &&
      Math.abs(c.b) <= EPS_CROP)
  )
}

/** 色を調整していないのと同じか */
export function isNeutralAdjust(a?: Adjust): boolean {
  return (
    !a || (Math.abs(a.b - 1) <= EPS && Math.abs(a.c - 1) <= EPS && Math.abs(a.s - 1) <= EPS)
  )
}
