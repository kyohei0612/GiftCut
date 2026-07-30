// 読み込んだ Premiere のプリセットを、GiftCut の「動き」に変換する。
//
// ## 単位を合わせるのが仕事
//
// 向こうとこちらで、同じ物を違う単位で持っている。ここを間違えると
// **動きはするが量が違う**という、一番気づきにくいズレになる。
//
//   位置     … 向こう: フレームに対する割合（0.5,0.5 が中央）
//              こちら: 中央からのズレを 1920x1080 基準の px で持つ
//              → (割合 - 0.5) × 1920（縦は 1080）
//   スケール … 向こう: 100 が等倍     こちら: 1 が等倍   → ÷100
//   回転     … 度どうしなのでそのまま
//   不透明度 … 向こう: 100 が不透明   こちら: 1 が不透明 → ÷100
//
// **接線（速度）も同じ倍率で直す。** 速度は「値/秒」なので、値を100で割ったなら
// 速度も100で割らないと、曲がり方だけ元のままになる（直線に見えたり暴れたりする）。
//
// ## 何を持ってくるか
//
// いまは Motion（位置・スケール・回転）と Opacity（不透明度）だけ。
// この2つだけでできているプリセットは、**そのまま完全に再現できる**。
// 色やブラーが混ざっている物は、焼き方を足してから。

import type { Motion } from './telopMotion'
import type { BezierKey } from './bezierKeys'
import type { PrPreset } from './prfpset'

/** GiftCut 側の動き（テロップの Motion と同じ形。lib/telopStyle から独立させてある） */
export type { Motion } from './telopMotion'

/** 向こうの MatchName */
const MOTION = 'AE.ADBE Motion'
const OPACITY = 'AE.ADBE Opacity'
/**
 * 「トランスフォーム」エフェクト。**動きはこちらに付いていることが多い。**
 * 素の「モーション」ではなくこちらを使うと、歪曲やシャッター角度が足せるため。
 * 中身（位置・スケール・回転・不透明度）は同じ意味なので、同じように読める。
 */
const GEOMETRY = 'AE.ADBE Geometry2'
/** 基本3D。スウィベル（横回転）とチルト（縦回転） */
const BASIC3D = 'AE.ADBE Basic 3D'
/** 色調整。明度だけ持ってくる（コントラスト・彩度・色相はまだ） */
const PROCAMP = 'AE.ADBE ProcAmp'
/** ガウスぼかし */
const GBLUR = 'AE.ADBE Gaussian Blur 2'
/** 切り抜き。**タイプライターや「光」系の正体はこれ** */
const CROP = 'AE.ADBE AECrop'
/** カラーバランス(HLS)。実物で動いているのは色相だけ（明度・彩度は固定値） */
const CBHLS = 'AE.ADBE Color Balance (HLS)'
/** 色の反転 */
const INVERT = 'AE.ADBE Invert'
/** ブラインド。縞で覆って開いていく。CSS のマスクで出す */
const BLINDS = 'AE.ADBE Venetian Blinds'
/**
 * 波形ワープ。文字を波打たせる。**一番使われている（実物で7件）。**
 * 動くのは「波紋の高さ」と「波形の幅」だけで、種類・固定・フェーズは固定値。
 */
const WAVEWARP = 'AE.ADBE Wave Warp'

const HANDLED = new Set([
  MOTION, OPACITY, GEOMETRY, BASIC3D, PROCAMP, GBLUR, CROP, CBHLS, INVERT, BLINDS, WAVEWARP
])

/**
 * 演出が終わったときに、テロップが**見えなくなる**か。
 *
 * 実物には「_上」「_下」の対（41.点灯_上/下 など）があり、上側は
 * **2枚重ねたうちの上に乗せる光の筋**。単体で当てると最後に文字ごと消える。
 * これは取り込みの誤りではなく、そういう作りの物。
 *
 * **黙って「壊れている」に見えるのが一番まずい**ので、名前ではなく中身から判定して
 * 一覧の上で知らせる（名前で見ると「_上」を持たない同種の物を取りこぼす）。
 */
