// テロップに打った「印」（キーフレーム）まわりの世話。
//
// ## 動きそのものは ./telopAnim
//
// あちらは「時間のどこに居るか → その瞬間の見た目」を出す計算。
// こちらは**打った印を触る側**——付いているか見る、当てる、その時刻の値を出す、
// 読み込んだ物を掃除する、印の並びを出す。
//
// ## 読み込んだ物は必ず掃除して入れる
//
// 保存ファイルや取り込んだプリセットには、こちらが知らない項目や
// 壊れた値が入っていることがある。**そのまま入れると画面が固まる**ので、
// `sanitizeMotion` を通してから使うこと。

import { valueAt, hasKeys, sanitizeKeys, keyTimesOf } from '../../../shared/keyframes'
import type { Keys } from '../../../shared/keyframes'
// 形は shared/telopMotion に置いてある（画面を持たない側からも作るため）
import type { Motion } from '../../../shared/telopMotion'
import { computeTelopAnim, hasAnim } from './telopAnim'
import type { AnimState, TelopAnim } from './telopAnim'
// **項目を足したら、この3つ全部に足すこと**（hasMotion / sanitizeMotion / motionKeyTimes）。
// hasMotion に足し忘れると「動きが無い」と判定され、その動きは
// **一覧にすら出なくなる**。実際、波だけで動く2件（後ろユラユラ）がこれで消えた。
export const hasMotion = (m?: Motion): boolean =>
  !!m &&
  (
    [m.tx, m.ty, m.sc, m.rot, m.op, m.scx, m.scy, m.skew,
     m.roty, m.rotx, m.bright, m.blur, m.hue, m.inv, m.blind,
     m.cl, m.ct, m.cr, m.cb, m.wavH, m.wavW, m.wavDir,
     m.mbLen, m.mbDir, m.tbAmt, m.tbSeed, m.tbOffX, m.tbOffY] as (Keys | undefined)[]
  ).some(hasKeys)

/** 出入りのアニメの上に、自分で打った動きを重ねる */
export function applyMotion(st: AnimState, m: Motion | undefined, animT: number): AnimState {
  if (!hasMotion(m)) return st
  return {
    tx: st.tx + valueAt(m!.tx, animT, 0),
    ty: st.ty + valueAt(m!.ty, animT, 0),
    sc: st.sc * valueAt(m!.sc, animT, 1),
    rot: st.rot + valueAt(m!.rot, animT, 0),
    opacity: st.opacity * valueAt(m!.op, animT, 1),
    scx: st.scx * valueAt(m!.scx, animT, 1),
    scy: st.scy * valueAt(m!.scy, animT, 1),
    skew: st.skew + valueAt(m!.skew, animT, 0),
    roty: st.roty + valueAt(m!.roty, animT, 0),
    rotx: st.rotx + valueAt(m!.rotx, animT, 0),
    bright: st.bright * valueAt(m!.bright, animT, 1),
    blur: st.blur + valueAt(m!.blur, animT, 0),
    hue: st.hue + valueAt(m!.hue, animT, 0),
    inv: st.inv + valueAt(m!.inv, animT, 0),
    blind: st.blind + valueAt(m!.blind, animT, 0),
    // 幅と向きは動かない設定値。付いていなければ元のまま
    blindW: m!.blindW ?? st.blindW,
    blindDir: m!.blindDir ?? st.blindDir,
    crop: {
      l: st.crop.l + valueAt(m!.cl, animT, 0),
      t: st.crop.t + valueAt(m!.ct, animT, 0),
      r: st.crop.r + valueAt(m!.cr, animT, 0),
      b: st.crop.b + valueAt(m!.cb, animT, 0)
    },
    // 波形ワープ。高さ 0 なら波なし（既定）。
    // 速度は動かない設定値で、**位相を時刻ぶん進める**のに使う
    // （1秒あたり何周するか。0 なら止まったまま、正ならユラユラ流れ続ける）。
    wavH: st.wavH + valueAt(m!.wavH, animT, 0),
    wavW: valueAt(m!.wavW, animT, st.wavW),
    wavDir: st.wavDir + valueAt(m!.wavDir, animT, 0),
    wavPh: st.wavPh + (m!.wavSpd ?? 0) * animT * 360,
    // ブラー（方向）。長さ 0 なら効果なし（既定）
    mbLen: st.mbLen + valueAt(m!.mbLen, animT, 0),
    mbDir: st.mbDir + valueAt(m!.mbDir, animT, 0),
    // タービュレント。量 0 なら効果なし（既定）。
    // 粗さと段数は動かない設定値なので、付いていなければ元のまま
    tbAmt: st.tbAmt + valueAt(m!.tbAmt, animT, 0),
    tbSize: m!.tbSize ?? st.tbSize,
    tbOct: m!.tbOct ?? st.tbOct,
    tbSeed: st.tbSeed + valueAt(m!.tbSeed, animT, 0),
    tbOffX: st.tbOffX + valueAt(m!.tbOffX, animT, 0),
    tbOffY: st.tbOffY + valueAt(m!.tbOffY, animT, 0)
  }
}

