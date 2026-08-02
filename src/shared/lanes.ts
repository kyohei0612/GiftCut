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

/** 置いてある物（どの段の、いつからいつまで） */
export interface LaneBusy {
  track: string
  tStart: number
  duration: number
}

/**
 * 音を置く段を選ぶ。**「いつも A2」をやめるための判定。**
 *
 * 素材をダブルクリックして置くとき、置き先が A2 固定だった。
 * 掴んで落とすときは狙った段へ行くのに、こちらだけ固定なのは食い違っている
 *（本人から「レーンまで固定しないでほしい」と出ていた）。
 *
 * 決め方は3段構え:
 *   1. 段を選んであるなら、そこ（狙って選んだ物を勝手に無視しない）
 *   2. 選んでいなければ、**その時刻が空いている一番上の段**
 *   3. どこも埋まっていれば既定へ（重なるが、置かないより分かりやすい）
 *
 * **本編の音（lanes に入れない）は呼ぶ側で外すこと。** ここへ渡すと
 * 元の音の上に置いてしまう。
 */
export function pickAudioLane(
  lanes: readonly string[],
  busy: readonly LaneBusy[],
  t: number,
  fallback: string,
  prefer?: string | null
): string {
  const free = (id: string): boolean =>
    !busy.some((c) => c.track === id && t >= c.tStart && t < c.tStart + c.duration)
  if (prefer && lanes.includes(prefer)) return prefer
  const open = lanes.find(free)
  return open ?? fallback
}

/**
 * 段の一覧から「音を置く段」を決める（呼ぶ側を1行で済ませるための包み）。
 *
 * **本編の音（A1）はここで外す。** 呼ぶ側ごとに外し忘れると、
 * 元の音の上に置いてしまう。
 */
export function audioLaneFor(
  tracks: readonly { id: string; kind: string }[],
  busy: readonly LaneBusy[],
  t: number,
  prefer?: string | null
): string {
  const lanes = tracks.filter((tr) => tr.kind === 'audio' && tr.id !== 'A1').map((tr) => tr.id)
  return pickAudioLane(lanes, busy, t, lanes[0] ?? 'A2', prefer)
}

/**
 * 狙った段が**その時刻に埋まっていたら、1段ずつ上へ避ける**。
 *
 * 落とす先の影が、既にテロップや画像が乗っている段に出ていた。
 * そのまま離すと上書きになるので、影の時点で空いている段を指しておく
 *（本人から「そこにテロップ等が入っていたら1段ずらす」と出ていた）。
 *
 * **影と実際の置き先は必ず同じ判定を通すこと。** 別々にすると影が嘘をつく。
 *
 * 上まで詰まっていたら狙った段のまま返す（置かないより、上書きでも置く方が
 * 分かりやすい。段を足すかどうかは人が決める）。
 *
 * @param order 段の並び。**上から順**
 */
export function avoidBusyLane(
  order: readonly string[],
  busy: readonly LaneBusy[],
  t: number,
  picked: string
): string {
  const at = order.indexOf(picked)
  if (at < 0) return picked
  const free = (id: string): boolean =>
    !busy.some((c) => c.track === id && t >= c.tStart && t < c.tStart + c.duration)
  for (let i = at; i >= 0; i--) if (free(order[i])) return order[i]
  return picked
}
