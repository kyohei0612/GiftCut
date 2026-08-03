// テロップのスタイルテンプレート（右パネル「テロップ」タブのグリッド用）
import { defaultTelopStyle, type TelopStyle } from './telopStyle'

export interface TelopTemplate {
  name: string
  style: TelopStyle
  cat?: string // 使い道カテゴリ（強調/通常/悲しい/特別）。geba.json由来。UIでの移動はローカル上書き。
}

// 色カテゴリ（見た目の色で分類。2026-07-23 ユーザー要望で使い道4分類から変更）。
// key=保存値, label=表示名。用途別の整理は📁ユーザーフォルダで行う。
export const TELOP_CATS: { key: string; label: string }[] = [
  { key: '赤', label: '🔴 赤・オレンジ' },
  { key: '黄', label: '🟡 黄・金' },
  { key: '緑', label: '🟢 緑' },
  { key: '青', label: '🔵 青・水色' },
  { key: '紫', label: '🟣 紫・ピンク' },
  { key: '白', label: '⚪ 白' },
  { key: '黒', label: '⚫ 黒・グレー' }
]
export const DEFAULT_CAT = '白'

// ---- 色カテゴリの自動判定 ----
function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = hex?.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i)
  if (!m) return null
  let x = m[1]
  if (x.length === 3) x = x.split('').map((c) => c + c).join('')
  const r = parseInt(x.slice(0, 2), 16) / 255
  const g = parseInt(x.slice(2, 4), 16) / 255
  const b = parseInt(x.slice(4, 6), 16) / 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  const d = mx - mn
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h =
    mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (h * 60 + 360) % 360
  return { h, s, l }
}
const isChromatic = (hsl: { h: number; s: number; l: number }): boolean =>
  hsl.s >= 0.25 && hsl.l > 0.12 && hsl.l < 0.92
function hueCat(h: number): string {
  if (h < 45 || h >= 345) return '赤'
  if (h < 70) return '黄'
  if (h < 170) return '緑'
  if (h < 255) return '青'
  return '紫'
}
/**
 * 一度出した答えを覚えておく。
 *
 * 見本帳は数百枚あり、**画面が描き直されるたびに全部の色を計算し直していた**
 * （再生ヘッドを掴んでいる間の計測で `hexToHsl` が上位に出てきた。2026-08-03）。
 * 答えはスタイルの中身だけで決まるので、**その物を鍵にすれば覚えられる**。
 *
 * `WeakMap` なので、見本が捨てられれば控えも一緒に消える
 * （`lib/lru` のように上限を決める必要がない）。
 */
const colorCatCache = new WeakMap<TelopStyle, string>()

// スタイルの「見た目の色」でカテゴリ判定。
// 切り抜きテロップは白塗り＋色縁が多いので、塗りが無彩色なら縁→影の順で有彩色を探す。
export function colorCatOf(st: TelopStyle): string {
  const hit = colorCatCache.get(st)
  if (hit != null) return hit
  const out = colorCatOfInner(st)
  colorCatCache.set(st, out)
  return out
}

function colorCatOfInner(st: TelopStyle): string {
  const cands: string[] = []
  if (st.fill?.enabled) {
    const g = st.fill.gradient
    if (g && g.stops?.length) {
      // 最も鮮やかなストップを代表に
      let best = g.stops[0].color
      let bs = -1
      for (const sp of g.stops) {
        const hsl = hexToHsl(sp.color)
        if (!hsl) continue
        const score = hsl.s * (1 - Math.abs(hsl.l - 0.5))
        if (score > bs) {
          bs = score
          best = sp.color
        }
      }
      cands.push(best)
    } else if (st.fill.color) cands.push(st.fill.color)
  }
  for (const s of st.strokes || []) if (s.enabled) cands.push(s.color)
  if (st.shadow?.enabled) cands.push(st.shadow.color)
  for (const s of st.shadows || []) if (s.enabled !== false) cands.push(s.color)
  // 最初に見つかった有彩色で判定
  for (const c of cands) {
    const hsl = hexToHsl(c)
    if (hsl && isChromatic(hsl)) return hueCat(hsl.h)
  }
  // 全部無彩色 → 塗り(無ければ先頭候補)の明るさで白/黒
  const base = hexToHsl(cands[0] || '#ffffff')
  return base && base.l < 0.6 ? '黒' : '白'
}

