// 「組」——選んだ物をひとまとめにして、掴む・動かす・消す・写すが常に組ごと効くようにする。
//
// ## なぜ「ネスト」ではなく「組」なのか
//
// プレミアのネストは**別のシーケンスへ押し込んで1本のクリップとして出す**物で、
// 新しい入れ物・その中の再生・書き出し時の平坦化まで要る。
// 本人の狙いは「毎回選び直すのが面倒」なので、そこまで要らない。
//
// 採ったのは**印を付けるだけ**の形:
//
//   ・中身はタイムラインに見えたまま（隠さない・畳まない）
//   ・**書き出しには一切影響しない**（書き出し側は group を見ない）
//   ・段をまたいでよい（動画＋テロップ＋音をまとめる、が本来やりたいこと）
//
// ## なぜ種類を知らない形にしてあるか
//
// 組はテロップ・切片・効果音・画像・映像クリップにまたがる。
// ここで種類の名前（'telop' | 'se' | …）を決め打つと、
// **選択の持ち方（種類ごとに別の number[]）と二重に持つことになる。**
// なので鍵は呼ぶ側が決める。ここは「id と group を持つ物の集まり」しか知らない。
//
// ## 組の番号は id と別に持つ
//
// 保存の読み直しで **id は必ず振り直される**（`projectLoad.ts` の決まり）。
// 組を「相手の id」で持つと、そこで全部ちぎれる。だから独立した連番にしてある。

/** 組に入れられる物。ここが見るのはこの2つだけ */
export interface Groupable {
  id: number
  /** 組の番号。未指定＝どの組にも入っていない */
  group?: number
}

/** 種類ごとの持ち物。鍵（種類の名前）は呼ぶ側が決める */
export type GroupPool<K extends string> = Readonly<Record<K, readonly Groupable[]>>
/** 種類ごとの選択中の id */
export type GroupSel<K extends string> = Readonly<Record<K, readonly number[]>>

/**
 * 保存から読み直した値を組の番号として受け取ってよいか。
 *
 * **壊れていたら捨てる**（`projectLoad.ts` の「知らない値は捨てる」と同じ扱い）。
 * 0 と負の数も捨てる——番号は1から振るので、0 が通ると
 * 「組に入っていない」と見分けが付かなくなる。
 */
export function sanitizeGroupId(v: unknown): number | undefined {
  if (typeof v !== 'number') return undefined
  if (!Number.isSafeInteger(v) || v < 1) return undefined
  return v
}

function kindsOf<K extends string>(pool: GroupPool<K>): K[] {
  return Object.keys(pool) as K[]
}

/**
 * 次に使う組の番号。
 *
 * **いま使われている中の最大＋1。** 空きを詰めない——詰めると、
 * 消した組の番号が再利用されて、消し残りが別の組に紛れ込む。
 */
export function nextGroupId<K extends string>(pool: GroupPool<K>): number {
  let max = 0
  for (const k of kindsOf(pool)) {
    for (const it of pool[k]) {
      const g = sanitizeGroupId(it.group)
      if (g != null && g > max) max = g
    }
  }
  return max + 1
}

/** いま選んでいる物が属している組の番号（重複なし・小さい順） */
export function groupIdsInSelection<K extends string>(
  pool: GroupPool<K>,
  sel: GroupSel<K>
): number[] {
  const found = new Set<number>()
  for (const k of kindsOf(pool)) {
    const picked = new Set(sel[k] ?? [])
    if (picked.size === 0) continue
    for (const it of pool[k]) {
      if (!picked.has(it.id)) continue
      const g = sanitizeGroupId(it.group)
      if (g != null) found.add(g)
    }
  }
  return [...found].sort((a, b) => a - b)
}

/** 指定した組に属する物の id（種類ごと） */
export function membersOfGroups<K extends string>(
  pool: GroupPool<K>,
  groups: readonly number[]
): Record<K, number[]> {
  const want = new Set(groups)
  const out = {} as Record<K, number[]>
  for (const k of kindsOf(pool)) {
    out[k] = pool[k].filter((it) => inGroups(it, want)).map((it) => it.id)
  }
  return out
}

/**
 * この物が、指定の組のどれかに入っているか。
 *
 * **`it.group ?? 0` と書いてはいけない。** 組に入っていない物が
 * 「組0」として一致してしまい、`membersOfGroups(pool, [0])` が全件を返す
 *（`sanitizeGroupId` が 0 を捨てているのはこのため）。
 */
function inGroups(it: Groupable, want: ReadonlySet<number>): boolean {
  const g = sanitizeGroupId(it.group)
  return g != null && want.has(g)
}

