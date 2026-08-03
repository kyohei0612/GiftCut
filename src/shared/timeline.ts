// ============================================================================
// タイムラインの時間計算（純粋関数のみ）
//
// なぜ独立したモジュールなのか:
//   これまで「タイムライン秒 → ソース秒」「秒 → フレーム」「秒 → 波形バケット」の
//   変換が App.tsx の中に何箇所も別実装で散っていた。片方だけ直すと、もう片方が
//   ズレる。実際に起きた例:
//     - 波形を「動画の尺」で写像 → 音声ストリームとの尺差ぶん後ろほどズレる
//     - トリム量に速度を掛け忘れ → 倍速クリップの端がカーソルに追従しない
//   ここが唯一の変換元。React も Electron も import しないので、
//   `npm test` で不変条件を機械的に検証できる（timeline.test.ts）。
//
// 用語（混ぜると必ずズレるので、変数名でも区別する）:
//   tl  = タイムライン秒。ユーザーが見ている時間軸。速度で圧縮済み。
//   src = ソース秒。元動画ファイル内の時間。
//   両者の関係は  src = srcStart + (tl - tStart) * speed
// ============================================================================

/** 素材の fps が取れなかったときのフォールバック */
export const FPS_FALLBACK = 30

/** 長さ0の切片は扱えないので、これ未満は同一時刻とみなす */
export const EPS = 1e-6

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

// ---------------------------------------------------------------------------
// フレーム
// ---------------------------------------------------------------------------

/** fps を正規化（0/NaN/負値を弾く）。29.97 のような小数はそのまま保つ。 */
export function normFps(fps?: number | null): number {
  return typeof fps === 'number' && isFinite(fps) && fps > 0 ? fps : FPS_FALLBACK
}

/**
 * タイムライン秒をフレームグリッドに量子化する。
 * 分割/カット点をフレーム境界に揃えるため（±1F ズレ対策）。
 */
export function qFrame(t: number, fps?: number): number {
  const r = normFps(fps)
  return Math.round(t * r) / r
}

/**
 * HH:MM:SS:FF。fps は素材の実 fps。
 * Math.round(fps) で丸めるのは「表示するフレーム番号は整数でなければならない」ため。
 * 29.97 の素材は 30 フレーム目で秒が繰り上がる（ノンドロップフレーム表記）。
 */