export function endsHidden(m: Motion): boolean {
  const last = (k?: Motion['tx']): number | undefined => (k?.length ? k[k.length - 1].v : undefined)
  const op = last(m.op)
  if (op != null && op < 0.02) return true
  const blind = last(m.blind)
  if (blind != null && blind > 0.98) return true
  const l = last(m.cl) ?? 0, r = last(m.cr) ?? 0, t = last(m.ct) ?? 0, b = last(m.cb) ?? 0
  // 両側から覆いきっていれば、何も残らない
  if (l + r > 0.98 || t + b > 0.98) return true
  // **片側だけでも、真ん中を越えていれば文字は残らない。**
  // 切り抜きはフレームに対する割合で、テロップは横方向には真ん中にいる。
  // 41.点灯_上 は左から 89.9% まで削って終わるので、中央の文字は跡形もない。
  // 縦は置き場所が下寄りだったり色々なので、ここでは見ない（両側の合計で見る）。
  return l > 0.5 || r > 0.5
}

/** そのプリセットが、こちらで持てるエフェクトだけでできているか */
export function isFullyCopyable(p: PrPreset): boolean {
  return p.effects.every((e) => HANDLED.has(e.matchName))
}

/**
 * 位置を「最後に落ち着く所からのズレ」に直す。
 *
 * ## なぜ 0.5 を原点にしてはいけないか
 *
 * こちらの tx/ty は、**テロップを置いた場所からのズレ**として足される。
 * だから演出が終わったときに 0 でないと、テロップが置いた場所と違う所に
 * 座り続ける（「落ちる」を当てたら、落ちた先で止まったまま戻らない）。
 *
 * 向こうの値は画面の中の絶対位置なので、**そのプリセット自身の最後のキー**が
 * 「落ち着く所」。中央(0.5)とは限らない。実物では
 *
 *     58.落ちる    y: 0.88 → 0.972   ← 下寄りで作られている
 *     03.SLIDE_R2  y: 0.974 のまま固定
 *
 * となっていて、0.5 を原点にすると全部その差だけ下へズレる。
 * 最後のキーを引けば、中央で作られた物（01.SLIDE_R など）も 0 のままで変わらない。
 */
function relativeToLast(keys: BezierKey[], mul: number): BezierKey[] {
  const last = keys.length ? keys[keys.length - 1].v : 0
  return scaleKeys(keys, mul, -last * mul)
}

/** 値と接線に同じ倍率を掛ける（速度は「値/秒」なので同じ倍率でよい） */
function scaleKeys(keys: BezierKey[], mul: number, add = 0): BezierKey[] {
  return keys.map((k) => ({
    t: k.t,
    v: k.v * mul + add,
    ...(k.in ? { in: { speed: k.in.speed * mul, influence: k.in.influence } } : null),
    ...(k.out ? { out: { speed: k.out.speed * mul, influence: k.out.influence } } : null)
  }))
}

/** GiftCut の Keys（keyframes.ts の形）へ。接線の名前だけ違う */
function toKeys(keys: BezierKey[]): Motion['tx'] {
  if (!keys.length) return undefined
  return keys.map((k) => ({
    t: k.t,
    v: k.v,
    ...(k.in ? { ti: k.in } : null),
    ...(k.out ? { to: k.out } : null)
  }))
}

/**
 * プリセット1つを GiftCut の動きにする。
 * 対応していないエフェクトは**黙って捨てず**、呼ぶ側へ名前を返す
 * （「取り込んだのに一部だけ効いていない」を隠さないため）。
 */