/**
 * 選択を組ごとに広げる。**組の入口はここ1か所。**
 *
 * クリップの種類ごとに「掴んだら仲間も選ぶ」を書くと、
 * 片方だけ組が効かない状態が必ず残る（吸着で実際に起きた型）。
 *
 * **変わらない種類は、渡された配列をそのまま返す**（`===` が保たれる）。
 * 毎回新しい配列にすると、選ぶたびに全部の帯が描き直しになる。
 */
export function expandSelectionByGroup<K extends string>(
  pool: GroupPool<K>,
  sel: GroupSel<K>
): Record<K, readonly number[]> {
  const groups = groupIdsInSelection(pool, sel)
  const out = {} as Record<K, readonly number[]>
  if (groups.length === 0) {
    for (const k of kindsOf(pool)) out[k] = sel[k] ?? []
    return out
  }
  const want = new Set(groups)
  for (const k of kindsOf(pool)) {
    const cur = sel[k] ?? []
    const have = new Set(cur)
    // 押した順を壊さないために、足す分は後ろへ付ける
    const add = pool[k].filter((it) => !have.has(it.id) && inGroups(it, want)).map((it) => it.id)
    out[k] = add.length === 0 ? cur : [...cur, ...add]
  }
  return out
}

/** 選んでいる物の総数（種類をまたいで数える） */
export function countSelected<K extends string>(pool: GroupPool<K>, sel: GroupSel<K>): number {
  let n = 0
  for (const k of kindsOf(pool)) {
    const picked = new Set(sel[k] ?? [])
    if (picked.size === 0) continue
    for (const it of pool[k]) if (picked.has(it.id)) n++
  }
  return n
}

/** 組にできるか。**2つ以上ないと組にしない**（1つの組は組ではない） */
export function canGroup<K extends string>(pool: GroupPool<K>, sel: GroupSel<K>): boolean {
  return countSelected(pool, sel) >= 2
}

/** 解けるか。選んでいる物のどれかが組に入っていれば解ける */
export function canUngroup<K extends string>(pool: GroupPool<K>, sel: GroupSel<K>): boolean {
  return groupIdsInSelection(pool, sel).length > 0
}

/**
 * 組にする。返すのは「付ける番号」と「付ける相手」。
 *
 * すでに別の組に入っている物を含めて選んだときは、**その組ごと吸収して1つにする。**
 * 半分だけ新しい組へ移すと、残り半分が元の組に取り残されて、
 * 見た目には同じなのに動かすと片方だけ付いてくる状態になる。
 */
export function makeGroup<K extends string>(
  pool: GroupPool<K>,
  sel: GroupSel<K>
): { group: number; ids: Record<K, readonly number[]> } | null {
  if (!canGroup(pool, sel)) return null
  return { group: nextGroupId(pool), ids: expandSelectionByGroup(pool, sel) }
}

/**
 * 組を解く。返すのは「印を消す相手」。
 *
 * 選んでいる物だけでなく、**その組の全員から消す**——
 * 一部だけ残すと、残った側だけで組が生き続ける。
 */
export function ungroup<K extends string>(
  pool: GroupPool<K>,
  sel: GroupSel<K>
): Record<K, number[]> | null {
  const groups = groupIdsInSelection(pool, sel)
  if (groups.length === 0) return null
  return membersOfGroups(pool, groups)
}

/**
 * 写した物（コピー・複製）の組の番号を振り直す表を作る。
 *
 * **写しに元の番号を残してはいけない。** 残すと写しと元が同じ組になり、
 * 写しを動かしたつもりで元まで動く（しかも見た目には理由が分からない）。
 *
 * 元の組が2つ以上あれば、写しの側でも2つに分かれたまま保つ。
 *
 * @param groups 写した物が持っていた組の番号（undefined 混じりでよい）
 * @param next   振り始める番号（`nextGroupId` の返り値）
 * @returns 元の番号 → 新しい番号。組に入っていなかった物は表に載らない
 */
export function remapGroups(
  groups: readonly (number | undefined)[],
  next: number
): Map<number, number> {
  const map = new Map<number, number>()
  for (const g0 of groups) {
    const g = sanitizeGroupId(g0)
    if (g == null || map.has(g)) continue
    map.set(g, next + map.size)
  }
  return map
}

/**
 * 組の印を付け直した配列を返す（変わらなければ元の配列をそのまま返す）。
 *
 * @param group 付ける番号。`undefined` なら印を消す
 */
export function applyGroup<T extends Groupable>(
  items: readonly T[],
  ids: readonly number[],
  group: number | undefined
): readonly T[] {
  if (ids.length === 0) return items
  const want = new Set(ids)
  let changed = false
  const next = items.map((it) => {
    if (!want.has(it.id)) return it
    if ((it.group ?? undefined) === group) return it
    changed = true
    const copy = { ...it }
    if (group == null) delete copy.group
    else copy.group = group
    return copy
  })
  return changed ? next : items
}
