// 動画クリップ・画像の「動き」（キーフレーム）。
//
// テロップのモーション（lib/telopStyle の Motion）と同じ考え方だが、**項目が違う**。
// クリップと画像で動かせるのは、いま `zoom { scale, x, y }` として持っている3つだけ:
//
//   拡大 … 1=そのまま。**1未満は打てない**（下の「なぜ1未満が無いのか」）
//   位置X / 位置Y … フレーム比の中心オフセット。寄っている中でどこを見せるか
//
// 回転と不透明度を入れていないのは、**書き出し側に時間で変える手が無い**ため。
// `rotate` の角度も `colorchannelmixer` の透明度も式を取らないので、入れると
// 「プレビューでは動くのに書き出すと動かない」になる。それは一番たちの悪いズレ。
//
// 値は**絶対値**で持つ（テロップは元の値との差だが、こちらは元の値と同じ単位なので
// そのまま入れられる）。⏱ を押した瞬間、いまの固定値でキーが1つ置かれる＝
// 見た目が変わらない、という素直な動きになる。
//
// 時刻は**クリップの先頭からの秒**（タイムライン上の絶対時刻ではない）。
// 絶対時刻で持つと、クリップを動かした瞬間に動きが置いていかれる。
//
// ## なぜ1未満（引く）が無いのか
//
// 書き出しで時間ごとに拡大率を変えられるのは `zoompan` だけで、これは1倍以上
// （寄る）しかできない。1未満を時間で変えるには元を先に大きく作る必要があり、
// 0.2倍まで許すと元を5倍（9600px）に拡大することになって重すぎる。
// 切り抜きの「話者にシュッと寄る」は1倍以上なので、実用上はここで足りる。
//
// **固定の zoom は今までどおり1未満にできる**（従来の scale+pad で焼く）。
// 打てないのは「動きのキー」だけ。

import { valueAt, hasKeys, sanitizeKeys, keyTimesOf, keysToExpr, type Keys } from './keyframes'

/**
 * 「拡大＋移動」を焼くフィルタ列。**等倍のままでも動く。**
 *
 * ## なぜ crop ではないのか（実際に出た不具合）
 *
 * 前は `scale=W*s:H*s, crop=W:H:(iw-W)/2-x*W:...` と書いていた。これは
 * 「大きくした絵の、どこを切り抜くか」で移動を表している。**拡大していない
 * （s=1）と切り抜く余地がゼロ**なので、crop の位置は 0 に丸められ、
 * X/Y をいくら動かしても絵は動かない。実測でも、s=1 では境目が動かず、
 * s=1.5 にした途端に効いた。「書き出すと画像がデフォ位置に戻る」の正体。
 *
 * ## 代わりにやること
 *
 * 先に**余白ごと広げた台紙**に置いてから、必要な所を切り出す。置き場所が
 * マイナスでも、切り出す側をずらせば表せるので、丸められない。
 *
 * 画面（CSS の `translate(x%,y%) scale(s)`、原点は中心）と同じ意味になる:
 *   出力(u,v) = 元画像( (u-ox)/s, (v-oy)/s )
 *   ox = (W - W*s)/2 + x*W,  oy = (H - H*s)/2 + y*H
 * 絵から外れた所は `bg`（重ねる物は透明、いちばん下の段は黒）。
 */
