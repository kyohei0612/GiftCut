// コラボアイコン（ラベル色 → 人物アイコン画像）の登録データ

export interface Person {
  name: string
  image: string // 正方形の dataURL（PNG）
  scale?: number // この人物アイコンの個別サイズ倍率（既定1）
}
export type PeopleMap = Record<string, Person> // key = ラベルカラー(hex)

const KEY = 'giftcut.people'
const SCALE_KEY = 'giftcut.iconScale' // 全体（一括）アイコンサイズ倍率

export function loadPeople(): PeopleMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as PeopleMap
  } catch {
    return {}
  }
}
export function savePeople(p: PeopleMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* localStorage 上限等は握りつぶす */
  }
}
export function loadIconScale(): number {
  const v = Number(localStorage.getItem(SCALE_KEY))
  return v >= 0.2 && v <= 4 ? v : 1
}
export function saveIconScale(v: number): void {
  try {
    localStorage.setItem(SCALE_KEY, String(v))
  } catch {
    /* 無視 */
  }
}

/** 画像ファイルを dataURL にする（クロップ編集の元画像用） */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = (): void => resolve(String(r.result))
    r.onerror = (): void => reject(new Error('ファイル読み込み失敗'))
    r.readAsDataURL(file)
  })
}