// ---- お気に入り（★）：プリセット名の集合をローカル保存 ----
const FAV_KEY = 'giftcut.telopFavorites'
export function loadFavorites(): string[] {
  try {
    const a = JSON.parse(localStorage.getItem(FAV_KEY) || '[]')
    return Array.isArray(a) ? a : []
  } catch {
    return []
  }
}
export function saveFavorites(list: string[]): void {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(list))
  } catch {
    /* 無視 */
  }
}

// ---- カテゴリのローカル上書き（UIで別カテゴリへ移動した分）name→cat ----
const CATOV_KEY = 'giftcut.telopCatOverrides'
export function loadCatOverrides(): Record<string, string> {
  try {
    const o = JSON.parse(localStorage.getItem(CATOV_KEY) || '{}')
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}
export function saveCatOverrides(map: Record<string, string>): void {
  try {
    localStorage.setItem(CATOV_KEY, JSON.stringify(map))
  } catch {
    /* 無視 */
  }
}
// テンプレの実効カテゴリ（上書き優先→データcat→既定）
export function effectiveCat(t: TelopTemplate, ov: Record<string, string>): string {
  return ov[t.name] || t.cat || DEFAULT_CAT
}

// ---- ユーザー作成フォルダ（カテゴリ）：{key,label} をローカル保存。key=label（一意）----
const CUSTOMCAT_KEY = 'giftcut.telopCustomCats'
export function loadCustomCats(): { key: string; label: string }[] {
  try {
    const a = JSON.parse(localStorage.getItem(CUSTOMCAT_KEY) || '[]')
    return Array.isArray(a) ? a.filter((c) => c && c.key) : []
  } catch {
    return []
  }
}
export function saveCustomCats(list: { key: string; label: string }[]): void {
  try {
    localStorage.setItem(CUSTOMCAT_KEY, JSON.stringify(list))
  } catch {
    /* 無視 */
  }
}

// ---- 保存は「その1件の操作」だけ。**画面に出ている一覧を丸ごと書かない** ----
//
// ## なぜこの形が要るか（2026-08-04）
//
// プロジェクトを開くと、そのプロジェクトが持っている ★・分類・自作フォルダ・
// 自作テロップを**混ぜて画面に出す**（人からもらったプロジェクトでも見た目が
// 再現するように）。**保存はしない**——開くだけでアプリのライブラリへ焼き付くと、
// 新規で始めても前のプロジェクトの設定が残り「既定のテンプレートが意味をなさない」
// 状態になる（state/useProjectTemplates の説明）。
//
// **穴が1つ残っていた。** 開いている間に自分で★を1つ押すと、
// `saveFavorites(画面に出ている一覧)` を呼んでいたので、
// **触っていないプロジェクト由来の物まで全部一緒に焼き付いた。**
//
// → 直し方は「アプリ側の物とプロジェクト由来を別々に持つ」ではなく、
//   **保存する物を変える**こと。押した1件だけを、保存済みの一覧へ当てる。
//   画面の一覧は渡さないので、**混ざりようがない。**
//
// ※ 読むのは毎回 localStorage（画面の状態ではない）。**そこが肝**——
//   画面の状態には常にプロジェクト由来が混ざっている。

/** ★ を1つだけ切り替えて保存する。`on` は**切り替えた後**の状態 */
export function persistFav(name: string, on: boolean): void {
  const cur = loadFavorites()
  saveFavorites(on ? (cur.includes(name) ? cur : [...cur, name]) : cur.filter((n) => n !== name))
}

/** 分類の上書きを1件だけ保存する。`cat` が null なら上書きを外す */
export function persistCat(name: string, cat: string | null): void {
  const cur = loadCatOverrides()
  if (cat === null) delete cur[name]
  else cur[name] = cat
  saveCatOverrides(cur)
}

/** 自作フォルダを1つだけ足す／消す。`label` が null なら消す */
export function persistCustomCat(key: string, label: string | null): void {
  const cur = loadCustomCats()
  if (label === null) saveCustomCats(cur.filter((c) => c.key !== key))
  else if (!cur.some((c) => c.key === key)) saveCustomCats([...cur, { key, label }])
}

/** そのフォルダを指している上書きを、保存済みの分から外す（フォルダを消したとき） */
export function persistDropCat(key: string): void {
  const cur = loadCatOverrides()
  for (const n of Object.keys(cur)) if (cur[n] === key) delete cur[n]
  saveCatOverrides(cur)
}

/** 自作テロップを1つだけ足す（同じ名前があれば置き換える） */
export function persistUserTemplateAdd(t: TelopTemplate): void {
  const cur = loadUserTemplates()
  saveUserTemplates([...cur.filter((x) => x.name !== t.name), t])
}

/** 自作テロップを1つだけ消す。**名前で消す**（画面の一覧の番号は当てにならない） */
export function persistUserTemplateRemove(name: string): void {
  saveUserTemplates(loadUserTemplates().filter((t) => t.name !== name))
}

// 2色フチ（外=カラー太め, 内=黒細め）のよく使う組み合わせを作るヘルパー
function twoStroke(fill: string, outer: string, outerW = 14, innerW = 5): TelopStyle {
  return {
    ...defaultTelopStyle(),
    fill: { enabled: true, color: fill },
    strokes: [
      { enabled: true, color: '#000000', width: innerW, position: 'outside' },
      { enabled: true, color: outer, width: outerW, position: 'outside' }
    ],
    shadow: { enabled: true, color: '#000000', opacity: 55, angle: 90, distance: 6, blur: 5 }
  }
}

export const BUILTIN_TEMPLATES: TelopTemplate[] = [
  {
    name: 'ホワイト',
    style: {
      ...defaultTelopStyle(),
      fill: { enabled: true, color: '#ffffff' },
      strokes: [{ enabled: true, color: '#000000', width: 9, position: 'outside' }]
    }
  },
  { name: 'バイオレット', style: twoStroke('#ffffff', '#8b5cf6') },
  { name: 'ティール', style: twoStroke('#ffffff', '#14b8a6') },
  { name: 'オレンジ', style: twoStroke('#ffffff', '#f59e0b') },
  { name: 'ピンク', style: twoStroke('#ffffff', '#ec4899') },
  { name: 'ブルー', style: twoStroke('#ffffff', '#3b82f6') },
  { name: 'レッド', style: twoStroke('#ffffff', '#ef4444') },
  {
    name: 'イエロー塗り',
    style: {
      ...twoStroke('#ffe14d', '#000000', 12, 0),
      strokes: [{ enabled: true, color: '#000000', width: 11, position: 'outside' }]
    }
  },
  {
    name: '黒帯',
    style: {
      ...defaultTelopStyle(),
      fill: { enabled: true, color: '#ffffff' },
      strokes: [],
      background: { enabled: true, color: '#000000', opacity: 75 }
    }
  },
  {
    name: '影付き白',
    style: {
      ...defaultTelopStyle(),
      fill: { enabled: true, color: '#ffffff' },
      strokes: [{ enabled: true, color: '#000000', width: 6, position: 'outside' }],
      shadow: { enabled: true, color: '#000000', opacity: 85, angle: 135, distance: 10, blur: 8 }
    }
  }
]

const KEY = 'giftcut.telopTemplates'
export function loadUserTemplates(): TelopTemplate[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}
export function saveUserTemplates(list: TelopTemplate[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* 無視 */
  }
}
