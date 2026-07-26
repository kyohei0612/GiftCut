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