export function zoomPanChain(
  width: number,
  height: number,
  z: Zoom,
  /** 絵の外を何で埋めるか。重ねる物は 'black@0'（下の映像が見える） */
  bg: string
): string {
  const s = Math.max(0.05, z.scale)
  const zw = Math.round(width * s)
  const zh = Math.round(height * s)
  // 出力の左上を原点にした、絵の置き場所（マイナスもあり得る）
  const ox = Math.round((width - zw) / 2 + z.x * width)
  const oy = Math.round((height - zh) / 2 + z.y * height)
  // 台紙は「絵も、切り出す窓も、どちらも収まる」大きさにする。
  // 置き場所がマイナスのぶんだけ、切り出す側を右下へずらす。
  const cx = Math.max(0, -ox)
  const cy = Math.max(0, -oy)
  const px = ox + cx
  const py = oy + cy
  const pw = Math.max(px + zw, cx + width)
  const ph = Math.max(py + zh, cy + height)
  // **何もしない pad / crop は書かない。**
  //
  // 素通しの pad でも、ffmpeg はその大きさの絵をもう1枚確保して写す。
  // 寄りの強い切片では中間の絵が 4406×7834（1枚138MB）にもなるので、
  // 素通し1つで消費が倍になり、余裕の無いPCでは書き出しが落ちる。
  // 寄るだけ（動かさない）の切片は、これで今までと同じ列に戻る。
  const parts = [`scale=${zw}:${zh}`]
  if (pw !== zw || ph !== zh || px !== 0 || py !== 0) {
    parts.push(`pad=${pw}:${ph}:${px}:${py}:color=${bg}`)
  }
  if (cx !== 0 || cy !== 0 || pw !== width || ph !== height) {
    parts.push(`crop=${width}:${height}:${cx}:${cy}`)
  }
  parts.push('setsar=1')
  return parts.join(',')
}

export interface Zoom {
  scale: number
  x: number
  y: number
}

export interface ClipMotion {
  /** 拡大（1=そのまま）。1未満は打てない */
  sc?: Keys
  /** 横位置（フレーム比。右が＋） */
  x?: Keys
  /** 縦位置（フレーム比。下が＋） */
  y?: Keys
}

export const NEUTRAL_ZOOM: Zoom = { scale: 1, x: 0, y: 0 }

/** 動きのキーとして置ける最小の拡大率（zoompan が1倍以上しか扱えない） */
export const MIN_MOTION_SCALE = 1

export const hasClipMotion = (m?: ClipMotion): boolean =>
  !!m && (hasKeys(m.sc) || hasKeys(m.x) || hasKeys(m.y))

/**
 * その時刻の zoom。**印が1つも無ければ、今までの固定値をそのまま返す。**
 * プレビューも書き出しの式もここから作る（別々に計算するとズレる）。
 *
 * @param t クリップの先頭からの秒
 */
export function zoomAt(zoom: Zoom | undefined, m: ClipMotion | undefined, t: number): Zoom {
  const base = zoom ?? NEUTRAL_ZOOM
  if (!hasClipMotion(m)) return base
  return {
    // **動きが1つでも付いていれば、拡大は1で止める。**
    // 焼くのは zoompan で、これは1倍以上しか扱えない。位置だけ動かしたい人でも、
    // 引いたまま（0.5倍など）では焼けないので、画面の方を書き出しに合わせる。
    // 合わせないと「画面では小さいのに書き出すと大きい」になる。
    scale: Math.max(MIN_MOTION_SCALE, valueAt(m!.sc, t, base.scale)),
    x: valueAt(m!.x, t, base.x),
    y: valueAt(m!.y, t, base.y)
  }
}

/**
 * 書き出し（ffmpeg）の zoompan を組み立てる。**プレビューと同じ折れ線を式にする。**
 *
 * zoompan を使うのは「時間で拡大率を変えられる唯一のフィルタ」だから。
 * 代わりに使っていた `scale`＋`crop` は、切り出す**大きさ**に時間の式を書けない
 * （crop の w/h は最初に1回だけ評価される）。
 *
 * 座標の対応:
 *   切り出し窓は 幅 = W/s、左 = W/2 - W/(2s) - x*W/s。
 *   zoompan の x は「元の絵の座標での窓の左上」なので、そのまま式になる。
 *
 * ## 等倍のままでは動けない問題（zoomPanChain と同じ穴）
 *
 * zoompan も「大きい絵のどこを切り抜くか」で移動を表すので、拡大1.0では
 * 窓が絵と同じ大きさになり、位置は 0 に丸められて**まったく動かない**。
 * 「位置のキーだけ打った動き」がプレビューでは動くのに書き出すと止まっている、
 * という一番たちの悪いズレになる（実測で確認した）。
 *
 * そこで、**足りないぶんだけ台紙を広げてから** zoompan に渡す。広げた台紙の
 * 上では窓を動かす余地ができるので、丸められない。式そのものは iw/ih 基準の
 * ままで正しい（広げた台紙が iw/ih になるだけ）。拡大率だけ台紙の倍率を
 * 掛ける。動かす必要が無ければ広げない（今までどおりの重さ）。
 *
 * 注意（実際に測って分かったこと）:
 *   - zoompan は**出力の時刻を作り直す**（入れる前にずらしておいた時刻は消える）。
 *     重ねる物は、この後ろで置き直すこと
 *   - `s` の既定は hd720、`fps` の既定は 25。**両方必ず指定する**
 *   - 静止画は1枚しか入って来ないので、frames に「尺×fps」を渡して増やす
 */
