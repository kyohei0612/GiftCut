// 引いたときの当たり判定（時刻 → どの帯か）。
//
// **ここを機械で押さえる理由。** 引いた状態（3px/秒 未満）は e2e の確認用素材
// （20秒）では作れない——20秒だと全体表示でも 57px/秒 あるので、
// **画面越しの確認は一度もこの道を通らない**。通らない道は壊れても気づけない。
//
// 壊れると「押したのに違うテロップが選ばれる」「押しても何も選ばれない」になる。
// どちらも**操作の手応えが無いだけ**で例外は出ないので、目でも気づきにくい。

import { describe, expect, it } from 'vitest'
import { pickBandAt, type SummaryBand } from './TrackSummary'

const b = (id: number, start: number, end: number): SummaryBand => ({ id, start, end })

describe('引いたときの当たり判定', () => {
  const bands = [b(1, 0, 2), b(2, 5, 6), b(3, 10, 10.5)]

  it('中を押せばその帯', () => {
    expect(pickBandAt(bands, 1)).toBe(1)
    expect(pickBandAt(bands, 5.5)).toBe(2)
  })

  it('**0.5秒しかない帯でも当たる**（1px でも選べるのがこの作りの狙い）', () => {
    expect(pickBandAt(bands, 10.2)).toBe(3)
  })

  it('隙間を押したら null（選択を外すのは呼ぶ側の判断）', () => {
    expect(pickBandAt(bands, 3)).toBeNull()
    expect(pickBandAt(bands, 100)).toBeNull()
    expect(pickBandAt(bands, -1)).toBeNull()
  })

  it('**始まりは含み、終わりは含まない**（隣どうしが重ならない）', () => {
    // 半開区間にしないと、隣り合った帯の境目で2つとも当たる。
    // 書き出しの窓（shared/filterGraph の overlayEnableExpr）と同じ流儀
    const two = [b(1, 0, 2), b(2, 2, 4)]
    expect(pickBandAt(two, 0)).toBe(1)
    expect(pickBandAt(two, 2)).toBe(2)
    expect(pickBandAt(two, 4)).toBeNull()
  })

  it('**重なっていたら、後に描いた方（目に見えている方）**', () => {
    // 押した物と違う物が選ばれるのが一番たちが悪い。
    // 絵は前から順に描くので、後の物が上に乗って見えている
    const over = [b(1, 0, 10), b(2, 4, 6)]
    expect(pickBandAt(over, 5)).toBe(2)
    expect(pickBandAt(over, 1)).toBe(1)
  })

  it('1本も無ければ null（読み込み前でも落ちない）', () => {
    expect(pickBandAt([], 1)).toBeNull()
  })
})