export function formatTimecode(sec: number, fps?: number): string {
  const r = Math.max(1, Math.round(normFps(fps)))
  const tf = Math.max(0, Math.round(sec * r))
  const f = tf % r
  const ts = Math.floor(tf / r)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(Math.floor(ts / 3600))}:${p(Math.floor(ts / 60) % 60)}:${p(ts % 60)}:${p(f)}`
}

// ---------------------------------------------------------------------------
// 切片（VSeg）のレイアウト
// ---------------------------------------------------------------------------

/**
 * 時間計算に必要な最小限の切片。App の VSeg はこれを構造的に満たすので、
 * そのまま渡せる（このモジュールが VSeg の全フィールドを知る必要はない）。
 */
export interface TimeSeg {
  srcStart: number
  srcEnd: number
  /** 再生速度。1=等速, 2=2倍速, 0.5=スロー。未指定/不正は 1 */
  speed?: number
  /** 次の切片との間のクロスディゾルブ */
  xfade?: { dur: number } | null
}

/** 切片1つのタイムライン上の位置。seg の具体型は保たれる（Layout<VSeg> になる）。 */
export interface Layout<S extends TimeSeg = TimeSeg> {
  seg: S
  index: number
  /** タイムライン上の長さ（秒） */
  len: number
  tStart: number
  tEnd: number
}

/** 切片の速度。未指定/0以下は 1（0除算とマイナス長を防ぐ） */
export function segSpeed(s: TimeSeg): number {
  return s.speed && s.speed > 0 ? s.speed : 1
}

/** タイムライン上の長さ = ソース尺 / 速度 */
export function segTLen(s: TimeSeg): number {
  return Math.max(0, s.srcEnd - s.srcStart) / segSpeed(s)
}

/**
 * 重ねた動画クリップ（V2以降・映像レイヤー）の長さ。**下限 0.05秒。**
 *
 * 切片（`segTLen`）と違って速度を持たず、0 まで縮めさせない。0 にすると
 * ffmpeg の trim が空になって枝ごと成立しなくなる／帯が消えて掴めなくなる。
 *
 * ## ここに置いた理由（2026-08-03）
 *
 * **同じ式が13か所に散っていた。** `noDuplicate.test.ts` の言うとおり、
 * 原因は「`vcLen` が `useTrackGeom` にあって **props で配られている**」こと——
 * import では取れないので、書く瞬間に存在が見えない。実際 `LeftPanel.tsx` は
 * props で受け取っておきながら**同じ名前のローカル定数に生の式を書いて影を作っていた**。
 *
 * 書き出し側（`main/`）からは props すら届かないので、まずここへ置いた。
 * 画面側の13か所は順次ここへ寄せる（寄せたら `noDuplicate.test.ts` の debt も減らす）。
 */
export function vcLen(c: { srcStart: number; srcEnd: number }): number {
  return Math.max(0.05, c.srcEnd - c.srcStart)
}

/**
 * 切片列 → 位置つきレイアウト。切片は常に隙間なく連続して並ぶ（リップル前提）。
 * 前から累積するので tEnd[i] === tStart[i+1] が常に成り立つ。
 */
export function layoutSegs<S extends TimeSeg>(segs: readonly S[]): Layout<S>[] {
  let acc = 0
  return segs.map((seg, index) => {
    const len = segTLen(seg)
    const l: Layout<S> = { seg, index, len, tStart: acc, tEnd: acc + len }
    acc += len
    return l
  })
}

/** 全切片の合計長（タイムライン秒） */
export function totalSegLen(segs: readonly TimeSeg[]): number {
  return segs.reduce((a, s) => a + segTLen(s), 0)
}

/**
 * 切片 i と i+1 の間のクロスディゾルブの実効長（秒）。0なら無効。
 * B 側がタイムラインより d 秒早くフェードインする方式のため、
 * d は A/B のタイムライン長と「B のソース頭の余白（srcStart/速度）」でクランプする。
 * 編集でトリムされて余白が減っても、ここで動的に安全な長さへ縮む。
 */
export function xfadeDurAt(layout: readonly Layout[], i: number): number {
  const A = layout[i]
  const B = layout[i + 1]
  if (!A?.seg.xfade || !B) return 0
  let d = Math.min(A.seg.xfade.dur, A.len, B.len)
  // 音声も同じ余白を使うので、映像を黒にしている区間でも必要
  d = Math.min(d, B.seg.srcStart / segSpeed(B.seg))
  return d > 0.01 ? d : 0
}

/** tToSource の戻り値 */
export interface SourceAt {
  /** ソース秒（元動画ファイル内の時間） */
  srcTime: number
  index: number
  speed: number
}

/**
 * タイムライン秒 t → ソース秒。切片の外なら null。
 * 末尾ちょうど（t === total）は最後の切片の srcEnd を返す（再生終端の扱い）。
 */
export function tToSource(layout: readonly Layout[], t: number): SourceAt | null {
  for (const L of layout) {
    if (t >= L.tStart && t < L.tEnd) {
      return {
        srcTime: L.seg.srcStart + (t - L.tStart) * segSpeed(L.seg),
        index: L.index,
        speed: segSpeed(L.seg)
      }
    }
  }
  const last = layout[layout.length - 1]
  if (last && t >= last.tEnd - EPS) {
    return { srcTime: last.seg.srcEnd, index: last.index, speed: segSpeed(last.seg) }
  }
  return null
}

/**
 * tToSource の逆変換。ソース秒 → タイムライン秒。
 *
 * これが無いと「ソース側で計算した量をタイムラインに戻す」処理を各所で手書きし、
 * 速度の掛け忘れ（÷speed し忘れ）が起きる。逆変換をここに置いて
 * 往復テスト（tl → src → tl が元に戻る）で守る。
 */
export function sourceToT(layout: readonly Layout[], index: number, srcTime: number): number | null {
  const L = layout[index]
  if (!L) return null
  return L.tStart + (srcTime - L.seg.srcStart) / segSpeed(L.seg)
}

// ---------------------------------------------------------------------------
// 切片の配置・移動（プレミアの「上書き」）
// ---------------------------------------------------------------------------

/**
 * 切片を分割したときの断片を作るコールバック。
 *
 * 「どのフィールドを引き継ぎ、どれを捨てるか」（id の採番、トランジションや
 * 音声フェードの扱い）は VSeg 側の都合なので、ここでは知らないままにする。
 */
export type SplitSeg<S> = (s: S, part: 'head' | 'tail', srcStart: number, srcEnd: number) => S

/** 移動・配置に必要な、切片の作り方（VSeg の具体的な形はここでは知らない） */
export interface SegOps<S extends TimeSeg> {
  split: SplitSeg<S>
  /** 指定した長さの空白切片（映像なし・無音）を作る */
  makeGap: (len: number) => S
  /** その切片が空白か */
  isGap: (s: S) => boolean
}

/**
 * タイムライン範囲 [tA, tB) を切り出して除去した切片配列を返す。
 * insertAt = 除去した所へ新しい切片を挿す配列 index。
 * 端にかかる切片は速度を考慮してトリムする（倍速クリップで切り口がズレないように）。
 */
export function cutRange<S extends TimeSeg>(
  segs: readonly S[],
  tA: number,
  tB: number,
  split: SplitSeg<S>
): { out: S[]; insertAt: number } {
  const out: S[] = []
  let insertAt = -1
  for (const L of layoutSegs(segs)) {
    const s = L.seg
    const sp = segSpeed(s)
    if (L.tEnd <= tA + EPS) {
      out.push(s) // 完全に範囲より前
      continue
    }
    if (L.tStart >= tB - EPS) {
      if (insertAt < 0) insertAt = out.length
      out.push(s) // 完全に範囲より後
      continue
    }
    if (L.tStart < tA - EPS) out.push(split(s, 'head', s.srcStart, s.srcStart + (tA - L.tStart) * sp))
    if (insertAt < 0) insertAt = out.length
    if (L.tEnd > tB + EPS) out.push(split(s, 'tail', s.srcStart + (tB - L.tStart) * sp, s.srcEnd))
  }
  if (insertAt < 0) insertAt = out.length
  return { out, insertAt }
}

/**
 * 末尾の空白を落とし、隣り合う空白を1つにまとめ、長さ0の切片を捨てる。
 *
 * 移動のたびに空白が積み上がると、配列がいくらでも伸びて
 * タイムラインの尺が実際の中身より長いまま戻らなくなる。
 */
export function tidyGaps<S extends TimeSeg>(segs: readonly S[], ops: SegOps<S>): S[] {
  const out: S[] = []
  for (const s of segs) {
    if (segTLen(s) <= EPS) continue
    const prev = out[out.length - 1]
    if (ops.isGap(s) && prev && ops.isGap(prev)) {
      out[out.length - 1] = ops.makeGap(segTLen(prev) + segTLen(s))
      continue
    }
    out.push(s)
  }
  while (out.length && ops.isGap(out[out.length - 1])) out.pop()
  return out
}

/**
 * 切片を「時間方向に」移動する（プレミアのクリップドラッグ＝上書き配置）。
 *
 * 元いた場所は同じ長さの空白に置き換えるので、**他のクリップの位置は動かない**。
 * 置いた先に既にクリップがあれば、その区間は上書きされる（端にかかる分はトリム）。
 * 末尾より先に置いた場合は手前を空白で埋める。
 *
 * 以前この操作は「配列の並べ替え」として実装されていて、少し掴んだだけで切片の
 * 順序が入れ替わり、再生時に巨大シークを起こしていた。そのため長らく無効化されて
 * いたが、無効化のままでは置いたクリップを一切動かせない。時間方向の移動として
 * 定義し直せば並びは時間順のまま保たれる。
 */
export function moveSegTo<S extends TimeSeg>(
  segs: readonly S[],
  segIndex: number,
  newTStart: number,
  ops: SegOps<S>
): S[] {
  const lay = layoutSegs(segs)
  const L = lay[segIndex]
  if (!L || L.len <= EPS) return segs as S[]
  const t = Math.max(0, newTStart)
  if (Math.abs(t - L.tStart) < 1e-4) return segs as S[]
  // 元の位置を同じ長さの空白へ差し替える（周りの位置を保つ）
  const withGap = segs.map((s, i) => (i === segIndex ? ops.makeGap(L.len) : s))
  const total = totalSegLen(withGap)
  if (t >= total - 1e-3) {
    const out = [...withGap]
    if (t - total > EPS) out.push(ops.makeGap(t - total))
    out.push(L.seg)
    return tidyGaps(out, ops)
  }
  const { out, insertAt } = cutRange(withGap, t, Math.min(t + L.len, total), ops.split)
  out.splice(insertAt, 0, L.seg)
  return tidyGaps(out, ops)
}

/**
 * 複数の切片を、まとめて同じ量だけ時間方向にずらす（相対位置は保つ）。
 *
 * 全部いっぺんに空白へ差し替えてから置き直すのが要点。1つずつ moveSegTo を
 * 繰り返すと、1つ動かすたびに他の切片の index と位置が変わってしまい、
 * 2つ目以降が狙いと違う場所へ飛ぶ。
 *
 * 置き直しは前から順に上書き。上書きは配列全体の長さを変えないので、
 * 先に置いたものが後の目標位置をずらすことはない。
 */
export function moveSegsTo<S extends TimeSeg>(
  segs: readonly S[],
  segIndices: readonly number[],
  shift: number,
  ops: SegOps<S>
): S[] {
  const lay = layoutSegs(segs)
  // 元の位置の昇順で処理する（重なったときに前のものが先に置かれる＝見た目と一致）
  const picked = [...new Set(segIndices)]
    .filter((i) => lay[i] && lay[i].len > EPS)
    .sort((a, b) => lay[a].tStart - lay[b].tStart)
  if (!picked.length) return segs as S[]
  if (picked.length === 1) return moveSegTo(segs, picked[0], lay[picked[0]].tStart + shift, ops)
  // 端に当たって潰れないよう、実際にずらせる量へ丸める（相対位置を保つため全員同じ量）
  const minStart = Math.min(...picked.map((i) => lay[i].tStart))
  const d = Math.max(shift, -minStart)
  if (Math.abs(d) < 1e-4) return segs as S[]
  // 選んだ切片を一斉に空白へ（周りの位置は動かない）
  const set = new Set(picked)
  let out: S[] = segs.map((s, i) => (set.has(i) ? ops.makeGap(lay[i].len) : s))
  for (const i of picked) {
    const L = lay[i]
    const t = Math.max(0, L.tStart + d)
    const total = totalSegLen(out)
    if (t >= total - 1e-3) {
      if (t - total > EPS) out.push(ops.makeGap(t - total))
      out.push(L.seg)
      continue
    }
    const r = cutRange(out, t, Math.min(t + L.len, total), ops.split)
    r.out.splice(r.insertAt, 0, L.seg)
    out = r.out
  }
  return tidyGaps(out, ops)
}

// ---------------------------------------------------------------------------
// リップルトリム（前の編集点／次の編集点まで詰めて削除）
// ---------------------------------------------------------------------------

/**
 * from と to の内側（両端は含まない）にある編集点だけを返す。
 * 編集点＝カット点のほか、テロップ・画像・SE・映像レイヤーの端。
 */
export function edgesBetween(
  edges: readonly number[],
  from: number,
  to: number,
  eps = 1e-3
): number[] {
  return edges.filter((v) => v > from + eps && v < to - eps)
}

/**
 * 前方リップルトリムで削除を始める位置。
 *
 * 切片の頭まで一気に詰めると、途中にあったテロップが巻き添えで消える。
 * 途中に編集点があればそこで止める（一番再生ヘッドに近いもの）。
 * 例: 切片頭0・テロップ[2,5]・再生ヘッド8 → 5 を返す（[5,8] だけ削る）。
 */
export function rippleStart(
  segStart: number,
  playhead: number,
  edges: readonly number[]
): number {
  const inner = edgesBetween(edges, segStart, playhead)
  return inner.length ? Math.max(...inner) : segStart
}

/**
 * 後方リップルトリムで削除を終える位置。
 * 例: 再生ヘッド3・テロップ[5,7]・切片尻10 → 5 を返す（[3,5] だけ削る）。
 */
export function rippleEnd(playhead: number, segEnd: number, edges: readonly number[]): number {
  const inner = edgesBetween(edges, playhead, segEnd)
  return inner.length ? Math.min(...inner) : segEnd
}

// ---------------------------------------------------------------------------
// リップル削除（消して、同じトラックの後続を詰める）
// ---------------------------------------------------------------------------

/** リップル削除で消した区間（どのトラックの、どこからどこまで） */
export interface RippleHole {
  track: string
  start: number
  end: number
}

/**
 * リップル削除したあとの位置を返す。
 *
 * 詰まるのは「**同じトラック**の、消した区間より後ろにあるもの」だけ。
 * トラックを見ずに詰めると、V2 のテロップを消したのに V3 のテロップまでずれる。
 *
 * 複数消したときは、後ろの穴から順に見ないと「詰めたあとの座標」と
 * 「元の座標」を比べることになり、詰め量が壊れる。
 */
export function rippleShifted(holes: readonly RippleHole[], track: string, t: number): number {
  let v = t
  for (const h of [...holes].sort((a, b) => b.start - a.start)) {
    if (h.track === track && v >= h.end - EPS) v -= h.end - h.start
  }
  return Math.max(0, v)
}

// ---------------------------------------------------------------------------
// 波形
// ---------------------------------------------------------------------------

/**
 * ソース秒 → 波形バケットのインデックス（小数）。
 *
 * audioDur は「波形を解析した音声そのものの長さ」でなければならない。
 * 動画の尺やコンテナの尺を渡すと、音声ストリームとの尺差ぶん位置が比例してズレる
 * （後ろに行くほど再生ヘッドと合わなくなる）。実測例: 映像/音声/コンテナが揃って
 * 35.300 秒と申告するファイルで、実デコードした音声は 35.3067 秒だった。
 */
export function waveIndexAt(srcTime: number, audioDur: number, buckets: number): number {
  if (!(audioDur > 0) || buckets <= 0) return 0
  return (srcTime / audioDur) * buckets
}

// ---------------------------------------------------------------------------
// 音声フェード
// ---------------------------------------------------------------------------

/**
 * クリップ内ローカル秒 t におけるフェード係数（0..1）。
 * イン/アウトが重なる場合は小さい方を採る（両方掛けると谷が深くなりすぎる）。
 */
export function fadeGain(t: number, len: number, fadeIn?: number, fadeOut?: number): number {
  let g = 1
  if (fadeIn && fadeIn > 0 && t < fadeIn) g = Math.min(g, t / fadeIn)
  const outStart = len - (fadeOut ?? 0)
  if (fadeOut && fadeOut > 0 && t > outStart) g = Math.min(g, (len - t) / fadeOut)
  return clamp(g, 0, 1)
}