/** その瞬間の見た目（出入りのアニメ＋自分で打った動き）。プレビューも書き出しもこれを使う */
export function telopStateAt(
  anim: TelopAnim | undefined,
  motion: Motion | undefined,
  animT: number,
  clipDur: number
): AnimState | undefined {
  if (!hasAnim(anim) && !hasMotion(motion)) return undefined
  return applyMotion(computeTelopAnim(anim, animT, clipDur), motion, animT)
}

/** 保存ファイルから読み直すときの検査（壊れていたら「動き無し」に落とす） */
export function sanitizeMotion(v: unknown): Motion | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const m: Motion = {
    tx: sanitizeKeys(o.tx),
    ty: sanitizeKeys(o.ty),
    sc: sanitizeKeys(o.sc),
    rot: sanitizeKeys(o.rot),
    op: sanitizeKeys(o.op),
    scx: sanitizeKeys(o.scx),
    scy: sanitizeKeys(o.scy),
    skew: sanitizeKeys(o.skew),
    roty: sanitizeKeys(o.roty),
    rotx: sanitizeKeys(o.rotx),
    bright: sanitizeKeys(o.bright),
    blur: sanitizeKeys(o.blur),
    hue: sanitizeKeys(o.hue),
    inv: sanitizeKeys(o.inv),
    blind: sanitizeKeys(o.blind),
    // 動かない設定値。数でなければ付けない（付けないと既定に落ちるだけで、落ちはしない）
    ...(typeof o.blindW === 'number' && Number.isFinite(o.blindW) ? { blindW: o.blindW } : null),
    ...(typeof o.blindDir === 'number' && Number.isFinite(o.blindDir) ? { blindDir: o.blindDir } : null),
    cl: sanitizeKeys(o.cl),
    ct: sanitizeKeys(o.ct),
    cr: sanitizeKeys(o.cr),
    cb: sanitizeKeys(o.cb),
    wavH: sanitizeKeys(o.wavH),
    wavW: sanitizeKeys(o.wavW),
    wavDir: sanitizeKeys(o.wavDir),
    ...(typeof o.wavSpd === 'number' && Number.isFinite(o.wavSpd) ? { wavSpd: o.wavSpd } : null),
    mbLen: sanitizeKeys(o.mbLen),
    mbDir: sanitizeKeys(o.mbDir),
    tbAmt: sanitizeKeys(o.tbAmt),
    tbSeed: sanitizeKeys(o.tbSeed),
    tbOffX: sanitizeKeys(o.tbOffX),
    tbOffY: sanitizeKeys(o.tbOffY),
    ...(typeof o.tbSize === 'number' && Number.isFinite(o.tbSize) ? { tbSize: o.tbSize } : null),
    ...(typeof o.tbOct === 'number' && Number.isFinite(o.tbOct) ? { tbOct: o.tbOct } : null)
  }
  return hasMotion(m) ? m : undefined
}

/** そのテロップに打たれている印の時刻（クリップ先頭からの秒） */
export function motionKeyTimes(m?: Motion): number[] {
  return m
    ? keyTimesOf(
        m.tx, m.ty, m.sc, m.rot, m.op, m.scx, m.skew,
        m.roty, m.rotx, m.bright, m.blur, m.cl, m.ct, m.cr, m.cb,
        m.wavH, m.wavW, m.wavDir, m.mbLen, m.mbDir,
        m.tbAmt, m.tbSeed, m.tbOffX, m.tbOffY
      )
    : []
}

