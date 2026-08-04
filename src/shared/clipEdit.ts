// クリップの端を伸ばす・縮める・分ける、その計算だけ。
//
// ## なぜ画面から出すか
//
// **端の扱いは、間違えても画面上はそれらしく見える。**
// 音がずれる、切ったはずの所から鳴る、伸ばしたら無音が付いてくる——
// どれも掴んで動かして耳で確かめるしかなく、確かめ漏れがそのまま残る。
//
// 計算そのものは「元の音のどこを、どれだけ使うか」だけなので、
// 画面が無くても確かめられる。
//
// ## 音源内の位置（srcOffset）が要点
//
// クリップは元の音の一部を切り出して置いた物なので、**3つが連動する**:
//
//   tStart    … タイムライン上のどこに置くか
//   duration  … どれだけ鳴らすか
//   srcOffset … 元の音のどこから使うか
//
// 左端を動かすときにこの3つを揃えて動かさないと、**掴んだ端は動いたのに
// 音の中身がずれる**（同じ所から鳴り続ける／飛ぶ）。

/** 音源の一部を使うクリップ（効果音・BGM）。必要な項目だけ見る */
export interface SourceClip {
  tStart: number
  duration: number
  /** 元の音のどこから使っているか（秒）。未指定=頭から */
  srcOffset?: number
  /** 元の音の全長（秒）。未取得なら undefined＝上限を見ない */
  srcDur?: number
}

/** これより短くはしない（秒）。0にすると掴めなくなる */
export const MIN_CLIP = 0.1

/**
 * 右端を動かす（長さを変える）。
 *
 * **元の音の残りを超えて伸ばさない。** 超えると、その先は無音になる
 * （鳴っていない所を鳴らしているつもりで置くことになる）。
 *
 * @param wantEnd 動かした先の終わり（秒・タイムライン上）
 */
export function trimRight(clip: SourceClip, wantEnd: number): { duration: number } {
  const off = clip.srcOffset ?? 0
  const maxLen = Math.max(MIN_CLIP, (clip.srcDur ?? Infinity) - off)
  const d = Math.min(Math.max(wantEnd - clip.tStart, MIN_CLIP), maxLen)
  return { duration: d }
}

/**
 * 左端を動かす（終わりは動かさない）。
 *
 * **元の音の頭より前へは戻せない。** 戻せるのは、いま捨てている分（srcOffset）まで。
 * 併せて srcOffset も動かす——ここを忘れると、端だけ動いて中身がずれる。
 *
 * @param wantStart 動かした先の始まり（秒・タイムライン上）
 */
export function trimLeft(
  clip: SourceClip,
  wantStart: number
): { tStart: number; duration: number; srcOffset: number } {
  const off = clip.srcOffset ?? 0
  const end = clip.tStart + clip.duration
  // 戻せる限界（元の音の頭）と、潰れない限界（終わりの手前）で挟む
  const lo = Math.max(0, clip.tStart - off)
  const hi = end - MIN_CLIP
  const s = Math.min(Math.max(wantStart, lo), hi)
  return { tStart: s, duration: end - s, srcOffset: off + (s - clip.tStart) }
}

/**
 * ある時刻で2つに分ける。
 *
 * 端に寄りすぎている所では分けない（掴めない欠片ができる）。
 * 分けたら**つなぎ目のフェードを外す**——残すと、切れ目で音が一度沈む。
 *
 * @returns 分けられなければ null
 */
export function splitAt(
  clip: SourceClip,
  t: number,
  margin = 0.05
): { left: SourceClip & { fadeOut: number }; right: SourceClip & { fadeIn: number } } | null {
  if (t <= clip.tStart + margin) return null
  if (t >= clip.tStart + clip.duration - margin) return null
  const leftLen = t - clip.tStart
  const off = clip.srcOffset ?? 0
  return {
    left: { ...clip, duration: leftLen, fadeOut: 0 },
    right: {
      ...clip,
      tStart: t,
      duration: clip.duration - leftLen,
      fadeIn: 0,
      // 右側は、左で使った分だけ元の音の先へ進む
      srcOffset: off + leftLen
    }
  }
}

/**
 * Ctrl クリックでの選び足し・選び外し。
 *
 * **同じ物を2回入れない。** 重複すると、まとめて動かしたときに
 * 同じクリップへ2回ずらしが掛かる。
 */
export function toggleSelect(ids: readonly number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

/**
 * **束をまとめてずらす。段を変えるのは掴んだ1つだけ。**
 *
 * 全部を同じ段へ寄せると重なって壊れる（掴んだ物だけ動かし、
 * 残りは元の段に置いていく）。位置は**掴んだ時の控え**から測る——
 * 動かしている最中の値を起点にすると、じわじわ流れていく。
 *
 * ## なぜ1か所に寄せたか（2026-08-04）
 *
 * `state/useClipDrag` の3か所（効果音・画像・映像レイヤー）に、
 * **同じ12行が3回**書かれていた。
 *
 * @param base 掴んだ時の tStart（id → 秒）
 * @param lane 落とし先。null なら段を変えない
 */
export function shiftGroup<T extends { id: number; tStart: number; track: string }>(
  list: readonly T[],
  grpIds: readonly number[],
  base: ReadonlyMap<number, number>,
  shift: number,
  grabbedId: number,
  lane: string | null
): T[] {
  return list.map((c) => {
    if (!grpIds.includes(c.id)) return c
    return {
      ...c,
      tStart: Math.max(0, (base.get(c.id) ?? c.tStart) + shift),
      track: lane && c.id === grabbedId ? lane : c.track
    }
  })
}
