// テロップを新しく置くとき、画面のどこに出すか。
//
// ## 既定の場所は1か所で決める
//
// 「下寄り中央」は前は `{ x: 0.5, y: 0.85 }` が**7か所に書き写されて**いた
// （SRT の読み込み／字幕の生成／テロップ追加／開き直し／プレビューの fallback／
// PNG 化／プレビューで掴む側）。編集者（本人の妻）の指定で**中心を 989px
// （1080 基準）**へ変えるとき、7か所のうち1つでも残ると「SRT で読んだ物だけ
// 昔の高さ」になる。だから置き場所はここだけが持つ。
//
// ## 既に出ているテロップと被るなら、被らない所まで上へずらす
//
// 同じ時刻に別のテロップが出ていると、同じ既定位置に重なって文字が読めない。
// 段（V2/V3）は `shared/telopLane` が分けてくれるが、**段が違っても画面の位置は
// 同じ**なので見た目は重なる。そこで、時間が重なる相手の箱の真上へ積む。
// 箱の大きさは `buildTelopSVG`（プレビュー・PNG 化と同じ物差し）で測る。
// 別の式で測ると、画面では避けているのに書き出すと被る、が起きる。
//
// ## 中身
//
// - `DEFAULT_TELOP_POS` … 既定の置き場所（アンカー点、フレーム比）
// - `telopVSpan`        … テロップが画面の縦のどこを占めるか（フレーム比）
// - `stackAbove`        … 相手の箱を避けて上へ積んだときの、箱の中心 y（純粋）
// - `placeNewTelops`    … 足すテロップ群に置き場所を付けて返す
import { buildTelopSVG, textRectInFrame } from './telopStyle'
import { overlaps } from '../../../shared/telopLane'
import type { Cue } from './srt'

/** 既定の中心の高さ（1080 基準 px）。編集者の指定値 */
export const DEFAULT_TELOP_Y_PX = 989

/** テロップの置き場所の既定（画面の下寄り・中央）。フレーム比 */
export const DEFAULT_TELOP_POS: { x: number; y: number } = {
  x: 0.5,
  y: DEFAULT_TELOP_Y_PX / 1080
}

/** 積むときの隙間（フレーム比）。1080 基準で 8px */
export const STACK_GAP = 8 / 1080

/** 画面の縦の占め方（フレーム比。0 が上端、1 が下端） */
export interface VSpan {
  top: number
  bottom: number
}

/** 測るのに要る分だけ */
export type PlaceableCue = Pick<Cue, 'style' | 'text' | 'runs' | 'pos' | 'scale'>

/**
 * テロップが画面の縦のどこを占めるか。
 *
 * 空の本文（追加した直後）は高さが 0 になって何とも当たらないので、
 * 1行ぶん（「あ」）として測る。フレームの幅は縦の計算に効かないので 1920 固定。
 */
export function telopVSpan(c: PlaceableCue): VSpan {
  const svg = buildTelopSVG(c.style, c.text || 'あ', c.runs)
  const r = textRectInFrame(c.pos ?? DEFAULT_TELOP_POS, c.style.anchor, svg.w, svg.h, 1920, 1080, c.scale ?? 1)
  return { top: r.y, bottom: r.y + r.h }
}

/**
 * 相手の箱を避けて上へ積んだときの、箱の**中心** y。
 *
 * 下（既定）から始めて、当たった相手の真上へ。避けた先でさらに別の相手に
 * 当たることがあるので、当たらなくなるまで繰り返す。画面の上端は越えない
 * （越えると見えない所に置かれて、消えたように見える）。
 */
export function stackAbove(
  halfH: number,
  blockers: readonly VSpan[],
  baseY: number,
  gap = STACK_GAP
): number {
  let y = baseY
  for (let guard = 0; guard <= blockers.length; guard++) {
    const hit = blockers.find((b) => y - halfH < b.bottom && y + halfH > b.top)
    if (!hit) break
    y = hit.top - gap - halfH
  }
  return Math.max(halfH, y)
}

/**
 * 足すテロップ群に置き場所を付けて返す。
 *
 * 相手は「いま在る物」と「この群の中で先に置いた物」の両方。SRT の中で
 * 時刻が重なる2枚（二人が同時に喋る）も、2枚目が1枚目の上に乗る。
 * 位置はアンカー点なので、箱の中心からアンカーまでのずれを足して返す。
 */
export function placeNewTelops<T extends Cue>(existing: readonly Cue[], incoming: readonly T[]): T[] {
  const placed: Cue[] = []
  const out: T[] = []
  for (const c of incoming) {
    const self = telopVSpan({ ...c, pos: DEFAULT_TELOP_POS })
    const halfH = (self.bottom - self.top) / 2
    const anchorOff = DEFAULT_TELOP_POS.y - (self.top + self.bottom) / 2
    const blockers = [...existing, ...placed]
      .filter((o) => overlaps(c.start, c.end, o.start, o.end))
      .map(telopVSpan)
    const y = stackAbove(halfH, blockers, DEFAULT_TELOP_POS.y - anchorOff) + anchorOff
    const next = { ...c, pos: { x: DEFAULT_TELOP_POS.x, y } }
    placed.push(next)
    out.push(next)
  }
  return out
}
