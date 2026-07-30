// @vitest-environment jsdom
// ============================================================================
// 動作確認のうち、機械で判定できるものをテストにしたもの
//
// 以前は「手で確かめる検査票」を別に持っていたが、目で見る確認も耳で聴く確認も
// e2e（npm run e2e）が画面を撮って測るようになったので廃止した。
// **手で潰す表と機械で回す表が2つあると、必ず片方が古くなる。**
//
// ここで見ているのは主に次の3つ:
//   1. OS 標準のダイアログ（window.confirm / alert / prompt）を使っていないこと
//   2. 「最近使ったプロジェクト」がファイルメニューから開けること
//   3. 起動時に画面の主要部品がちゃんと出ていること
// ============================================================================
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

/** 本物の Electron API の代役。呼ばれた内容を records に残して後から確認する。 */
const calls: { openProject: (string | undefined)[]; confirmClose: number } = {
  openProject: [],
  confirmClose: 0
}
let closeRequestHandler: (() => void) | null = null

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
    getDuration: async () => ({ ok: true, duration: 30 }),
    getFps: async () => ({ ok: true, fps: 30 }),
    generateWaveform: async () => ({ ok: false }),
    generateThumbnail: async () => ({ ok: false }),
    generateProxy: async () => ({ ok: false }),
    onProxyProgress: off,
    exportVideo: async () => ({ ok: false }),
    cancelExport: async () => ({ ok: true }),
    onExportProgress: off,
    saveProject: async () => ({ ok: false }),
    saveImage: async () => ({ ok: false }),
    openProject: async (path?: string) => {
      calls.openProject.push(path)
      return null // ダイアログを閉じた扱い（状態を壊さない）
    },
    listTemplates: async () => ({ ok: true, items: [] }),
    saveTemplate: async () => ({ ok: false }),
    loadTemplate: async () => ({ ok: false }),
    openTemplateDialog: async () => null,
    exportSrt: async () => ({ ok: false }),
    autosaveProject: async () => ({ ok: true }),
    autosaveCheck: async () => ({ exists: false }),
    autosaveClear: async () => ({ ok: true }),
    setDirty: noop,
    onCloseRequest: (fn: () => void) => {
      closeRequestHandler = fn
      return () => {
        closeRequestHandler = null
      }
    },
    confirmClose: () => {
      calls.confirmClose++
    }
  }
  ;(window as unknown as { giftcut: unknown }).giftcut = api
}

beforeAll(() => {
  // act() を使うテスト環境だと React に伝える（伝えないと警告が大量に出て、
  // 本物の警告が埋もれる）
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  stubGiftcutApi()
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
  if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never
  }
})

let root: Root | null = null
let container: HTMLDivElement | null = null

async function mountApp(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<App />)
  })
}
async function unmountApp(): Promise<void> {
  if (root) {
    await act(async () => root!.unmount())
    root = null
  }
  container?.remove()
  container = null
}

/** 画面に出ている文字から要素を探す（クリックできるものだけ） */
function findByText(text: string, sel = 'button, .menu-drop-item, .ctx-item'): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>(sel)).find((el) =>
      (el.textContent ?? '').includes(text)
    ) ?? null
  )
}
async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

beforeEach(() => {
  calls.openProject = []
  calls.confirmClose = 0
  closeRequestHandler = null
})
afterEach(async () => {
  await unmountApp()
  localStorage.clear()
  document.body.innerHTML = ''
})

