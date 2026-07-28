// ビン（素材一覧）の素材が「使用中」かどうかの判定。
//
// ここを間違えると、消せるはずの素材が消せない／消してはいけない素材が消える。
// 判定の基準は一つだけ:
//
//   使用中 ＝ タイムラインに、その素材を指すクリップが1つでも残っている
//
// 「元動画として登録されているか」は基準にしない。元動画の登録は、切片を全部
// 消したあとも主ソースとして残り続けるため、それを見ていると
// 「タイムラインは空なのに、ビンからは消せない」という手詰まりになる。
// （実際にそうなっていた。クリップを消したのに ✕ が効かない、という報告のもと）

export interface Source {
  id: number
  path: string
}

export interface BinRefs {
  /** 元動画の登録一覧。先頭が主ソース（srcId 未指定の切片はこれを指す） */
  sources: Source[]
  /** 本編の切片。srcId 未指定 = 主ソース */
  segments: { srcId?: number }[]
  seClips: { path: string }[]
  imgClips: { path: string }[]
  vClips: { path: string }[]
}

/** その素材を指している元動画の登録id（同じファイルが二重登録されている場合もあるので配列） */
function sourceIdsOf(path: string, refs: BinRefs): number[] {
  return refs.sources.filter((s) => s.path === path).map((s) => s.id)
}

/** 切片が実際に指している元動画のid（未指定は主ソース） */
function usedSourceIds(refs: BinRefs): Set<number> {
  const primary = refs.sources[0]?.id
  const used = new Set<number>()
  for (const g of refs.segments) {
    const id = g.srcId ?? primary
    if (id != null) used.add(id)
  }
  return used
}

/** タイムラインのクリップから参照されているか */
export function mediaInUse(path: string, refs: BinRefs): boolean {
  if (
    refs.seClips.some((c) => c.path === path) ||
    refs.imgClips.some((c) => c.path === path) ||
    refs.vClips.some((c) => c.path === path)
  ) {
    return true
  }
  const ids = sourceIdsOf(path, refs)
  if (!ids.length) return false
  const used = usedSourceIds(refs)
  return ids.some((id) => used.has(id))
}

/**
 * その素材をビンから消すとき、一緒に片付ける元動画の登録id。
 * 切片が残っている登録は返さない（＝残す）。
 */
export function staleSourceIds(path: string, refs: BinRefs): number[] {
  const used = usedSourceIds(refs)
  return sourceIdsOf(path, refs).filter((id) => !used.has(id))
}
