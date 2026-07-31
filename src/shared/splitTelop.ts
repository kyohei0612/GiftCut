// 聞き取った文章を、テロップ1枚ぶんずつに割る。
//
// ## どこから来た規則か
//
// youtube-pipeline の `scripts/generate_subtitles.py` で実際に使っている割り方を
// そのまま持ってきた。**すでに動画を作り続けて確かめられている**ので、
// ここで新しく考え直す理由が無い。
//
//   ・1枚は 17 文字まで
//   ・切るのは**助詞の後ろ**（「〜が」「〜を」「〜けど」…）。単語の途中で切らない
//   ・切った残りが 5 文字未満になる位置では切らない（読めない断片を作らない）
//   ・最後に 5 文字未満が余ったら、前の1枚にくっつける
//
// ## なぜ文字数で切るのか
//
// 聞き取りは「話の切れ目」では区切ってくれない。長い文がそのまま1枚に乗ると、
// 画面からはみ出すか、読み終わる前に消える。**読める量**で割るのが先。

/** 1枚に載せる文字数の上限 */
export const MAX_CHARS = 17
/** これより短い断片は作らない（前にくっつける） */
const MIN_TAIL = 5

/**
 * 切ってよい場所（助詞）。**長いものから先に見る。**
 * 「て」で切ってしまうと「って」「けど」のような塊が割れる。
 */
const PARTICLES = [
  'って',
  'から',
  'ので',
  'けど',
  'ても',
  'では',
  'には',
  'て',
  'で',
  'に',
  'を',
  'が',
  'は',
  'も',
  'と'
] as const

/** 文の終わりで区切る（！？で切る。。、は空白にして読みやすくする） */
export function splitIntoSentences(text: string): string[] {
  const t = text.replace(/[。、]/g, ' ')
  const out: string[] = []
  let cur = ''
  for (const ch of t) {
    cur += ch
    if (ch === '！' || ch === '？' || ch === '!' || ch === '?') {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
    }
  }
  if (cur.trim()) out.push(cur.trim())
  return out.filter((s) => s.trim())
}

/** 17文字を超える文を、助詞の後ろで割る */
export function splitByParticle(text: string, maxChars = MAX_CHARS): string[] {
  const src = text.trim()
  if (!src) return []
  if ([...src].length <= maxChars) return [src]

  const out: string[] = []
  let rest = src
  // 進まなくなったら必ず抜ける（無限に回らないための保険）
  let guard = 0
  while ([...rest].length > maxChars && guard++ < 200) {
    let cutAt = -1
    // **後ろから探す。** 上限いっぱいまで詰めた方が枚数が減って読みやすい
    for (let pos = Math.min(maxChars, rest.length) - 1; pos > 3 && cutAt < 0; pos--) {
      for (const p of PARTICLES) {
        if (pos - p.length + 1 < 0) continue
        if (rest.slice(pos - p.length + 1, pos + 1) !== p) continue
        // 切った残りが短すぎる位置では切らない（読めない断片を作らない）
        if (rest.slice(pos + 1).trim().length < MIN_TAIL) continue
        cutAt = pos + 1
        break
      }
    }
    // **手前すぎる所では切らない。**
    //
    // 助詞は「て」「で」のように1文字の物があるので、後ろから探しても
    // ずっと手前で当たることがある。実際に聞き取りを流したら
    //   「これが入って」「たらびっくりしちゃうなと」
    // のように**語の途中で割れた**（「入ってたら」が2枚に裂けた）。
    // 上限の半分も使えない位置は、区切りとして信用しない。
    // 書き起こしは書き言葉と違って助詞が散らばるので、ここが効く。
    const MIN_USE = Math.floor(maxChars * 0.6)
    if (cutAt > 0 && cutAt < MIN_USE) cutAt = -1
    // 助詞が見つからなければ、上限で切る（切らずに伸ばすよりまし）。
    //
    // **ただし、余りが短くなりすぎない位置で切る。**
    // 素で上限いっぱいまで詰めると、余りが1〜2文字になり、下の
    // 「短い余りは前にくっつける」に拾われて**上限超えの札に戻る**。
    // 実測で18文字の札ができていた（17文字＋余り1文字）。
    if (cutAt <= 0) {
      const len = [...rest].length
      cutAt = len - maxChars < MIN_TAIL ? Math.max(1, len - MIN_TAIL) : maxChars
      if (cutAt > maxChars) cutAt = maxChars
    }
    out.push(rest.slice(0, cutAt).trim())
    rest = rest.slice(cutAt).trim()
  }
  if (rest.trim()) {
    const tail = rest.trim()
    const prev = out[out.length - 1]
    // 最後の余りが短ければ、前の1枚にくっつける。
    // **くっつけて上限を超えるならやらない**（超えた札を作る方が悪い）
    if ([...tail].length < MIN_TAIL && prev && [...(prev + tail)].length <= maxChars)
      out[out.length - 1] = prev + tail
    else out.push(tail)
  }
  return out.filter(Boolean)
}