export function zoompanFilter(
  zoom: Zoom | undefined,
  m: ClipMotion | undefined,
  o: {
    width: number
    height: number
    /** 秒を表す式。zoompan で使えるのは出力フレーム番号 on だけなので `on/30` の形 */
    timeExpr: string
    /** ffmpeg へ渡す fps 表記（30 や 30000/1001） */
    fpsArg: string
    /** 入力1フレームから何フレーム出すか（動画=1、静止画=尺×fps） */
    frames: number
    /** 広げた台紙の余白を何で埋めるか。既定は透明（重ねる物） */
    bg?: string
  }
): string {
  const base = zoom ?? NEUTRAL_ZOOM
  const t = o.timeExpr
  // 固定値も1で止める（zoomAt と同じ。画面と書き出しを一致させる）
  const z = keysToExpr(m?.sc, Math.max(MIN_MOTION_SCALE, base.scale), t)
  // 台紙を広げる量（フレーム比）。0 なら広げない
  const mg = padMarginFor(zoom, m)
  const mw = Math.ceil(mg * o.width)
  // 縦も同じ倍率にする（違うと窓の縦横比が狂って、わずかに伸びる）
  const mh = Math.round((mw * o.height) / o.width)
  const pw = o.width + 2 * mw
  const ph = o.height + 2 * mh
  const pre = mw > 0 ? `pad=${pw}:${ph}:${mw}:${mh}:color=${o.bg ?? 'black@0'},` : ''
  // 台紙を広げたぶん、同じ見た目にするには拡大率も同じ倍率だけ上げる
  const zExpr = mw > 0 ? `max(1,${z})*${(pw / o.width).toFixed(6)}` : `max(1,${z})`
  const xExpr = `iw/2-(iw/zoom/2)-(${keysToExpr(m?.x, base.x, t)})*iw/zoom`
  const yExpr = `ih/2-(ih/zoom/2)-(${keysToExpr(m?.y, base.y, t)})*ih/zoom`
  // 式にはカンマが入る（if(lt(t,1),a,b)）。フィルタの区切りと混ざらないよう ' で囲む
  const q = (s: string): string => `'${s.replace(/'/g, '')}'`
  return (
    pre +
    `zoompan=z=${q(zExpr)}:x=${q(xExpr)}:y=${q(yExpr)}` +
    `:d=${Math.max(1, Math.round(o.frames))}:s=${o.width}x${o.height}:fps=${o.fpsArg}`
  )
}

/**
 * zoompan に渡す前に台紙を広げる量（フレーム比）。**要るときだけ広げる。**
 *
 * zoompan の窓は絵の内側にしか置けない（外へ出ると端で丸められる）。
 * 拡大率 s・位置 x のとき、絵の座標での窓の左は `((1-s)/2 + x)/s`（フレーム比）で、
 * これが 0 未満なら左へはみ出し、`1/s - 1` を越えたら右へはみ出す。
 * どちらのはみ出し量も、そのぶん台紙を広げれば収まる。
 *
 * 印は折れ線なので、極値は必ず印の時刻にある。印の時刻だけ見れば足りる。
 * 上限を付けてあるのは、際限なく広げると1コマの絵が巨大になって焼けなくなるため
 * （1.5＝画面1枚半ぶん。完全に画面の外へ出すには十分）。
 */
