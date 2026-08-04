// アイコン画像ライブラリ（単純な画像置き場）。ラベル色とは無関係に画像を貯める。

/**
 * 画像ファイルを dataURL にする。
 *
 * **もう無いファイル（人物アイコンの置き場）から持ってきた（2026-08-03）。** あちらは「ラベル色 → 人物アイコン」の
 * 置き場だったが、**この関数以外すべて誰からも呼ばれていなかった**（作りが
 * ライブラリ方式に変わったときに置き去りになった）。1つのために残しておくと、
 * 次に読む人が「人物アイコンの仕組みがまだある」と誤解する。
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = (): void => resolve(String(r.result))
    r.onerror = (): void => reject(new Error('ファイル読み込み失敗'))
    r.readAsDataURL(file)
  })
}

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

// ※ 「アイコンのレイアウト（左右／隙間）」をここに覚える仕組みがあったが、
//    **誰からも呼ばれていなかった**ので消した（2026-08-03）。
//    いまの左右・隙間は `useIcons` が持っていて、プロジェクトに保存される。
//    死んだコードを残すと、次に読む人が「2か所に置き場がある」と誤解する。
