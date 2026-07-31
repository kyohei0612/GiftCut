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

export function useProjectState(init: {
  favorites: string[]
  catOverrides: Record<string, string>
  customCats: { key: string; label: string }[]
  userTemplates: TelopTemplate[]
  iconAssign: Record<string, string>
  laneIconAssign: Record<string, string>
  recentProjects: RecentProject[]
  newTelopStyle: TelopStyle
}): ProjectState {
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
    setLaneIconAssign
  }
}
