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
import { renderToString } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'
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
