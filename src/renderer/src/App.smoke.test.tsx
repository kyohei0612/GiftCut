// @vitest-environment jsdom
// ============================================================================
// 起動スモークテスト
//
// なぜ必要か:
//   型チェックもロジックのテストも全部通っているのに、アプリが起動すらしない
//   ということが実際に起きた。原因は useState の初期化関数の中で、まだ定義
//   されていない関数を呼んでいたこと:
//
//     const [snap] = useState(() => loadLS('giftcut.snap', true))  // 538行目
//     const loadLS = ...                                            // 1818行目
//
//   関数に包まれているので TypeScript は「あとで呼ばれるのだろう」と判断して
//   通してしまうが、React は描画時に即座に呼ぶので画面全体が落ちる。
//
//   ここでは実際に App を描画して、例外が出たら落ちるようにする。
//   「アプリが起動するか」という一番基本的なことを機械で確かめるのが目的。
// ============================================================================
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from './App'

// 本物の Electron API は無いので、呼ばれても落ちない最小限の代役を置く。
// 描画中に参照されるものだけあればよい（useEffect はここでは走らない）。
function stubGiftcutApi(): void {
  const noop = (): void => {}
  const off = (): (() => void) => noop
  const api = {
    importSrt: async () => null,
    openVideo: async () => null,
    addMedia: async () => null,
    addFolder: async () => null,
    listSE: async () => ({ ok: true, items: [] }),
    listTelopPresets: async () => ({ ok: true, items: [] }),
    getDuration: async () => ({ ok: false }),
    getFps: async () => ({ ok: false }),
    generateWaveform: async () => ({ ok: false }),
    generateThumbnail: async () => ({ ok: false }),
    generateProxy: async () => ({ ok: false }),
    onProxyProgress: off,
    exportVideo: async () => ({ ok: false }),
    cancelExport: async () => ({ ok: true }),
    onExportProgress: off,
    saveProject: async () => ({ ok: false }),
    saveImage: async () => ({ ok: false }),
    openProject: async () => null,
    listTemplates: async () => ({ ok: true, items: [] }),
    saveTemplate: async () => ({ ok: false }),
    loadTemplate: async () => ({ ok: false }),
    openTemplateDialog: async () => null,
    exportSrt: async () => ({ ok: false }),
    autosaveProject: async () => ({ ok: true }),
    autosaveCheck: async () => ({ exists: false }),
    autosaveClear: async () => ({ ok: true }),
    setDirty: noop
  }
  ;(window as unknown as { giftcut: unknown }).giftcut = api
}

beforeAll(() => {
  stubGiftcutApi()
  // jsdom に無い API の代役（描画中に触られても落ちないように）
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {}
      })
    })
  }
  if (!globalThis.ResizeObserver) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  }
  // canvas は jsdom では未実装。波形/サムネの描画で呼ばれても落ちないようにする。
  if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never
  }
})

describe('起動スモークテスト', () => {
  it('App が例外を投げずに描画できる（初期化順の誤りをここで検出する）', () => {
    expect(() => renderToString(<App />)).not.toThrow()
  })

  it('描画結果が空でない（何も出ない状態を「成功」と誤判定しない）', () => {
    const html = renderToString(<App />)
    expect(html.length).toBeGreaterThan(100)
  })

  it('保存済みのアプリ設定が壊れていても起動できる', () => {
    // localStorage に想定外の値が入っていても落ちてはいけない
    localStorage.setItem('giftcut.snap', '{壊れたJSON')
    localStorage.setItem('giftcut.previewRes', 'ありえない値')
    localStorage.setItem('giftcut.session', 'not json')
    expect(() => renderToString(<App />)).not.toThrow()
    localStorage.clear()
  })
})

// ===========================================================================
// 実際にマウントして、起動後に走る処理（useEffect）まで確かめる。
// 描画だけの検証では「描画は通るが起動直後の処理で落ちる」型のバグを見逃す。
// ===========================================================================
describe('マウントと後片付け', () => {
  /** App を本物どおりマウントする。effect も走る。 */
  async function mountApp(): Promise<{ unmount: () => Promise<void>; errors: unknown[] }> {
    const errors: unknown[] = []
    // React は effect 内の例外を console.error にも出すので拾っておく
    const origError = console.error
    console.error = (...args: unknown[]): void => {
      errors.push(args[0])
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<App />)
    })
    return {
      errors,
      unmount: async () => {
        await act(async () => {
          root.unmount()
        })
        container.remove()
        console.error = origError
      }
    }
  }

  afterEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
  })

  it('マウントできる（起動直後の処理で落ちない）', async () => {
    const app = await mountApp()
    // React が拾った例外（レンダー/effect 由来）が無いこと
    const real = app.errors.filter(
      (e) => e instanceof Error || (typeof e === 'string' && /Error|Warning: Failed/.test(e))
    )
    expect(real, `起動直後にエラーが出た: ${String(real[0])}`).toEqual([])
    await app.unmount()
  })

  it('アンマウントで後片付けができる（タイマー・購読の解除漏れを検出）', async () => {
    // setInterval / addEventListener の解除漏れがあると、ここで残数が増える。
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval')

    const app = await mountApp()
    await app.unmount()

    // window に張った購読は、同じ種類の数だけ外れているはず
    const added = addSpy.mock.calls.map((c) => c[0])
    const removed = removeSpy.mock.calls.map((c) => c[0])
    const leaked = added.filter((t) => !removed.includes(t))
    expect(leaked, `解除されていない window の購読: ${leaked.join(', ')}`).toEqual([])

    // 貼ったインターバルは全部止まっているはず
    expect(
      clearIntervalSpy.mock.calls.length,
      '止めていない setInterval がある'
    ).toBeGreaterThanOrEqual(setIntervalSpy.mock.calls.length)

    addSpy.mockRestore()
    removeSpy.mockRestore()
    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })

  it('マウントとアンマウントを繰り返しても壊れない', async () => {
    for (let i = 0; i < 3; i++) {
      const app = await mountApp()
      await app.unmount()
    }
    expect(true).toBe(true)
  })
})
