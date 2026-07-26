// アイコン画像ライブラリ（単純な画像置き場）。ラベル色とは無関係に画像を貯める。
export interface IconItem {
  id: number
  name: string
  image: string // dataURL
}

const KEY = 'giftcut.iconLibrary'

export function loadIconLibrary(): IconItem[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}
// 保存できたかを返す（localStorage の容量上限に達したとき、呼び出し側が警告を出せるように）
export function saveIconLibrary(list: IconItem[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
    return true
  } catch {
    // 容量上限など。握りつぶすと「保存できたつもりで次回起動で消える」ので false を返す
    return false
  }
}

// ラベル色 → ライブラリ画像(dataURL) の割当（「アイコン設定」で設定。画像自体はライブラリ管理）
const ASSIGN_KEY = 'giftcut.iconAssign'
export function loadIconAssign(): Record<string, string> {
  try {
    const o = JSON.parse(localStorage.getItem(ASSIGN_KEY) || '{}')
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}
export function saveIconAssign(map: Record<string, string>): void {
  try {
    localStorage.setItem(ASSIGN_KEY, JSON.stringify(map))
  } catch {
    /* 無視 */
  }
}

// アイコンのレイアウト（全体設定）: side=テキストの左/右, gap=隙間倍率
export interface IconLayout {
  side: 'left' | 'right'
  gap: number // 隙間倍率（基準0.32）
}
const LAYOUT_KEY = 'giftcut.iconLayout'
export function loadIconLayout(): IconLayout {
  try {
    const o = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}')
    return {
      side: o?.side === 'right' ? 'right' : 'left',
      gap: typeof o?.gap === 'number' && o.gap >= 0 && o.gap <= 3 ? o.gap : 1
    }
  } catch {
    return { side: 'left', gap: 1 }
  }
}
export function saveIconLayout(l: IconLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(l))
  } catch {
    /* 無視 */
  }
}
