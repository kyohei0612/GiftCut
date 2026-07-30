// 最初から入っている動きの決まりごと。
//
// 一番大事なのは**必ず元の姿に戻して終わること**。戻し忘れると、演出が終わった
// あともテロップがズレたまま座り続ける。目で見て気づきにくく（動いてはいるので）、
// しかも20種あると1つずつ確かめる気が失せるので、機械で見る。

import { describe, expect, it } from 'vitest'
import { BUILTIN_MOTIONS } from './builtinMotions'
import { valueAt } from './keyframes'
import type { Keys } from './keyframes'

/** その動きの長さ（一番遅い印の時刻） */
const durOf = (m: Record<string, unknown>): number => {
  let d = 0
  for (const v of Object.values(m)) {
    if (!Array.isArray(v)) continue
    for (const key of v as Keys) if (key.t > d) d = key.t
  }
  return d
}

describe('最初から入っている動き', () => {
  it('20種そろっている', () => {
    expect(BUILTIN_MOTIONS.length).toBe(20)
  })

  it('名前が重ならない（一覧で見分けが付かなくなる）', () => {
    const names = BUILTIN_MOTIONS.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('名前に元のプリセット集の呼び名を使っていない', () => {
    // こちらで打った物なので、向こうの名前を借りる理由が無い。
    // 借りると「写した物」に見えるうえ、名前だけ似せる意味も無い
    for (const p of BUILTIN_MOTIONS) {
      expect(p.name).not.toMatch(/SLIDE|SPLIT|ASPECT|ビョヨン|メビウス|タイプライター/)
    }
  })

  it('全部に動きが入っている（押しても何も起きない物を並べない）', () => {
    for (const p of BUILTIN_MOTIONS) {
      expect(Object.keys(p.motion).length, p.name).toBeGreaterThan(0)
      expect(durOf(p.motion as Record<string, unknown>), p.name).toBeGreaterThan(0)
    }
  })

  it('**必ず元の姿に戻って終わる**', () => {
    // ここが本題。終わりの時刻で、動かす前と同じ値になっていること
    const rest: Record<string, number> = {
      tx: 0, ty: 0, rot: 0, roty: 0, rotx: 0, skew: 0,
      sc: 1, scx: 1, scy: 1, op: 1,
      blur: 0, bright: 1, hue: 0, inv: 0, blind: 0,
      cl: 0, ct: 0, cr: 0, cb: 0,
      wavH: 0, mbLen: 0, tbAmt: 0
    }
    for (const p of BUILTIN_MOTIONS) {
      const end = durOf(p.motion as Record<string, unknown>)
      for (const [ch, want] of Object.entries(rest)) {
        const keys = (p.motion as Record<string, unknown>)[ch]
        if (!Array.isArray(keys)) continue
        expect(valueAt(keys as Keys, end, want), `${p.name} の ${ch}`).toBeCloseTo(want, 4)
      }
    }
  })

  it('長さが 0.3〜1.0 秒に収まっている（長いと編集の邪魔になる）', () => {
    for (const p of BUILTIN_MOTIONS) {
      const d = durOf(p.motion as Record<string, unknown>)
      expect(d, p.name).toBeGreaterThanOrEqual(0.3)
      expect(d, p.name).toBeLessThanOrEqual(1.0)
    }
  })

  it('途中で必ず動く（始めと終わりが同じだけの物を並べない）', () => {
    for (const p of BUILTIN_MOTIONS) {
      const end = durOf(p.motion as Record<string, unknown>)
      let moved = false
      for (const v of Object.values(p.motion)) {
        if (!Array.isArray(v)) continue
        const keys = v as Keys
        const first = keys[0].v
        for (const key of keys) if (Math.abs(key.v - first) > 1e-6) moved = true
      }
      expect(moved, `${p.name}（長さ ${end}s）`).toBe(true)
    }
  })

  it('取り込んだ物のような「一部だけ」印を持たない（標準は全部そのまま使える）', () => {
    for (const p of BUILTIN_MOTIONS) {
      expect(p.partial ?? [], p.name).toEqual([])
      expect(p.endsHidden ?? false, p.name).toBe(false)
    }
  })
})
