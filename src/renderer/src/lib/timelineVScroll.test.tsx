// @vitest-environment jsdom
// タイムラインを縦に送ったときの追従。
//
// 前に「スクロールだけ足して、ついていく側を作らなかった」せいで、
// 見出しと行がずれて掴めなくなる壊し方をしている。
// **ついていく側が確かに動くこと**をここで固定する。

import { describe, expect, it } from 'vitest'
import { applyTimelineVScroll, centeredScrollTop, TL_SCROLL_VAR } from './timelineVScroll'

function targets(): {
  headers: HTMLElement
  inner: HTMLElement
} {
  return {
    headers: document.createElement('div'),
    inner: document.createElement('div')
  }
}

describe('タイムラインの縦スクロール追従', () => {
  it('段見出しが、送った量だけ上へ動く', () => {
    const t = targets()
    applyTimelineVScroll(120, t)
    expect(t.headers.style.transform).toBe('translateY(-120px)')
  })

  it('目盛りに貼り付く物へ、送った量をそのまま渡す', () => {
    const t = targets()
    applyTimelineVScroll(80, t)
    expect(t.inner.style.getPropertyValue(TL_SCROLL_VAR)).toBe('80px')
  })

  it('先頭まで戻したら、ずれも変数も消える', () => {
    const t = targets()
    applyTimelineVScroll(200, t)
    applyTimelineVScroll(0, t)
    expect(t.headers.style.transform).toBe('translateY(0px)')
    expect(t.inner.style.getPropertyValue(TL_SCROLL_VAR)).toBe('0px')
  })

  it('行き過ぎ（負）や壊れた値が来ても 0 に丸める', () => {
    const t = targets()
    // macOS 風の弾むスクロールでは負が来ることがある。そのまま渡すと
    // 見出しだけ下へ飛び出して、行と食い違って見える。
    expect(applyTimelineVScroll(-40, t)).toBe(0)
    expect(t.headers.style.transform).toBe('translateY(0px)')
    expect(applyTimelineVScroll(Number.NaN, t)).toBe(0)
    expect(t.inner.style.getPropertyValue(TL_SCROLL_VAR)).toBe('0px')
  })

  it('相手が居なくても落ちない（別ウィンドウへ出している最中など）', () => {
    expect(() => applyTimelineVScroll(50, {})).not.toThrow()
    expect(() => applyTimelineVScroll(50, { headers: null, inner: null })).not.toThrow()
  })
})

describe('境目を動かしたときの伸び縮み（映像と音声の境目を残す）', () => {
  it('縮めると、上と下が均等に減る＝境目が真ん中に来る', () => {
    // 中身400 / 見えている200 → 送れる限界200。境目が180なら 180-100=80
    expect(centeredScrollTop(180, 200, 200)).toBe(80)
    // さらに縮めて 見えている120 → 180-60=120
    expect(centeredScrollTop(180, 120, 280)).toBe(120)
  })

  it('広げて全部入るなら、先頭へ戻す（下に空きを作らない）', () => {
    expect(centeredScrollTop(180, 400, 0)).toBe(0)
    expect(centeredScrollTop(180, 400, -20)).toBe(0)
  })

  it('境目が上すぎる／下すぎるときは、行き過ぎずに端で止まる', () => {
    // 映像が1段しかない＝境目が上の方。真ん中に置こうとすると負になる
    expect(centeredScrollTop(40, 200, 200)).toBe(0)
    // 音声が1段しかない＝境目が下の方。限界を超えて空白を出さない
    expect(centeredScrollTop(380, 200, 200)).toBe(200)
  })

  it('測れなかった（NaN）ときは動かさない', () => {
    expect(centeredScrollTop(Number.NaN, 200, 200)).toBe(0)
  })
})