function padMarginFor(zoom: Zoom | undefined, m: ClipMotion | undefined): number {
  const base = zoom ?? NEUTRAL_ZOOM
  const baseS = Math.max(MIN_MOTION_SCALE, base.scale)
  let need = 0
  for (const t of [0, ...clipMotionKeyTimes(m)]) {
    const s = Math.max(MIN_MOTION_SCALE, valueAt(m?.sc, t, baseS))
    for (const v of [valueAt(m?.x, t, base.x), valueAt(m?.y, t, base.y)]) {
      const left = (1 - s) / 2 + v // 窓の左（フレーム比）に s を掛けたもの
      need = Math.max(need, left / s, 1 / s - 1 - left / s)
    }
  }
  // 丸めで端に張り付かないよう、ほんの少し余分に取る
  return need > 0 ? Math.min(1.5, need + 0.01) : 0
}

/** 拡大の基準点（フレーム比。0..1。0.5/0.5 が真ん中） */
export interface Anchor {
  x: number
  y: number
}

export const CENTER_ANCHOR: Anchor = { x: 0.5, y: 0.5 }

/**
 * 「この点へ向かって寄る」を、**いまある位置（x/y）だけ**で表す。
 *
 * ## なぜ基準点を持ち物として増やさないのか
 *
 * 基準点を新しい持ち物にして、画面と書き出しの両方でそれを見る形にすると、
 * 画面は CSS の `transform-origin`、書き出しは `zoompan` の式——**同じことを
 * 2つの別々の式で書く**ことになる。この部門で一番たちの悪いズレ
 * （画面では正しく見えるのに書き出すと違う）にまっすぐ入る。
 *
 * そこで基準点は**画面だけの道具**にして、動かした結果をここで x/y に直す。
 * 書き出し側は今までどおり x/y を見るだけ＝**新しい式が1つも増えない。**
 *
 * ## 式
 *
 * 画面は「中心を原点に scale してから translate」（`zoomPanChain` の頭にある
 * 対応と同じ）。フレーム比 a の点は
 *
 *     a' = (a - 0.5) * s + 0.5 + x
 *
 * へ移る。その点が動かない（a' = a）ための x が答え:
 *
 *     x = (a - 0.5)(1 - s) = (0.5 - a)(s - 1)
 *
 * 等倍（s=1）では常に 0。**等倍では、どこを基準にしても絵は動かない。**
 */
export function zoomOffsetForAnchor(a: Anchor, scale: number): { x: number; y: number } {
  const k = scale - 1
  return { x: (0.5 - a.x) * k, y: (0.5 - a.y) * k }
}

/**
 * いまの zoom から基準点を逆に取る（マーカーを出すときの初期位置）。
 *
 * 等倍のときは真ん中を返す。上の式のとおり s=1 では x が常に 0 で、
 * **どこを基準にしていたかは絵に残っていない**（割り算の分母が 0）。
 */
export function anchorOfZoom(z: Zoom | undefined): Anchor {
  const base = z ?? NEUTRAL_ZOOM
  const k = base.scale - 1
  if (Math.abs(k) < 1e-6) return CENTER_ANCHOR
  return { x: 0.5 - base.x / k, y: 0.5 - base.y / k }
}

/** 保存ファイルから読み直すときの検査（壊れていたら「動き無し」に落とす。落ちない） */
export function sanitizeClipMotion(v: unknown): ClipMotion | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const sc = sanitizeKeys(o.sc)
  const m: ClipMotion = {
    // 古い保存や手書きで1未満が入っていても、打てない値は打てない値として直す
    sc: sc?.map((k) => ({ ...k, v: Math.max(MIN_MOTION_SCALE, k.v) })),
    x: sanitizeKeys(o.x),
    y: sanitizeKeys(o.y)
  }
  return hasClipMotion(m) ? m : undefined
}

/** そのクリップに打たれている印の時刻（クリップ先頭からの秒）。タイムラインに出す */
export function clipMotionKeyTimes(m?: ClipMotion): number[] {
  return m ? keyTimesOf(m.sc, m.x, m.y) : []
}