// ===========================================================================
describe('OS標準のダイアログを使っていない', () => {
  it('起動から一通り触るまで window.confirm / alert / prompt が一度も呼ばれない', async () => {
    // OS のダイアログはアプリと見た目が揃わないうえ、window.confirm は
    // レンダラを丸ごと止めるので再生や書き出しの進行まで巻き添えになる。
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('')

    await mountApp()
    // ファイルメニューを開いて「プロジェクトを開く」まで進む
    const fileMenu = Array.from(document.querySelectorAll<HTMLElement>('.menu-item')).find((el) =>
      (el.textContent ?? '').includes('ファイル')
    )
    expect(fileMenu, 'ファイルメニューが見つからない').not.toBeNull()
    await click(fileMenu!)
    const openBtn = findByText('プロジェクトを開く')
    expect(openBtn, '「プロジェクトを開く」が見つからない').not.toBeNull()
    await click(openBtn!)

    expect(confirmSpy, 'window.confirm が使われている').not.toHaveBeenCalled()
    expect(alertSpy, 'window.alert が使われている').not.toHaveBeenCalled()
    expect(promptSpy, 'window.prompt が使われている').not.toHaveBeenCalled()

    confirmSpy.mockRestore()
    alertSpy.mockRestore()
    promptSpy.mockRestore()
  })

  it('ソースコードに window.confirm / alert / prompt が残っていない', async () => {
    // 上のテストは「今回通った経路」しか見られないので、静的にも確かめる。
    const src = await import('./App?raw').then((m) => m.default as string)
    const hits = src.match(/window\.(confirm|alert|prompt)\s*\(/g) ?? []
    expect(hits, `OS標準ダイアログが残っている: ${hits.join(', ')}`).toEqual([])
  })
})

// ===========================================================================
describe('ウィンドウを閉じるときの確認', () => {
  it('閉じる要求はメインに聞き返さず、アプリ内のモーダルで受ける', async () => {
    await mountApp()
    expect(closeRequestHandler, '閉じる要求を受け取る口が用意されていない').not.toBeNull()
    await act(async () => closeRequestHandler!())
    // 確認モーダルが出ていること（この時点ではまだ閉じない）
    const box = document.querySelector('.modal-box')
    expect(box, '確認モーダルが出ていない').not.toBeNull()
    expect(box!.textContent).toContain('保存していない変更があります')
    expect(calls.confirmClose, '確認前に閉じてしまっている').toBe(0)
  })

  it('「閉じない」を選ぶと閉じない', async () => {
    await mountApp()
    await act(async () => closeRequestHandler!())
    const cancel = findByText('閉じない')
    expect(cancel, '「閉じない」ボタンが無い').not.toBeNull()
    await click(cancel!)
    expect(calls.confirmClose).toBe(0)
    expect(document.querySelector('.modal-box'), 'モーダルが閉じていない').toBeNull()
  })

  it('「保存せずに閉じる」を選んだときだけ閉じる', async () => {
    await mountApp()
    await act(async () => closeRequestHandler!())
    const ok = findByText('保存せずに閉じる')
    expect(ok, '「保存せずに閉じる」ボタンが無い').not.toBeNull()
    await click(ok!)
    expect(calls.confirmClose, '閉じる指示がメインに届いていない').toBe(1)
  })
})

// ===========================================================================
describe('最近使ったプロジェクト', () => {
  it('保存したことがなければ、ファイルメニューに出ない', async () => {
    await mountApp()
    const fileMenu = Array.from(document.querySelectorAll<HTMLElement>('.menu-item')).find((el) =>
      (el.textContent ?? '').includes('ファイル')
    )
    await click(fileMenu!)
    expect(findByText('最近使ったプロジェクト', '.menu-drop-label')).toBeNull()
  })

  it('記録があればファイルメニューに並び、選ぶとそのファイルが直接開かれる', async () => {
    localStorage.setItem(
      'giftcut.recentProjects',
      JSON.stringify([
        { path: 'C:/proj/朝の切り抜き.gcproj', name: '朝の切り抜き.gcproj', at: 1 },
        { path: 'C:/proj/夜の切り抜き.gcproj', name: '夜の切り抜き.gcproj', at: 2 }
      ])
    )
    await mountApp()
    const fileMenu = Array.from(document.querySelectorAll<HTMLElement>('.menu-item')).find((el) =>
      (el.textContent ?? '').includes('ファイル')
    )
    await click(fileMenu!)
    expect(findByText('最近使ったプロジェクト', '.menu-drop-label')).not.toBeNull()
    const item = findByText('朝の切り抜き.gcproj', '.menu-drop-recent')
    expect(item, '最近使ったプロジェクトが一覧に出ていない').not.toBeNull()
    // ファイル名だけを出す（長いパスでメニューが横に伸びない）
    expect(item!.textContent).toBe('朝の切り抜き.gcproj')
    // フルパスはツールチップで分かる
    expect(item!.getAttribute('title')).toBe('C:/proj/朝の切り抜き.gcproj')
    await click(item!)
    expect(calls.openProject, 'ダイアログを出さずに直接開いていない').toEqual([
      'C:/proj/朝の切り抜き.gcproj'
    ])
  })

  it('壊れた記録が入っていても起動できる', async () => {
    localStorage.setItem('giftcut.recentProjects', '{これはJSONではない')
    await expect(mountApp()).resolves.not.toThrow()
  })
})

// ===========================================================================
describe('起動直後の画面', () => {
  it('タイムラインとトラックが出ている', async () => {
    await mountApp()
    expect(document.querySelector('.track-scroll'), 'タイムラインが無い').not.toBeNull()
    const tracks = Array.from(document.querySelectorAll('[data-tid]')).map((el) =>
      el.getAttribute('data-tid')
    )
    // 本編の映像と音声は必ずある
    expect(tracks).toContain('V1')
    expect(tracks).toContain('A1')
  })

  it('映像トラックは番号の大きい順、音声は小さい順に並ぶ（番号が大きいほど前面）', async () => {
    await mountApp()
    const ids = Array.from(document.querySelectorAll('[data-tid]')).map(
      (el) => el.getAttribute('data-tid') ?? ''
    )
    const vs = ids.filter((id) => id.startsWith('V')).map((id) => Number(id.slice(1)))
    const as = ids.filter((id) => id.startsWith('A')).map((id) => Number(id.slice(1)))
    expect(vs, `映像トラックの並びが降順でない: ${vs.join(',')}`).toEqual(
      [...vs].sort((a, b) => b - a)
    )
    expect(as, `音声トラックの並びが昇順でない: ${as.join(',')}`).toEqual(
      [...as].sort((a, b) => a - b)
    )
    // 映像がすべて音声より上にある
    const firstAudio = ids.findIndex((id) => id.startsWith('A'))
    const lastVideo = ids.map((id) => id.startsWith('V')).lastIndexOf(true)
    expect(lastVideo, '映像トラックが音声トラックより下にある').toBeLessThan(firstAudio)
  })

  it('マグネットのボタンで切ると、その設定が保存されて再起動後も切れたまま', async () => {
    // ツールバーのボタンから切ると保存されず、再起動で ON に戻る不具合があった。
    // localStorage を直接いじるのではなく、実際にボタンを押して確かめる。
    await mountApp()
    const magnet = Array.from(document.querySelectorAll<HTMLElement>('.tool')).find((el) =>
      (el.textContent ?? '').includes('🧲')
    )
    expect(magnet, 'マグネットのボタンが見つからない').not.toBeNull()
    expect(magnet!.className, '初期状態でONになっていない').toContain('tool-on')

    await click(magnet!) // 切る
    expect(localStorage.getItem('giftcut.snap'), '切った設定が保存されていない').toBe('false')
    expect(magnet!.className, '切ったのに見た目がONのまま').not.toContain('tool-on')

    // 「再起動」= 一度アンマウントして、保存された設定から立ち上げ直す
    await unmountApp()
    await mountApp()
    const again = Array.from(document.querySelectorAll<HTMLElement>('.tool')).find((el) =>
      (el.textContent ?? '').includes('🧲')
    )
    expect(again!.className, '再起動でONに戻ってしまった').not.toContain('tool-on')
  })
})

// ===========================================================================
describe('未保存の「＊」と自動保存', () => {
  /** App.tsx の projectJson が保存している項目名を取り出す */
  function savedFields(src: string): string[] {
    const from = src.indexOf('function projectJson(')
    expect(from, 'projectJson が見つからない').toBeGreaterThan(-1)
    const body = src.slice(from, src.indexOf('\n  }', from))
    // JSON.stringify に渡すオブジェクトの直下の項目だけ（＝インデント8つ）
    return [...body.matchAll(/^ {8}(\w+)\s*[:,]/gm)].map((m) => m[1])
  }

  /** 「＊」を見直す useEffect の依存配列を取り出す */
  function dirtyDeps(src: string): string[] {
    const anchor = src.indexOf('const projectRevRef = useRef(0)')
    expect(anchor, '未保存判定の useEffect が見つからない').toBeGreaterThan(-1)
    const open = src.indexOf('}, [', anchor)
    const list = src.slice(open + 4, src.indexOf('])', open))
    return [...list.matchAll(/\b([a-zA-Z_]\w*)\b/g)].map((m) => m[1])
  }

  it('保存する項目はすべて「＊」の見直し対象に入っている', async () => {
    // 「＊」は 0.8 秒ごとの総当たりをやめ、中身が変わったときだけ見直すように
    // した。依存配列は手で書くので、projectJson に項目を足して依存を足し忘れると
    // 「＊」が出なくなる。人が気づけないので、ここで機械に見張らせる。
    const src = await import('./App?raw').then((m) => m.default as string)
    const fields = savedFields(src)
    const deps = dirtyDeps(src)

    expect(fields.length, '保存項目を1つも読み取れていない（書式が変わった？）').toBeGreaterThan(20)
    expect(deps.length, '依存配列を読み取れていない（書式が変わった？）').toBeGreaterThan(20)

    // version は定数、projectPath は保存時に差し替えるので名前が一致しない
    const exempt = new Set(['version'])
    // layout は「画面の配置」をまとめた1項目。中で読んでいる state が
    // ぜんぶ依存に入っていれば、この項目は見張られていることになる。
    // （まとめただけで見張りから外れる、という抜け道を作らないため）
    const layoutFrom = src.indexOf('const layoutNow = ()')
    expect(layoutFrom, 'layoutNow が見つからない').toBeGreaterThan(-1)
    const layoutBody = src.slice(layoutFrom, src.indexOf('\n  })', layoutFrom))
    const stateNames = new Set(
      [...src.matchAll(/const \[(\w+), set\w+\] = useState/g)].map((m) => m[1])
    )
    const layoutStates = [...new Set([...layoutBody.matchAll(/\b([a-zA-Z_]\w*)\b/g)].map((m) => m[1]))]
      .filter((n) => stateNames.has(n))
    expect(layoutStates.length, '画面の配置が何も読めていない').toBeGreaterThan(5)
    const layoutMissing = layoutStates.filter((n) => !deps.includes(n))
    expect(
      layoutMissing,
      `画面の配置に足したのに「＊」の依存配列に入っていない: ${layoutMissing.join(', ')}`
    ).toEqual([])

    const missing = fields.filter(
      (f) => !exempt.has(f) && f !== 'layout' && !deps.includes(f)
    )
    expect(
      missing,
      `projectJson に足したのに「＊」の依存配列に入っていない: ${missing.join(', ')}`
    ).toEqual([])
  })

  it('自動保存の間隔は1〜10分（落ちて失う量の上限）', async () => {
    const src = await import('./App?raw').then((m) => m.default as string)
    // 既定値の行（`return 5 * 60 * 1000`）を読む。確認のときだけ縮められる作りなので、
    // 定数そのものは式になっている
    const m = src.match(/return ([\d\s*]+)\n\s*\}\)\(\)/)
    expect(m, 'AUTOSAVE_MS の既定値が見つからない').not.toBeNull()
    const ms = m![1].split('*').reduce((a, b) => a * Number(b.trim()), 1)
    expect(Number.isFinite(ms), `既定値を読み取れない: ${m![1]}`).toBe(true)
    expect(ms, '自動保存の間隔が1分未満（毎回プロジェクト全体を書き出すことになる）').toBeGreaterThanOrEqual(60_000)
    expect(ms, '自動保存の間隔が10分超（落ちたときに失う量が大きすぎる）').toBeLessThanOrEqual(600_000)
  })

  it('自動保存の間隔を外から縮められる（確認のため）＋ 短すぎる値は受け付けない', async () => {
    // 5分待つ確認は書けないので、確認のときだけ縮められるようにしてある。
    // ただし**縮め放題にはしない**（0 や負の数を入れられると、書き込みが暴走する）。
    const src = await import('./App?raw').then((m) => m.default as string)
    expect(src, '外から間隔を変える口が無い').toContain('giftcut.autosaveMs')
    expect(src, '下限（500ms）の歯止めが無い').toMatch(/v >= 500/)
  })

  it('待機中はプロジェクト全体を何度も文字列にしない', async () => {
    // 以前は 0.8 秒ごとに JSON.stringify していた。素材が長いほど効くので、
    // 何も編集していない間は走らないことを実際に測る。
    await mountApp()
    // 起動直後の1回（基準づくり）は正しい動きなので、落ち着くまで待ってから測る
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500))
    })
    const spy = vi.spyOn(JSON, 'stringify')
    const before = spy.mock.calls.length
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1200)) // 以前ならこの間に1〜2回
    })
    const during = spy.mock.calls.length - before
    spy.mockRestore()
    expect(during, `待機中なのに ${during} 回も文字列化している`).toBe(0)
  })
})
