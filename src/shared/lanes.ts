// タイムラインの「段」の縦位置と、どこへ落とすか。
//
// ## なぜ画面から出すか
//
// **落とし先を間違えても、その場では分からない。**
// 狙った段に置けずに駐禁マークが出る／別の段に落ちる／最悪、本編（V1・A1）を
// 上書きして元の映像が消える。どれも掴んで落としてみるまで分からず、
// 段の数や高さを変えるたびに壊れうる。
//
// 判定そのものは「y がどの行に入るか」だけなので、画面が無くても確かめられる。
//
// ## 本編を守る決まり
//
// 行の外（ルーラーの上、一番下の余白）に落ちたときに本編を選ぶと、
// **置いたつもりが本編を上書きして消してしまう**。外したときは本編以外から
// 一番近い行に寄せる。本編に置きたいなら、本編の行の上で離せばよい。

/** 1つの段の縦位置（タイムライン内側の上端からの相対 px） */
export interface LaneRow {
  id: string
  kind: 'video' | 'audio'
  /** 上端 */
  top: number
  /** 高さ */
  h: number
}

/**
 * 段を上から順に並べて、それぞれの縦位置を出す。
 *
 * @param tracks 上から並んでいる段
 * @param videoH 映像の段1つぶんの高さ
 * @param audioH 音声の段1つぶんの高さ
 * @param top0   最初の段の上端（目盛りの高さ＋余白）
 */
export function laneRows(
  tracks: readonly { id: string; kind: 'video' | 'audio' }[],
  videoH: number,
  audioH: number,
  top0: number
): LaneRow[] {
  let top = top0
  return tracks.map((t) => {
    const h = t.kind === 'video' ? videoH : audioH
    const row: LaneRow = { id: t.id, kind: t.kind, top, h }
    top += h
    return row
  })
}

/** その高さにある段。行の外なら null */
export function laneAtY(rows: readonly LaneRow[], y: number): string | null {
  return rows.find((r) => y >= r.top && y < r.top + r.h)?.id ?? null
}

/**
 * 落とし先の段を**必ず1つ返す**（行の外に落ちても、一番近い行に寄せる）。
 *
 * null を返すと、そこだけ駐禁マークが出て置けなくなる。狙いが外れても
 * 最短距離の行へ置ける方が、掴み直しより早い。
 *
 * @param forVideoLayer 画像や重ねる映像を置くとき。本編（V1）を候補から外す
 * @returns 置ける段が1つも無ければ null
 */
export function dropLaneAt(
  rows: readonly LaneRow[],
  y: number,
  kind: 'video' | 'audio',
  forVideoLayer = false
): string | null {
  const main = kind === 'video' ? 'V1' : 'A1'
  const cands = rows.filter((r) => r.kind === kind && !(forVideoLayer && r.id === main))
  if (!cands.length) return null
  // 行の上に乗っているならそこ。本編の行を狙っているなら本編でよい
  const hit = cands.find((r) => y >= r.top && y < r.top + r.h)
  if (hit) return hit.id
  // 外した＝狙いが外れている。**ここで本編を選ぶと元の映像を上書きして消す**
  const safe = cands.filter((r) => r.id !== main)
  const pool = safe.length ? safe : cands
  const dist = (r: LaneRow): number => Math.abs(y - (r.top + r.h / 2))
  return pool.reduce((a, b) => (dist(b) < dist(a) ? b : a)).id
}
