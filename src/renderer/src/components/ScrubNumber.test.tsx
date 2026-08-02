// @vitest-environment jsdom
// 押して振ると増減する数値欄。
//
// 見た目では気づけない所が2つある。
//   ・**刻みより細かい桁で丸めていないか**（0.01刻みを小数2桁で潰すと調整できない）
//   ・触っただけで値が動いていないか（打ち込みができなくなる）

import { describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ScrubNumber } from './ScrubNumber'

/** 画面に置いて、入力欄を返す */
function mount(props: Parameters<typeof ScrubNumber>[0]): HTMLInputElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  act(() => {
    createRoot(host).render(<ScrubNumber {...props} />)
  })
  return host.querySelector('input') as HTMLInputElement
}

/** 押して、指定 px ぶん横に振って、離す */
function scrub(input: HTMLInputElement, dx: number): void {
  act(() => {
    input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
  })
  act(() => {
    const ev = new PointerEvent('pointermove', { bubbles: true })
    Object.defineProperty(ev, 'movementX', { value: dx })
    window.dispatchEvent(ev)
  })
  act(() => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  })
}

/** ポインタのロックが効く環境のふりをする（戻す関数を返す） */
function withPointerLock(input: HTMLInputElement): () => void {
  // jsdom には requestPointerLock が無いので、生やして「効いた」ことにする
  const el = input as unknown as Record<string, unknown>
  const had = el.requestPointerLock
  el.requestPointerLock = (): void => {
    Object.defineProperty(document, 'pointerLockElement', { value: input, configurable: true })
  }
  return () => {
    if (had === undefined) delete el.requestPointerLock
    else el.requestPointerLock = had
    Object.defineProperty(document, 'pointerLockElement', { value: null, configurable: true })
  }
}

describe('押して振ると増減する数値欄', () => {
  // **ロックが効いた最初の1回は捨てる。**
  // その1回だけ「元のカーソル位置から画面中央まで」の距離がまとめて届くことがあり、
  // 押した瞬間に値が飛ぶ（「触った瞬間に数字が飛ぶ」の正体）。
  it('ポインタをロックした直後の飛びで、値が動かない', () => {
    const onChange = vi.fn()
    const input = mount({ value: 10, onChange, step: 1 })
    const restore = withPointerLock(input)
    try {
      act(() => {
        input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
      })
      const move = (dx: number): void => {
        act(() => {
          const ev = new PointerEvent('pointermove', { bubbles: true })
          Object.defineProperty(ev, 'movementX', { value: dx })
          window.dispatchEvent(ev)
        })
      }
      move(6) // ここでしきい値を超えてロックを頼む
      const afterStart = onChange.mock.lastCall?.[0]
      move(700) // ロックが効いた直後の「飛び」。**これで値が動いてはいけない**
      expect(onChange.mock.lastCall?.[0]).toBe(afterStart)
      act(() => {
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      })
    } finally {
      restore()
    }
  })

  it('飛びを捨てたあとは、続きの動きでちゃんと増える', () => {
    const onChange = vi.fn()
    const input = mount({ value: 10, onChange, step: 1 })
    const restore = withPointerLock(input)
    try {
      act(() => {
        input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
      })
      const move = (dx: number): void => {
        act(() => {
          const ev = new PointerEvent('pointermove', { bubbles: true })
          Object.defineProperty(ev, 'movementX', { value: dx })
          window.dispatchEvent(ev)
        })
      }
      move(6)
      const afterStart = onChange.mock.lastCall?.[0] as number
      move(700) // 捨てられる
      move(30) // 本物の動き（3px で1ステップ＝10ふえる）
      expect(onChange.mock.lastCall?.[0]).toBeGreaterThan(afterStart)
      act(() => {
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      })
    } finally {
      restore()
    }
  })

  it('右へ振ると増える', () => {
    const onChange = vi.fn()
    const input = mount({ value: 10, onChange, step: 1 })
    scrub(input, 30) // 3px で1ステップ＝10ふえる
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.lastCall?.[0]).toBeGreaterThan(10)
  })

  it('左へ振ると減る', () => {
    const onChange = vi.fn()
    const input = mount({ value: 10, onChange, step: 1 })
    scrub(input, -30)
    expect(onChange.mock.lastCall?.[0]).toBeLessThan(10)
  })

  it('少し触ったくらいでは動かない（打ち込みを邪魔しない）', () => {
    const onChange = vi.fn()
    const input = mount({ value: 10, onChange, step: 1 })
    scrub(input, 3) // 4px 未満はクリック扱い
    expect(onChange).not.toHaveBeenCalled()
  })

  it('**刻みが細かい物は、その桁まで残す**', () => {
    // 拡大率のような 0.01 刻みを小数2桁で固定して丸めると、
    // それ以上細かくできない。刻みから桁数を決める
    const onChange = vi.fn()
    const input = mount({ value: 1, onChange, step: 0.01 })
    scrub(input, 15) // 5ステップ＝+0.05
    expect(onChange.mock.lastCall?.[0]).toBeCloseTo(1.05, 5)
  })

  it('上限・下限を越えない', () => {
    const onChange = vi.fn()
    const input = mount({ value: 95, onChange, step: 1, min: 0, max: 100 })
    scrub(input, 300)
    expect(onChange.mock.lastCall?.[0]).toBe(100)
  })

  it('触れない状態では、振っても動かない', () => {
    const onChange = vi.fn()
    const input = mount({ value: 10, onChange, step: 1, disabled: true })
    scrub(input, 60)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('打ち込みでも上限・下限に収まる', () => {
    const onChange = vi.fn()
    const input = mount({ value: 10, onChange, step: 1, min: 0, max: 50 })
    act(() => {
      // React は value を直に書いても気づかない。**元の setter を通す**
      // （ここを知らないと「打ち込みが効かない」と誤診する）
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      setter?.call(input, '999')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onChange.mock.lastCall?.[0]).toBe(50)
  })
})
