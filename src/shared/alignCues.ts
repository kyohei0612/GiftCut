// 聞き取った字幕の時刻を、**実際に喋っている所へ合わせ直す**。
//
// ## なぜ要るか
//
// Whisper が返す時刻は、文章としては正しくても**開始が揃わない**。
// 早めに始まったり、息継ぎのぶん遅れたりする。字幕としては
// 「声より先に出る」「声が終わってから出る」のどちらも目立つ。
//
// 実際、前に出した SRT が「開始位置がバラバラ」だった。文字起こしの精度ではなく、
// **時刻の当て方**の問題なので、音の側から測り直して合わせる。
//
// ## どう合わせるか
//
// 音から「無音の区間」を取り、その裏返しが「喋っている区間」。
// 各字幕を、いちばん重なっている喋りの区間へ**吸い付ける**。
//
//   ・開始 … その区間の始まり（声が出た瞬間）へ
//   ・終了 … その区間の終わり（声が切れた瞬間）へ
//
// **遠すぎる時は動かさない。** 近くに喋りが無いのに引き寄せると、
// 別の人の声や物音に貼り付いて、かえって大きくずれる。
//
// ## 触らない約束
//
//   ・前後の順番を入れ替えない
//   ・重ならない（重なると2枚同時に出て読めない）
//   ・短くしすぎない（一瞬で消える字幕は読めない）

export interface RawCue {
  start: number
  end: number
  text: string
}

export interface Silence {
  start: number
  /** 長さ（秒） */
  dur: number
}

export interface AlignOpts {
  /** ここより遠い所へは吸い付けない（秒） */
  maxShift?: number
  /** 字幕の最短の長さ（秒） */
  minDur?: number
  /** 字幕どうしの最小の間（秒）。詰まりすぎを防ぐ */
  gap?: number
  /**
   * カット点（切片の境目）。**無音より強い手がかり。**
   *
   * 切ったのは編集した本人で、たいてい「ここから話が始まる」という所で切っている。
   * 音から測った喋りの始まりは息継ぎや物音でぶれるが、カット点はぶれない。
   * 近くにカット点があれば、そちらを優先して合わせる。
   */
  cuts?: readonly number[]
  /** カット点へ吸い付ける距離（秒）。無音より狭くする（ぶれない印なので） */
  cutSnap?: number
}

/** 無音の裏返し＝喋っている区間 */
export function speechRanges(
  silences: readonly Silence[],
  total: number
): { start: number; end: number }[] {
  const sil = [...silences]
    .filter((s) => s.dur > 0 && Number.isFinite(s.start))
    .map((s) => ({ a: Math.max(0, s.start), b: Math.max(0, s.start + s.dur) }))
    .sort((p, q) => p.a - q.a)
  const out: { start: number; end: number }[] = []
  let cur = 0
  for (const s of sil) {
    if (s.a > cur) out.push({ start: cur, end: Math.min(s.a, total) })
    cur = Math.max(cur, s.b)
  }
  if (cur < total) out.push({ start: cur, end: total })
  return out.filter((r) => r.end > r.start)
}

/** 2つの区間の重なり（秒） */
function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

/**
 * 字幕を喋りの区間へ合わせ直す。
 *
 * @param total 音の長さ（秒）。区間を閉じるのに要る
 */
export function alignCues(
  cues: readonly RawCue[],
  silences: readonly Silence[],
  total: number,
  opts: AlignOpts = {}
): RawCue[] {
  const maxShift = opts.maxShift ?? 0.6
  const minDur = opts.minDur ?? 0.4
  const gap = opts.gap ?? 0.02
  const cuts = opts.cuts ?? []
  const cutSnap = opts.cutSnap ?? 0.35
  const ranges = speechRanges(silences, total)
  const out: RawCue[] = []
  let prevEnd = -Infinity
  for (const c of [...cues].sort((a, b) => a.start - b.start)) {
    let s = c.start
    let e = c.end
    // いちばん重なっている喋りの区間を選ぶ。重なりが無ければ一番近い物
    let best: { start: number; end: number } | null = null
    let bestScore = 0
    let nearest: { start: number; end: number } | null = null
    let nearestDist = Infinity
    for (const r of ranges) {
      const ov = overlap(s, e, r.start, r.end)
      if (ov > bestScore) {
        bestScore = ov
        best = r
      }
      const d = s < r.start ? r.start - s : s > r.end ? s - r.end : 0
      if (d < nearestDist) {
        nearestDist = d
        nearest = r
      }
    }
    const pick = best ?? (nearestDist <= maxShift ? nearest : null)
    if (pick) {
      // **遠い側は動かさない。** 近くに喋りが無いのに引き寄せると、
      // 別の音に貼り付いて、かえって大きくずれる
      if (Math.abs(pick.start - s) <= maxShift) s = pick.start
      if (Math.abs(pick.end - e) <= maxShift) e = pick.end
    }
    // **カット点があれば、そちらを優先。**
    // 切った本人が「ここから」と決めた所なので、音から測るよりぶれない。
    // 音の側で合わせたあとに当てるのは、カットの方を勝たせるため。
    if (cuts.length) {
      let near = -1
      let dist = Infinity
      for (const c2 of cuts) {
        const d = Math.abs(c2 - s)
        if (d < dist) {
          dist = d
          near = c2
        }
      }
      if (near >= 0 && dist <= cutSnap) s = near
    }
    // 順番と重なりを守る
    if (s < prevEnd + gap) s = prevEnd + gap
    if (e < s + minDur) e = s + minDur
    if (e > total) {
      e = total
      if (s > e - minDur) s = Math.max(0, e - minDur)
    }
    out.push({ start: s, end: e, text: c.text })
    prevEnd = e
  }
  return out
}
