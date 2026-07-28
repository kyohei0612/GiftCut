// 本体ウィンドウの大きさ・位置の決め方。
//
// 決めたいことは2つだけ。
//   1. 初回（記憶が無いとき）にどう開くか      → defaultBounds()
//   2. 前回の形をどこまで信じて使うか          → nextBounds()
//
// 画面構成は毎回変わる（ノートを外で開く／モニタを外す／解像度が違う別PC）。
// 「前回1920で開いていたから今回も1920」で開くと、1366のノートでは
// 右端と下端が画面の外に出て、閉じるボタンにも掴む縁にも手が届かなくなる。
// なので前回の値は必ず今の画面に収まるところまで詰めてから使う。
//
// electron に依存しない書き方にしてあるので、画面構成を並べて単体で試せる。

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowState {
  bounds?: Rect
  /** 最大化して閉じたか。最大化中は bounds に「戻したときの形」を入れておく */
  maximized?: boolean
}

/** これ以上小さいと道具が並ばない下限（BrowserWindow の minWidth/minHeight と揃える） */
export const MIN_SIZE = { width: 1100, height: 680 }

// 初回に開く形。画面いっぱいにはせず、後ろのものが少し見える程度に余白を残す。
// 1920 の画面では 1600x920 になる。1366x768 のノートでは 1246x680 まで縮む
// ＝「既定サイズが画面より大きくて最初から枠外」が起きない。
const PREFERRED = { width: 1600, height: 920 }
const MARGIN = { width: 120, height: 112 }

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** 記憶が無いときの形。画面の作業領域に対して決め、真ん中に置く。 */
export function defaultBounds(workArea: Rect): Rect {
  const width = clamp(
    Math.min(PREFERRED.width, workArea.width - MARGIN.width),
    Math.min(MIN_SIZE.width, workArea.width),
    workArea.width
  )
  const height = clamp(
    Math.min(PREFERRED.height, workArea.height - MARGIN.height),
    Math.min(MIN_SIZE.height, workArea.height),
    workArea.height
  )
  return {
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2)
  }
}

/** 窓の一部でもこの領域に重なっているか（＝掴める場所が残っているか） */
function overlaps(b: Rect, area: Rect): boolean {
  return (
    b.x + b.width > area.x &&
    b.x < area.x + area.width &&
    b.y + b.height > area.y &&
    b.y < area.y + area.height
  )
}

/** 窓を、いちばん重なっている画面の中へ収める。どの画面にも掛かっていなければ null。 */
export function fitToScreens(b: Rect, areas: Rect[]): Rect | null {
  const hit = areas.filter((a) => overlaps(b, a))
  if (!hit.length) return null
  // 重なりが大きい画面を「その窓が居る画面」とみなす
  const area = hit.reduce((best, a) => (overlapArea(b, a) > overlapArea(b, best) ? a : best), hit[0])
  const width = clamp(b.width, Math.min(MIN_SIZE.width, area.width), area.width)
  const height = clamp(b.height, Math.min(MIN_SIZE.height, area.height), area.height)
  return {
    width,
    height,
    x: clamp(b.x, area.x, area.x + area.width - width),
    y: clamp(b.y, area.y, area.y + area.height - height)
  }
}

function overlapArea(b: Rect, a: Rect): number {
  const w = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x)
  const h = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y)
  return Math.max(0, w) * Math.max(0, h)
}

/**
 * 次に開く形を決める。
 *   記憶があり、今の画面に収まる  → 前回の形（はみ出しぶんは詰める）
 *   記憶が無い／画面が変わった    → 既定の形（主画面の真ん中）
 */
export function nextBounds(
  saved: WindowState | null | undefined,
  areas: Rect[],
  primary: Rect
): { bounds: Rect; maximized: boolean } {
  const fitted = saved?.bounds ? fitToScreens(saved.bounds, areas) : null
  return {
    bounds: fitted ?? defaultBounds(primary),
    // 画面構成が変わって前回の形を捨てたときは、最大化も引き継がない
    // （「別PCで開いたら知らない画面で最大化されていた」を避ける）
    maximized: !!saved?.maximized && !!fitted
  }
}
