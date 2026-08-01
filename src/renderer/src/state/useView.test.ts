import { describe, expect, it } from 'vitest'
import { DEFAULT_ZOOM, ZOOM_MAX, ZOOM_MIN, clampZoom } from './useView'

describe('タイムラインの拡大率', () => {
  it('範囲の中はそのまま通す', () => {
    expect(clampZoom(24)).toBe(24)
    expect(clampZoom(200)).toBe(200)
  })

  it('寄りすぎ・引きすぎは限界で止める', () => {
    expect(clampZoom(9999)).toBe(ZOOM_MAX)
    expect(clampZoom(0.5)).toBe(ZOOM_MIN)
  })

  it('**壊れた値は既定へ戻す**（0 や NaN だと中身が全部消える）', () => {
    // 秒×拡大率で位置を出しているので、0 や NaN が入ると
    // クリップも目盛りも位置が 0／NaN になって画面から消える
    expect(clampZoom(0)).toBe(ZOOM_MIN)
    expect(clampZoom(NaN)).toBe(DEFAULT_ZOOM)
    expect(clampZoom(Infinity)).toBe(DEFAULT_ZOOM)
    expect(clampZoom('24')).toBe(DEFAULT_ZOOM)
    expect(clampZoom(null)).toBe(DEFAULT_ZOOM)
    expect(clampZoom(undefined)).toBe(DEFAULT_ZOOM)
  })

  it('既定は範囲の中にある（設定の取り違え避け）', () => {
    expect(ZOOM_MIN).toBeLessThan(ZOOM_MAX)
    expect(DEFAULT_ZOOM).toBeGreaterThanOrEqual(ZOOM_MIN)
    expect(DEFAULT_ZOOM).toBeLessThanOrEqual(ZOOM_MAX)
  })
})
