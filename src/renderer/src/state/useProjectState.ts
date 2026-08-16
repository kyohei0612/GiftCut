// プロジェクトの持ち物と、使う人が決めた設定。
//
// ## 「作品の中身」とは別物
//
// タイムラインに載っている物（テロップ・切片…）は state/useContent。
// こちらは**それを取り巻く物**——どのファイルとして保存しているか、
// お気に入り、自作の分類、色や段へのアイコン割り当て、次に足す物の既定値。
//
// ## なぜまとめるか
//
// **更新しても消えてはいけない物**が多い。お気に入りや自作分類が消えると
// 「自分でいじった分」が丸ごと失われる。1か所に集めておけば、
// 保存し忘れ・読み込み忘れが起きにくい。

import { useState } from 'react'
import type { TelopStyle } from '../lib/telopStyle'
import type { TelopTemplate } from '../lib/telopTemplates'

/** 最近開いたプロジェクト */
export interface RecentProject {
  path: string
  name: string
  at: number
}

/** 見つからなくなった素材（元のパスを覚えておき、書き戻す） */
export interface MissingMedia {
  videoPath: string | null
  sources: { id?: number; path?: string; name?: string }[]
}

export interface ProjectState {
  /** いま開いているプロジェクトファイル（null＝まだ保存していない） */
  projectPath: string | null
  setProjectPath: React.Dispatch<React.SetStateAction<string | null>>
  /** 読み込んだ字幕ファイルのパス（表示用） */
  srtPath: string | null
  setSrtPath: React.Dispatch<React.SetStateAction<string | null>>
  /** 見つからなかった素材。**消さずに書き戻す**（消すと繋ぎ直せなくなる） */
  missingMedia: MissingMedia | null
  setMissingMedia: React.Dispatch<React.SetStateAction<MissingMedia | null>>
  recentProjects: RecentProject[]
  setRecentProjects: React.Dispatch<React.SetStateAction<RecentProject[]>>

  /** お気に入り（更新しても消してはいけない） */
  favorites: string[]
  setFavorites: React.Dispatch<React.SetStateAction<string[]>>
  /** 分類の付け替え */
  catOverrides: Record<string, string>
  setCatOverrides: React.Dispatch<React.SetStateAction<Record<string, string>>>
  /** 自分で作った分類 */
  customCats: { key: string; label: string }[]
  setCustomCats: React.Dispatch<React.SetStateAction<{ key: string; label: string }[]>>
  /** 自分で保存した見た目 */
  userTemplates: TelopTemplate[]
  setUserTemplates: React.Dispatch<React.SetStateAction<TelopTemplate[]>>

  /** 次に足すテロップの既定の見た目 */
  newTelopStyle: TelopStyle
  setNewTelopStyle: React.Dispatch<React.SetStateAction<TelopStyle>>
  /** つなぎ目の演出の既定の長さ（秒） */
  transDur: number
  setTransDur: React.Dispatch<React.SetStateAction<number>>

  /** ラベルの色 → アイコン画像 */
  iconAssign: Record<string, string>
  setIconAssignState: React.Dispatch<React.SetStateAction<Record<string, string>>>
  /** 段 → アイコン画像 */
  laneIconAssign: Record<string, string>
  setLaneIconAssign: React.Dispatch<React.SetStateAction<Record<string, string>>>
  /**
   * ラベルの色 → **アイコンの縁の色**（2026-08-16・本人の指定「人物ごとに色を持たせる」）。
   *
   * 入っていない色は**ラベル色そのもの**を使う（今までと同じ見え方）。
   * ラベル色は帯の色分けにも使うので、**縁だけ別の色にしたい**が通らなかった。
   */
  iconRing: Record<string, string>
  setIconRing: React.Dispatch<React.SetStateAction<Record<string, string>>>
  /**
   * ラベルの色 → **その人物のテロップの見た目**（テンプレートの名前）。
   *
   * 覚えておいて、アイコン設定から**まとめて当てられる**ようにするためだけの物。
   * 勝手には当てない——後から色を付け替えた瞬間に、手で直した見た目が
   * 黙って上書きされるのは事故になる。
   */
  iconTemplate: Record<string, string>
  setIconTemplate: React.Dispatch<React.SetStateAction<Record<string, string>>>
}

/** 最近開いたプロジェクトを読む（壊れた記録は捨てる） */
export function loadRecentProjects(key: string, max: number): RecentProject[] {
  try {
    const raw = localStorage.getItem(key)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr)
      ? arr.filter((r): r is RecentProject => !!r && typeof r.path === 'string' && !!r.path).slice(0, max)
      : []
  } catch {
    return []
  }
}

/** localStorage から読む（無ければ既定） */
export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

/**
 * 最初の値は**関数で受け取る**（`useState` の遅延初期化）。
 *
 * 前は出来上がった値を受け取っていたので、**画面が描き直されるたびに
 * localStorage から8つ読んで JSON を解析していた**——使うのは初回だけなのに。
 * 実データではアイコンの割り当てだけで 0.6MB あり、再生ヘッドを掴んでいる間の
 * 計測で `loadIconAssign` が上位に出てきた（2026-08-03）。
 *
 * **`useState(x)` の x は毎回作られる。`useState(() => x)` なら初回だけ。**
 */
export interface ProjectStateInit {
  favorites: () => string[]
  catOverrides: () => Record<string, string>
  customCats: () => { key: string; label: string }[]
  userTemplates: () => TelopTemplate[]
  iconAssign: () => Record<string, string>
  laneIconAssign: () => Record<string, string>
  iconRing: () => Record<string, string>
  iconTemplate: () => Record<string, string>
  recentProjects: () => RecentProject[]
  newTelopStyle: () => TelopStyle
}

export function useProjectState(init: ProjectStateInit): ProjectState {
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [srtPath, setSrtPath] = useState<string | null>(null)
  const [missingMedia, setMissingMedia] = useState<MissingMedia | null>(null)
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(init.recentProjects)

  const [favorites, setFavorites] = useState<string[]>(init.favorites)
  const [catOverrides, setCatOverrides] = useState<Record<string, string>>(init.catOverrides)
  const [customCats, setCustomCats] = useState(init.customCats)
  const [userTemplates, setUserTemplates] = useState<TelopTemplate[]>(init.userTemplates)

  const [newTelopStyle, setNewTelopStyle] = useState<TelopStyle>(init.newTelopStyle)
  const [transDur, setTransDur] = useState(0.4)

  const [iconAssign, setIconAssignState] = useState<Record<string, string>>(init.iconAssign)
  const [laneIconAssign, setLaneIconAssign] = useState<Record<string, string>>(init.laneIconAssign)
  const [iconRing, setIconRing] = useState<Record<string, string>>(init.iconRing)
  const [iconTemplate, setIconTemplate] = useState<Record<string, string>>(init.iconTemplate)

  return {
    projectPath,
    setProjectPath,
    srtPath,
    setSrtPath,
    missingMedia,
    setMissingMedia,
    recentProjects,
    setRecentProjects,
    favorites,
    setFavorites,
    catOverrides,
    setCatOverrides,
    customCats,
    setCustomCats,
    userTemplates,
    setUserTemplates,
    newTelopStyle,
    setNewTelopStyle,
    transDur,
    setTransDur,
    iconAssign,
    setIconAssignState,
    laneIconAssign,
    setLaneIconAssign,
    iconRing,
    setIconRing,
    iconTemplate,
    setIconTemplate
  }
}