/** 文章1つを、テロップ1枚ぶんずつに割る（文で区切ってから、長い物を助詞で割る） */
export function splitTelopText(text: string, maxChars = MAX_CHARS): string[] {
  return splitIntoSentences(text).flatMap((s) => splitByParticle(s, maxChars))
}

/**
 * **間（ま）で割る。** ここが一番大事。
 *
 * youtube-pipeline の品質記録に「テロップが音声より速く進んで違和感」という
 * 指摘があり（R-sync 違反）、原因は**1枚が1つの息継ぎ単位に対応していない**こと
 * だった。向こうは書き言葉の句読点から拍を推測するしかなかったが、
 * こちらは**本物の音がある**ので、実際に黙った所で割れる。
 *
 * 文字数で割るのはそのあと。間で割った1つが長すぎるときだけ、助詞で分ける。
 *
 * @param ranges 喋っている区間（無音の裏返し）
 */
export function splitAtPauses(
  cue: { start: number; end: number; text: string },
  ranges: readonly { start: number; end: number }[],
  maxChars = MAX_CHARS,
  /**
   * ここより短い間では割らない（秒）。
   *
   * **息継ぎでは割らない。** 実際に流したら 0.2 秒の間で
   *   「決してパ」「ソコンのフォルダに」
   * のように語が裂けた。話の切れ目は 0.35 秒くらい空くので、そこで線を引く。
   */
  minPause = 0.35
): { start: number; end: number; text: string }[] {
  const text = cue.text.trim()
  if (!text) return []
  // この字幕の中に入っている「喋りの区間」を拾う
  const raw = ranges
    .map((r) => ({ start: Math.max(r.start, cue.start), end: Math.min(r.end, cue.end) }))
    .filter((r) => r.end - r.start > 0.15)
    .sort((a, b) => a.start - b.start)
  // 短い間で隔てられた区間は、1つに戻す（そこは息継ぎで、話は切れていない）
  const inside: { start: number; end: number }[] = []
  for (const r of raw) {
    const prev = inside[inside.length - 1]
    if (prev && r.start - prev.end < minPause) prev.end = r.end
    else inside.push({ ...r })
  }
  // 区間が1つ（＝途中で黙っていない）なら、いつもどおり文字数で割る
  if (inside.length <= 1) return splitCue(cue, maxChars)

  // **時間の比で文字を配る。** どの文字がどの時刻かは分からないので、
  // これがいちばん外れが小さい（このあと開始を区間の頭へ吸い付ける）
  const totalSpan = inside.reduce((n, r) => n + (r.end - r.start), 0) || 1
  const chars = [...text]
  const out: { start: number; end: number; text: string }[] = []
  let used = 0
  inside.forEach((r, i) => {
    const share = (r.end - r.start) / totalSpan
    let take = i === inside.length - 1 ? chars.length - used : Math.round(chars.length * share)
    // **短すぎる断片は作らない。**
    // 時間の比で切ると、どうしても語の途中に線が来る。数文字しか取れない時は、
    // そこでは割らずに次へ送る（「こ」「れが入って…」のような裂け方を防ぐ）
    if (i < inside.length - 1 && take < MIN_TAIL) return
    if (chars.length - (used + take) < MIN_TAIL) take = chars.length - used
    const part = chars.slice(used, used + take).join('').trim()
    used += take
    if (!part) return
    // 間で割った1つが長ければ、その中だけ文字数で分ける
    out.push(...splitCue({ start: r.start, end: r.end, text: part }, maxChars))
  })
  // 配り残しがあれば最後へ足す（文字を落とさない）。
  //
  // **足したあと、もう一度長さを見る。** ここで素通ししていたため、
  // 上限17文字のはずが18文字の札ができていた（実測で1枚）。
  // 足す側だけ見て、足された側の長さを見ていなかった。
  if (used < chars.length && out.length) {
    const last = out[out.length - 1]
    const filled = { ...last, text: last.text + chars.slice(used).join('') }
    out.splice(out.length - 1, 1, ...splitCue(filled, maxChars))
  }
  return out.length ? out : splitCue(cue, maxChars)
}

