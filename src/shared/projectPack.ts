// プロジェクトの持ち出し（素材ごと1つにまとめる／別PCで開き直す）。
//
// プロジェクトファイルは素材の置き場所を絶対パスで持っている。そのまま渡しても
// 相手のPCには C:\Users\自分\… が無いので、全部「見つかりません」になる。
// そこで
//
//   持ち出し: 使っている素材を全部集め、パスを ZIP の中の場所（素材/○○）に書き換える
//   受け取り: 展開した先の絶対パスへ書き戻す
//
// という2方向の変換を用意する。ここは変換だけを担当し、ZIP の読み書きも
// ファイルの有無も知らない（＝画面もディスクも無しで確かめられる）。

/** ZIP の中で素材を置く場所 */
export const MEDIA_DIR = '素材'
/** ZIP の中のプロジェクト本体 */
export const PROJECT_ENTRY = 'プロジェクト.gcproj'
/** 何をまとめたかの控え。中身が読めるように JSON で入れておく */
export const MANIFEST_ENTRY = 'まとめ情報.json'

export interface PackFile {
  /** 元のファイル（絶対パス） */
  from: string
  /** ZIP の中での場所（例: 素材/a.mp4） */
  to: string
}

export interface PackPlan {
  /** パスを ZIP の中の場所に書き換えたプロジェクト */
  project: Record<string, unknown>
  /** ZIP に入れる素材 */
  files: PackFile[]
  /** 見つからなかった素材（元のパスのまま残す。相手側で差し替えてもらう） */
  missing: string[]
}

type Any = Record<string, unknown>

/** Windows と macOS を混ぜても同じファイルだと分かるように揃える */
function key(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase()
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || 'file'
}

/** 同名の素材がぶつかったら「名前 (2).mp4」にずらす */
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) {
    taken.add(name.toLowerCase())
    return name
  }
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 2; ; i++) {
    const cand = `${stem} (${i})${ext}`
    if (!taken.has(cand.toLowerCase())) {
      taken.add(cand.toLowerCase())
      return cand
    }
  }
}

/** プロジェクトの中でファイルのパスを持っている場所を、まとめて読み書きする */
function eachPath(project: Any, fn: (p: string) => string | null): void {
  const one = (obj: Any, k: string): void => {
    const v = obj[k]
    if (typeof v === 'string' && v) {
      const next = fn(v)
      if (next != null) obj[k] = next
    }
  }
  one(project, 'videoPath')
  one(project, 'srtPath')
  for (const k of ['sources', 'seClips', 'imgClips', 'vClips', 'mediaItems']) {
    const arr = project[k]
    if (Array.isArray(arr)) for (const it of arr) if (it && typeof it === 'object') one(it as Any, 'path')
  }
}

/** プロジェクトが使っている素材の絶対パス一覧（重複なし・出てきた順） */
export function collectMediaPaths(project: Any): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  eachPath(project, (p) => {
    if (!seen.has(key(p))) {
      seen.add(key(p))
      out.push(p)
    }
    return null // ここでは書き換えない
  })
  return out
}

export interface PlanOptions {
  /** その素材が実在するか。無いものは ZIP に入れず、元のパスのまま残す */
  exists?: (path: string) => boolean
}

/** 持ち出し用に、素材の集め先とパスを書き換えたプロジェクトを作る */
export function planPack(project: Any, opts: PlanOptions = {}): PackPlan {
  const exists = opts.exists ?? ((): boolean => true)
  const copy = JSON.parse(JSON.stringify(project)) as Any
  const taken = new Set<string>()
  const mapped = new Map<string, string>() // 元のパス（揃えた形） → ZIP の中の場所
  const files: PackFile[] = []
  const missing: string[] = []

  for (const p of collectMediaPaths(copy)) {
    if (!exists(p)) {
      missing.push(p)
      continue
    }
    const to = `${MEDIA_DIR}/${uniqueName(baseName(p), taken)}`
    mapped.set(key(p), to)
    files.push({ from: p, to })
  }
  eachPath(copy, (p) => mapped.get(key(p)) ?? null)

  // 持ち出し先では前のPCの保存先は意味を持たない。残すと「開いた瞬間に
  // 相手のPCに存在しない場所へ上書き保存しようとする」ことになる。
  copy.projectPath = null
  return { project: copy, files, missing }
}

/** ZIP の中の場所（素材/○○）か */
export function isPackedPath(p: string): boolean {
  return p.startsWith(MEDIA_DIR + '/') || p.startsWith(MEDIA_DIR + '\\')
}

/**
 * 受け取り側: 展開した場所の絶対パスへ書き戻す。
 * まとめに入っていなかった素材（元の絶対パス）はそのまま残す
 * ＝相手のPCにも同じ物があれば繋がるし、無ければ普通に「見つかりません」になる。
 */
export function relinkProject(project: Any, baseDir: string, sep = '\\'): Any {
  const copy = JSON.parse(JSON.stringify(project)) as Any
  const base = baseDir.replace(/[\\/]+$/, '')
  eachPath(copy, (p) => (isPackedPath(p) ? base + sep + p.replace(/\//g, sep) : null))
  return copy
}
