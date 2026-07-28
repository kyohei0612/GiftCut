// @vitest-environment jsdom
import React, { act } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { PaneHost } from './PanelChrome'

/**
 * 別ウィンドウで開く部分の確認。
 *
 * ここで見たいのは**開発モードの2回走り**。React は開発中、部品を置いた直後に
 * わざと1回片付けて置き直す（後片付けが正しいかを試すため）。
 * 「置いたら開く・片付けたら閉じる」と素直に書くと、
 * **押した瞬間に窓が消える**。実際にそうなっていた。
 *
 * 製品ビルドでは2回走らないので、実物を動かす確認（e2e）では見つからない。
 * ここで見るしかない。
 */

type FakeWin = {
  closed: boolean
  document: Document
  close: () => void
  addEventListener: () => void
  removeEventListener: () => void
}

let opened: FakeWin[] = []
let container: HTMLDivElement
let root: Root

function makeFakeWindow(): FakeWin {
  const doc = document.implementation.createHTMLDocument('別ウィンドウ')
  const w: FakeWin = {
    closed: false,
    document: doc,
    close: () => {
      w.closed = true
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  }
  return w
}

beforeEach(() => {
  opened = []
  vi.stubGlobal(
    'open',
    vi.fn(() => {
      const w = makeFakeWindow()
      opened.push(w)
      return w as unknown as Window
    })
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('パネルを別ウィンドウで開く', () => {
  it('開発モードの2回走りでも、窓が閉じられたままにならない', async () => {
    const onClose = vi.fn()
    act(() => {
      root.render(
        <React.StrictMode>
          <PaneHost id="right" title="プロジェクト" popped onClose={onClose}>
            <div className="panel">中身</div>
          </PaneHost>
        </React.StrictMode>
      )
    })
    // 片付けを遅らせているので、その時間を進める
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })
    const alive = opened.filter((w) => !w.closed)
    expect(alive.length, `開いたまま残っている窓が1つであること（開いた: ${opened.length}）`).toBe(
      1
    )
    // 「窓が閉じられた＝本体へ戻す」が呼ばれていないこと
    expect(onClose).not.toHaveBeenCalled()
    // 中身が別ウィンドウ側へ入っていること
    expect(alive[0].document.querySelector('.pane-pop-root .panel')?.textContent).toBe('中身')
  })

  it('本当に片付けたときは、窓を閉じる', async () => {
    const onClose = vi.fn()
    act(() => {
      root.render(
        <React.StrictMode>
          <PaneHost id="left" title="プロパティ" popped onClose={onClose}>
            <div className="panel">中身</div>
          </PaneHost>
        </React.StrictMode>
      )
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })
    expect(opened.filter((w) => !w.closed).length).toBe(1)
    // 本体へ戻した（＝出さない状態にした）
    act(() => {
      root.render(
        <React.StrictMode>
          <PaneHost id="left" title="プロパティ" popped={false} onClose={onClose}>
            <div className="panel">中身</div>
          </PaneHost>
        </React.StrictMode>
      )
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })
    expect(opened.every((w) => w.closed), '戻したのに窓が残っている').toBe(true)
  })
})