export function toMotion(p: PrPreset): { motion: Motion; skipped: string[] } {
  const motion: Motion = {}
  const skipped: string[] = []
  for (const e of p.effects) {
    if (!HANDLED.has(e.matchName)) {
      if (e.params.some((q) => q.keys.length)) skipped.push(e.matchName)
      continue
    }
    for (const q of e.params) {
      // ブラインドの幅と向きは**動かない**（実物でも固定値）。動くのは「変換終了」だけ。
      // 印が無いと読み飛ばす作りなので、ここだけ固定値も拾う
      if (e.matchName === BLINDS && !q.keys.length) {
        if (q.name === '幅' && Number.isFinite(q.value[0])) motion.blindW = q.value[0]
        if (q.name === '方向' && Number.isFinite(q.value[0])) motion.blindDir = q.value[0]
        continue
      }
      // 波形ワープも、動かない値のうち意味のある物を拾う。
      // **「ユラユラ」系は高さも幅も動かない**（波が流れ続けるだけ）ので、
      // 印だけ見ていると「波なんて付いていない」ことになってしまう。
      if (e.matchName === WAVEWARP && !q.keys.length) {
        const v = q.value[0]
        if (!Number.isFinite(v)) continue
        if (q.name === '波形の速度') motion.wavSpd = v
        else if (q.name === '波紋の高さ' && v) motion.wavH = [{ t: 0, v }]
        else if (q.name === '波形の幅' && v) motion.wavW = [{ t: 0, v }]
        else if (q.name === '方向' && v) motion.wavDir = [{ t: 0, v }]
        continue
      }
      if (!q.keys.length) continue
      const [x, y] = q.keys
      switch (q.name) {
        case '位置':
          // 割合 → 「最後に落ち着く所からのズレ」（px）。0.5 固定ではない（上の説明）
          motion.tx = toKeys(relativeToLast(x, 1920))
          if (y) motion.ty = toKeys(relativeToLast(y, 1080))
          break
        case 'スケール':
          motion.sc = toKeys(scaleKeys(x, 0.01))
          break
        case '回転':
          motion.rot = toKeys(x)
          break
        case '不透明度':
          motion.op = toKeys(scaleKeys(x, 0.01))
          break
        case 'スケール (幅)':
        case 'スケール（幅）':
          // 横だけの拡大。100 が等倍
          motion.scx = toKeys(scaleKeys(x, 0.01))
          break
        case 'スケール (高さ)':
        case 'スケール（高さ）':
          // 縦だけの拡大。**潰れて伸びる演出の本体**（ビョヨン・落ちる・メビウス）
          motion.scy = toKeys(scaleKeys(x, 0.01))
          break
        case '歪曲':
          // 度どうしなのでそのまま
          motion.skew = toKeys(x)
          break
        case 'スウィベル':
          motion.roty = toKeys(x)
          break
        case 'チルト':
          motion.rotx = toKeys(x)
          break
        case '明度':
          // ProcAmp は 0 が無調整（-100〜100）。CSS の brightness は 1 が無調整
          motion.bright = toKeys(scaleKeys(x, 0.01, 1))
          break
        case 'ブラー':
          // px どうし。1080基準でそのまま
          motion.blur = toKeys(x)
          break
        case '色相':
          // 度どうしなのでそのまま（CSS の hue-rotate と同じ意味）
          motion.hue = toKeys(x)
          break
        case '変換終了':
          // 100 で全部隠れ、0 で全部見える
          motion.blind = toKeys(scaleKeys(x, 0.01))
          break
        case '元の画像とブレンド':
          // 向こうは「元の絵をどれだけ混ぜるか」（100=元のまま）。
          // こちらの inv は「どれだけ反転するか」なので**裏返す**
          motion.inv = toKeys(scaleKeys(x, -0.01, 1))
          break
        case '左':
          motion.cl = toKeys(scaleKeys(x, 0.01))
          break
        case '上':
          motion.ct = toKeys(scaleKeys(x, 0.01))
          break
        case '右':
          motion.cr = toKeys(scaleKeys(x, 0.01))
          break
        case '下':
          motion.cb = toKeys(scaleKeys(x, 0.01))
          break
        case '波紋の高さ':
          // px どうし。1080基準でそのまま（負なら波が裏返る）
          motion.wavH = toKeys(x)
          break
        case '波形の幅':
          motion.wavW = toKeys(x)
          break
        case '方向':
          // **どのエフェクトの「方向」かで意味が違う。**
          // ブラインドの方向は動かない物として上で拾っている（ここへは来ない）。
          if (e.matchName === WAVEWARP) motion.wavDir = toKeys(x)
          else skipped.push(`${e.matchName}/${q.name}`)
          break
        case '波形の種類':
        case '固定':
        case 'フェーズ':
        case 'アンチエイリアス (最高画質)':
          // 実物では全部動かない。動いていても、こちらの波は正弦の1種類だけなので無視してよい
          break
        case '歪曲軸':
        case 'アンチフリッカー':
        case 'シャッター角度':
        case 'サンプリング':
        case '画像までの距離':
        case '鏡面ハイライト':
        case 'プレビュー':
        case 'エッジをぼかす':
        case 'ズーム':
        case 'コントラスト':
        case '彩度':
        case '分割比':
        case 'ブラーの方向':
        case 'ぼかし':
          // 見た目にほぼ効かない・こちらに概念が無い。動いていても無視してよい
          break
        default:
          // アンカーポイントやアンチフリッカーなど。動きが付いていれば知らせる
          skipped.push(`${e.matchName}/${q.name}`)
      }
    }
  }
  return { motion, skipped }
}