/**
 * 1つの聞き取り結果（時刻付き）を、テロップ何枚かに割る。
 *
 * **時間は文字数で分ける。** 話す速さは一定ではないが、聞き取りは
 * 1枚ずつの時刻をくれないので、これがいちばん外れが小さい。
 * 最後に音の側（無音・カット点）で合わせ直すので、ここは目安でよい。
 */
export function splitCue(
  cue: { start: number; end: number; text: string },
  maxChars = MAX_CHARS
): { start: number; end: number; text: string }[] {
  const parts = splitTelopText(cue.text, maxChars)
  if (parts.length <= 1) return parts.length ? [{ ...cue, text: parts[0] }] : []
  const total = parts.reduce((n, p) => n + [...p].length, 0) || 1
  const span = Math.max(0, cue.end - cue.start)
  const out: { start: number; end: number; text: string }[] = []
  let t = cue.start
  for (const p of parts) {
    const d = (span * [...p].length) / total
    out.push({ start: t, end: t + d, text: p })
    t += d
  }
  // 端数で最後が縮まないよう、終わりは元の終わりに揃える
  if (out.length) out[out.length - 1].end = cue.end
  return out
}

/**
 * 続けて出る短すぎる札を、隣にくっつける。
 *
 * **1〜2文字だけの札は、読む前に消える。**
 * 実測（4分の実写・話し声）で「ラン」「ラ」のように語が裂けた札が7枚出た。
 * 出どころは1つではない——間で割った所、聞き取りが細かく刻んだ所——ので、
 * 割り方を直すより、**最後に均す**方が確実に効く。
 *
 * くっつけるのは**前の札と続いている物だけ**。間が空いている「これ」は、
 * 実際にそう言い切っただけかもしれないので触らない。
 *
 * @param minLen これ以下の文字数を短すぎるとみなす
 * @param gap    これ未満しか空いていなければ「続いている」とみなす（秒）
 */
export function mergeShreds<T extends { start: number; end: number; text: string }>(
  cues: readonly T[],
  maxChars = MAX_CHARS,
  minLen = 2,
  gap = 0.05
): T[] {
  const out: T[] = []
  for (const c of cues) {
    const prev = out[out.length - 1]
    const short = [...c.text.trim()].length <= minLen
    const cont = prev && c.start - prev.end < gap
    // くっつけて上限を超えるなら、そのままにする（超過は別の粗になる）
    const fits = prev && [...(prev.text + c.text)].length <= maxChars
    if (short && cont && fits) {
      out[out.length - 1] = { ...prev, end: c.end, text: prev.text + c.text }
      continue
    }
    out.push({ ...c })
  }
  return out
}

/**
 * 読む間もなく消える札を、少しだけ延ばす。
 *
 * **1枚が0.4秒しか出ないと、目が追いつく前に消える。**
 * 実測で「見 見た」が0.35秒だった。聞き取りが短く刻んだ所や、
 * 文字数の比で時間を配ったときの端で起きる。
 *
 * 延ばすのは**次の札にぶつからない範囲まで**。詰まっている所では諦める
 *（重ねると、2枚同時に出て読めなくなる方が悪い）。
 */
export function ensureMinShow<T extends { start: number; end: number }>(
  cues: readonly T[],
  min = 0.4
): T[] {
  return cues.map((c, i) => {
    if (c.end - c.start >= min) return { ...c }
    const next = cues[i + 1]
    const room = next ? next.start : Infinity
    return { ...c, end: Math.min(room, c.start + min) }
  })
}
