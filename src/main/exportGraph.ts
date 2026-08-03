// 書き出しの**フィルタグラフを組む側**。ここは文字列を組み立てるだけで、
// ffmpeg も electron も呼ばない（走らせるのは ./exportSpawn、受け口は ./exportRun）。
//
// ## いちばん怖い壊れ方
//
// **画面で正しく見えても、書き出すと違う。** しかもやり直しに何分もかかるので
// 気づくのが遅い。だから**画面と同じ計算を通す**こと——動き（キーフレーム）は
// `shared/clipMotion`、テロップの出る窓は `shared/filterGraph` の
// `overlayEnableExpr`。ここで別の式を書き起こさない（別々に書くと必ずズレる）。
//
// ## 重なり順（下から）
//
//   本編の映像 → 映像レイヤー(V2以降) → 画像 → テロップ
//
// 積む先は `last` というラベル1本で持ち回る。**各段は「自分の分の文字列」と
// 「次に積む先のラベル」を返す**——`filter` を外から書き換える形にすると、
// どこで何段積まれたのかが読めなくなる。
//
// ## 中身
//
// **共通の小道具**
//
// - `cropFilter` … 切り抜き。切った領域は下の段なら黒、重ねる段なら透明
// - `needsEq` … 色調整が要るか（1に近ければ何も挟まない）
// - `opacityFilter` … 不透明度。1（既定）なら何も挟まない
//
// **重ねる段（[base] の上へ1段ずつ）**
//
// - `overlayVideoClips` … 映像レイヤー（V2以降の動画）を重ねる
// - `overlayImages` … 画像クリップを重ねる（テロップより下）
// - `overlayTelopSeqs` … 連番でまとめたテロップを重ねる（1本＝1段）
// - `overlayTelopFrames` … 1枚ずつのテロップを重ねる。最後が `[v]`
// - `buildOverlays` … `[base]` を作って上の4つを下から順に積む
//
// **本編の切片（V1）を並べる**
//
// - `xfadeDurOf` … ペア (i, i+1) の実効ディゾルブ長。**映像側と音声側の両方が通る**
// - `isDipT` … 沈んで戻る系（ディゾルブ/黒/白）か
// - `dipCol` … ディップの色
// - `motionName` … 頭/尻 slide/wipe の xfade 名
// - `betweenName` … 間 xfade の名前（黒/白ディップは fadeblack/fadewhite）
// - `motionIn` … 頭が slide/wipe で入るか（間のディゾルブがあればそちらが勝つ）
// - `motionOut` … 尻が slide/wipe で出るか
// - `scalePadFilter` … 出力解像度へ揃える定型（連結の前に全切片を同じ大きさにする）
// - `buildSegmentVideo` … `[sv i]` を作って `[vcat]` へ連結する
// - `buildSegmentAudio` … `[sa i]` を作って `[acat]` へ連結する
// - `buildSegments` … 上の2つを呼んで、ベース映像のラベルと -map を返す
//
// **音を混ぜる**
//
// - `buildAudioMix` … 効果音と映像レイヤーの音をベース音声に混ぜ、
//   最後にラウドネスを揃える。**効果音が1本も無くても通す**
import { overlayEnableExpr } from '../shared/filterGraph'
import { hasClipMotion, zoomPanChain, zoompanFilter, type ClipMotion } from '../shared/clipMotion'
import { colorAdjustFilter } from '../shared/colorAdjust'
// 時間の計算は shared/timeline が正典。**ここで書き起こさない**——
// 2026-08-03 に、切片の長さの写しから正典の Math.max(0, …) が抜けていて
// 「画面は0で止まるのに書き出しだけ負の長さ」になっていた（同じ式が3か所）。
// vcLen も同じ型で、いまも13か所に散っている（noDuplicate.test.ts の debt）
import { segSpeed, segTLen, vcLen } from '../shared/timeline'

/** 各辺の切り抜き率（切った領域は黒、重ねる段では透明） */
export interface ExportCrop {
  l: number
  t: number
  r: number
  b: number
}
/** 色調整（明るさ/コントラスト/彩度） */
export interface ExportAdjust {
  b: number
  c: number
  s: number
}
/** リフレーム（拡大率と、フレーム比の中心オフセット） */
export interface ExportZoom {
  scale: number
  x: number
  y: number
}

/** テロップ1枚とその表示窓 */
export interface ExportFrame {
  png: string
  start: number
  end: number
}

export interface ExportSeg {
  srcIdx?: number // 入力（元動画）index。マルチソース。未指定=0
  srcStart: number
  srcEnd: number
  muted?: boolean
  videoBlank?: boolean
  speed?: number
  transIn?: { type: string; dur: number } // 頭
  transOut?: { type: string; dur: number } // 尻
  xfade?: { type: string; dur: number } // 次の切片との間
  adjust?: ExportAdjust
  rotate?: number // 回転（90/180/270 or 自由角度）
  flipH?: boolean
  flipV?: boolean
  vol?: number // 音量倍率
  afadeIn?: number // 音声フェードイン秒
  afadeOut?: number // 音声フェードアウト秒
  zoom?: ExportZoom // リフレーム（切片ごと）
  motion?: ClipMotion // 動き（キーフレーム）。付いていれば zoom は時間で変わる
  crop?: ExportCrop
}

export interface ExportSEClip {
  path: string
  tStart: number
  duration: number
  srcOffset?: number // 音源内の開始オフセット（左端トリム/分割）
  volume?: number
  fadeIn?: number
  fadeOut?: number
  /**
   * 声が入っている間だけ下げるための音量式（ffmpeg の volume に渡す）。
   * プレビューで使っている折れ線をそのまま式にしたもの。
   */
  duckExpr?: string
}

/** 画像クリップ（テロップの下に重ねる）。変形/調整は動画切片と同じモデル */
export interface ExportImageClip {
  path: string
  tStart: number
  duration: number
  zoom?: ExportZoom
  motion?: ClipMotion
  rotate?: number
  flipH?: boolean
  flipV?: boolean
  opacity?: number
  adjust?: ExportAdjust
  crop?: ExportCrop
}

/** 映像レイヤークリップ（V2以降に置いた動画。本編映像の上に重ねる。音声もミックスする） */
export interface ExportVClip {
  path: string
  tStart: number
  srcStart: number
  srcEnd: number
  zoom?: ExportZoom
  motion?: ClipMotion
  rotate?: number
  flipH?: boolean
  flipV?: boolean
  opacity?: number
  adjust?: ExportAdjust
  crop?: ExportCrop
  volume?: number
  fadeIn?: number
  fadeOut?: number
}

/**
 * 連番でまとめて受け取るテロップ。**書き出しの速さはここで決まる。**
 *
 * 1枚＝入力1つ＋重ね1段だと、枚数に比例して遅くなる（1080p60秒の実測で
 * 0枚 5.1秒 / 200枚 10.7秒 / 600枚 23.3秒）。同じ600枚を連番1入力＋重ね1段に
 * すると 5.2秒＝重ねないのとほぼ同じになる。
 *
 * ここへ来るのは**等間隔で全区間を刻んでいる物だけ**（画面側が並びを見て決める）。
 * 頭と尻の演出だけのテロップは真ん中に長い静止区間があるので `frames` の方へ来る。
 */
export interface ExportTelopSeq {
  start: number
  end: number
  fps: number
  pngs: string[]
}

export interface ExportPayload {
  videoPath: string
  sources?: { path: string }[] // マルチソース。入力に使う元動画一覧（未指定なら[videoPath]）
  images?: ExportImageClip[]
  vClips?: ExportVClip[]
  width: number
  height: number
  frames: ExportFrame[]
  extendSec?: number
  segments?: ExportSeg[]
  seClips?: ExportSEClip[]
  baseAudioVolume?: number
  loudnormLUFS?: number | null
  totalDurationSec?: number // 進捗%算出用の出力尺
  fps?: number // 書き出しフレームレート（既定30）
  crf?: number // 画質（x264 CRF。小さいほど高画質。既定23）
  telopSeqs?: ExportTelopSeq[]
  /**
   * 出す先（フルパス）。**画面側で決まっているなら、ここで聞き直さない。**
   *
   * 書き出しの窓で「どこへ・どの名前で」を決めてから押す作りにしたので、
   * そのあとにもう一度ファイル選択が出ると二度手間になる。
   * 無いときだけ今までどおり選択の窓を出す（画面側が決められなかった場合の逃げ道）。
   */
  outPath?: string
}

/** 重ねる段が共通で要る物。**この4つは全部の段で同じ値**（食い違うと段ごとに絵がずれる） */
export interface OverlayCtx {
  width: number
  height: number
  outFps: number
  fpsArg: string
  /** 入力ラベルを1本借りる（何本に split するかは組み終わってから数える） */
  useV: (idx: number) => string
  /** 入力 -ss を付けたぶん trim を前へずらす量 */
  ssOffsetOf: (idx: number, wantSec: number, audioUsed: boolean) => number
}

/** 1段積んだ結果。`last` は次に積む先のラベル */
export interface OverlayStep {
  filter: string
  last: string
}

/**
 * 切り抜き。各辺を内側へ切り込み、切った領域は `bg` で埋める（枠サイズは不変）。
 *
 * **重ねる段は透明**（下の映像が見える＝プレビューと一致）、
 * **いちばん下の段（本編の切片）は黒**（透ける先が無い）。
 */
function cropFilter(
  c: ExportCrop | undefined,
  width: number,
  height: number,
  bg = 'black@0'
): string {
  if (!c || !(c.l > 1e-4 || c.t > 1e-4 || c.r > 1e-4 || c.b > 1e-4)) return ''
  const cl = Math.min(0.9, Math.max(0, c.l))
  const ct = Math.min(0.9, Math.max(0, c.t))
  const crg = Math.min(0.9, Math.max(0, c.r))
  const cb = Math.min(0.9, Math.max(0, c.b))
  const cw = Math.max(2, Math.round(width * (1 - cl - crg)))
  const ch = Math.max(2, Math.round(height * (1 - ct - cb)))
  const cx = Math.round(width * cl)
  const cy = Math.round(height * ct)
  return `,crop=${cw}:${ch}:${cx}:${cy},pad=${width}:${height}:${cx}:${cy}:color=${bg},setsar=1`
}

/** 色調整が要るか（1に近ければ何もしない＝無駄なフィルタを挟まない） */
function needsEq(a: ExportAdjust | undefined): boolean {
  return (
    !!a &&
    (Math.abs(a.b - 1) > 1e-3 || Math.abs(a.c - 1) > 1e-3 || Math.abs(a.s - 1) > 1e-3)
  )
}

/** 不透明度。1（既定）なら何も挟まない */
function opacityFilter(opacity: number | undefined): string {
  return opacity != null && opacity < 1
    ? `,colorchannelmixer=aa=${Math.max(0, opacity).toFixed(3)}`
    : ''
}

/**
 * 映像レイヤー（V2以降の動画）を本編映像の上に重ねる。
 * テロップ・画像より先に合成する＝重なり順は 本編 → 映像レイヤー → 画像 → テロップ。
 */
export function overlayVideoClips(
  ctx: OverlayCtx,
  vcs: ExportVClip[],
  vcInput: number[],
  vcHasAudio: boolean[],
  from: string
): OverlayStep {
  const { width, height, outFps, fpsArg, useV, ssOffsetOf } = ctx
  let filter = ''
  let last = from
  vcs.forEach((vc, k) => {
    const idx = vcInput[k]
    const vEndT = vc.tStart + vcLen(vc)
    // 反転 → 出力サイズへフィット → 回転（枠サイズ固定）→ ズーム → クロップ → 色調整 → 不透明度
    let xf = ''
    if (vc.flipH) xf += ',hflip'
    if (vc.flipV) xf += ',vflip'
    const rot = ((Math.round(vc.rotate ?? 0) % 360) + 360) % 360
    let rotF = ''
    if (rot !== 0) {
      const rad = ((rot * Math.PI) / 180).toFixed(5)
      const bl = rot % 90 === 0 ? ':bilinear=0' : ''
      rotF = `,rotate=${rad}:ow=iw:oh=ih:fillcolor=black@0${bl}`
    }
    let zm = ''
    const z = vc.zoom
    if (hasClipMotion(vc.motion)) {
      // 重ねる動画の動き。**zoompan は出力の時刻を作り直す**ので、
      // 先に付けておいた「タイムライン上の開始時刻」が消える。後ろで置き直す。
      // 前に fps= を挟むのは、素材が24fpsでも on/fps が秒になるようにするため。
      zm =
        `,fps=${fpsArg},` +
        zoompanFilter(z, vc.motion, {
          width,
          height,
          timeExpr: `on/${outFps}`,
          fpsArg,
          frames: 1
        }) +
        `,setpts=PTS-STARTPTS+${vc.tStart.toFixed(3)}/TB,format=rgba,setsar=1`
    } else if (z && (Math.abs(z.scale - 1) > 1e-3 || z.x !== 0 || z.y !== 0)) {
      // 重ねる段。絵から外れた所は透明（下の映像が見える）
      zm = ',' + zoomPanChain(width, height, z, 'black@0')
    }
    const cr = cropFilter(vc.crop, width, height)
    const adj = vc.adjust
    const hasEq = needsEq(adj)
    const op = opacityFilter(vc.opacity)
    // trim で必要区間だけ取り出し、setpts で「タイムライン上の開始時刻」へずらす。
    // これで overlay の enable 窓と実フレームの時刻が一致する。
    // このクリップの音声をミックスに入れるか（音声ループの除外条件と同じ）
    const aUsed = (vc.volume ?? 1) > 0 && !!vcHasAudio[k]
    const off = ssOffsetOf(idx, vc.srcStart, aUsed) // 入力 -ss を付けたぶん trim を前へずらす
    const geom =
      `trim=start=${(vc.srcStart - off).toFixed(3)}:end=${(vc.srcEnd - off).toFixed(3)},` +
      `setpts=PTS-STARTPTS+${vc.tStart.toFixed(3)}/TB,format=rgba${xf},` +
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1${rotF}${zm}${cr}`
    if (hasEq) {
      // 色調整はアルファ非対応（YUV で計算する）なので、透明を退避して後で戻す
      const eqf = colorAdjustFilter(adj)
      filter += `${useV(idx)}${geom},split[vg${k}a][vg${k}b];`
      filter += `[vg${k}a]alphaextract[va${k}];`
      filter += `[vg${k}b]${eqf}[vcc${k}];`
      filter += `[vcc${k}][va${k}]alphamerge${op}[vcv${k}];`
    } else {
      filter += `${useV(idx)}${geom}${op}[vcv${k}];`
    }
    const out = `[vcb${k}]`
    const endT = vEndT - 0.5 / outFps > vc.tStart ? vEndT - 0.5 / outFps : vEndT
    filter += `${last}[vcv${k}]overlay=0:0:eof_action=pass:enable=between(t\\,${vc.tStart.toFixed(3)}\\,${endT.toFixed(3)})${out};`
    last = out
  })
  return { filter, last }
}

/** 画像クリップをテロップより先に重ねる（＝テロップが常に画像の上）。 */
export function overlayImages(
  ctx: OverlayCtx,
  imgs: ExportImageClip[],
  imgInput: number[],
  from: string
): OverlayStep {
  const { width, height, outFps, fpsArg, useV } = ctx
  let filter = ''
  let last = from
  imgs.forEach((im, k) => {
    const idx = imgInput[k]
    // 反転は出力サイズへ整える前でよい（サイズが変わらない）。
    // 回転は「枠サイズを変えずに中心で回す」＝プレビューの CSS rotate と同じ見え方にするため、
    // scale/pad で W×H に整えた *後* に ow=iw:oh=ih で回す（transpose は枠ごと縦横が入れ替わり
    // その後の decrease で縮んでしまい、プレビューと食い違うので使わない）。
    let ixf = ''
    if (im.flipH) ixf += ',hflip'
    if (im.flipV) ixf += ',vflip'
    const irot = ((Math.round(im.rotate ?? 0) % 360) + 360) % 360
    let irotF = ''
    if (irot !== 0) {
      const rad = ((irot * Math.PI) / 180).toFixed(5)
      // 90/180/270 は補間なし（bilinear=0）で劣化を避ける
      const bl = irot % 90 === 0 ? ':bilinear=0' : ''
      irotF = `,rotate=${rad}:ow=iw:oh=ih:fillcolor=black@0${bl}`
    }
    let izm = ''
    const iz = im.zoom
    if (hasClipMotion(im.motion)) {
      // 静止画は1枚しか入って来ない。zoompan の d に「尺×fps」を渡して、
      // その1枚から動く絵を作る（zoompan はもともとこれ用のフィルタ）。
      // 出来た並びは時刻0から始まるので、置く時刻へずらし直す
      // （ずらさないと、重ねる窓が開く頃には最後の1枚で止まっている）。
      const idur = Math.max(0.05, im.duration)
      izm =
        ',' +
        zoompanFilter(iz, im.motion, {
          width,
          height,
          timeExpr: `on/${outFps}`,
          fpsArg,
          frames: idur * outFps
        }) +
        `,setpts=PTS-STARTPTS+${im.tStart.toFixed(3)}/TB,format=rgba,setsar=1`
    } else if (iz && (Math.abs(iz.scale - 1) > 1e-3 || iz.x !== 0 || iz.y !== 0)) {
      // 重ねる段。絵から外れた所は透明（下の映像が見える）
      izm = ',' + zoomPanChain(width, height, iz, 'black@0')
    }
    const icr = cropFilter(im.crop, width, height)
    const iadj = im.adjust
    const hasEq = needsEq(iadj)
    const iop = opacityFilter(im.opacity)
    // 透明を保持するため rgba に統一（回転/pad の余白と不透明度が効くように）
    const geom = `format=rgba${ixf},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1${irotF}${izm}${icr}`
    if (hasEq) {
      // 色調整はアルファ非対応（YUV で計算する）ので、通すと透明が不透明の黒に落ちる。
      // アルファを取り出して退避し、色調整後に merge して戻す。
      const eqf = colorAdjustFilter(iadj)
      filter += `${useV(idx)}${geom},split[ig${k}a][ig${k}b];`
      filter += `[ig${k}a]alphaextract[ia${k}];`
      filter += `[ig${k}b]${eqf}[ic${k}];`
      filter += `[ic${k}][ia${k}]alphamerge${iop}[img${k}];`
    } else {
      filter += `${useV(idx)}${geom}${iop}[img${k}];`
    }
    const out = `[ib${k}]`
    // テロップと同じ半開区間。隣接する画像が境界で二重に重ならず、
    // 「半フレーム詰めた隙間に出力フレームが落ちて1枚抜ける」も起きない。
    const iEnd = im.tStart + Math.max(0.05, im.duration)
    filter += `${last}[img${k}]overlay=0:0:enable=${overlayEnableExpr(im.tStart, iEnd)}${out};`
    last = out
  })
  return { filter, last }
}

/**
 * 連番でまとめて重ねるテロップ。
 *
 * **1本につき重ねるのは1段だけ。** 中身が何百枚あっても段は増えないので、
 * 枚数に比例して遅くなることが無い（1枚ずつ重ねる作りが遅さの正体だった）。
 *
 * 連番はそれ自身の時間軸を 0 から持っているので、置きたい時刻ぶん後ろへずらす。
 * ずらしてから重ねる窓（enable）を掛けると、窓の中では必ず「そのテロップの
 * 経過時間ぶん進んだ絵」が当たる。
 */
export function overlayTelopSeqs(
  ctx: OverlayCtx,
  seqs: ExportTelopSeq[],
  seqInput: number[],
  from: string
): OverlayStep {
  const { outFps, useV } = ctx
  let filter = ''
  let last = from
  seqs.forEach((sq, k) => {
    const lb = `[sq${k}]`
    // fps= で出力の刻みに合わせてから PTS をずらす。合わせずにずらすと、
    // 連番の刻み（例 30枚/秒）のまま出力（例 60fps）へ入って、
    // **1枚が2コマぶん居座る／足りない**が起きる。
    filter += `${useV(seqInput[k])}fps=${outFps},setpts=PTS+${sq.start.toFixed(3)}/TB${lb};`
    const out = `[qo${k}]`
    filter += `${last}${lb}overlay=0:0:enable=${overlayEnableExpr(sq.start, sq.end)}${out};`
    last = out
  })
  return { filter, last }
}

/**
 * 1枚ずつのテロップを重ねる。**最後は必ず `[v]`**（ここが映像の出口）。
 *
 * 窓の作り方（なぜ半開区間か）は shared/filterGraph の overlayEnableExpr に書いてある。
 * 動きの付いたテロップは短い窓を延々と並べるので、ここの取り違えが直接
 * 「書き出した動画のテロップがチカチカする」になる。
 */
export function overlayTelopFrames(
  ctx: OverlayCtx,
  frames: ExportFrame[],
  pngInput: number[],
  from: string
): OverlayStep {
  const { useV } = ctx
  let filter = ''
  let last = from
  if (!frames.length) {
    filter += `${last}null[v];` // テロップ無し: 最終ラベルだけ [v] に揃える
    return { filter, last: '[v]' }
  }
  frames.forEach((f, i) => {
    const out = i === frames.length - 1 ? '[v]' : `[o${i}]`
    // テロップPNGは1枚1入力（重複なし）。
    filter += `${last}${useV(pngInput[i])}overlay=0:0:enable=${overlayEnableExpr(f.start, f.end)}${out};`
    last = out
  })
  return { filter, last }
}

export interface OverlaysInput {
  /** ベース映像のラベル（カット無しなら元動画、カットありなら [vcat]） */
  baseLabel: string
  /** 動画のカット後より後ろにテロップがあるとき、最終フレームを引き伸ばす秒数 */
  extendSec?: number
  vcs: ExportVClip[] | null
  vcInput: number[]
  vcHasAudio: boolean[]
  imgs: ExportImageClip[] | null
  imgInput: number[]
  seqs: ExportTelopSeq[]
  seqInput: number[]
  frames: ExportFrame[]
  pngInput: number[]
}

/**
 * `[base]` を作って、その上へ下から順に積む。**出口は必ず `[v]`。**
 */
export function buildOverlays(ctx: OverlayCtx, o: OverlaysInput): string {
  const { width, height } = ctx
  // ベース映像を出力解像度に合わせて拡縮＋レターボックス。
  // 動画のカット後より後ろのテロップがある場合は最終フレームを引き伸ばして含める
  const ext =
    o.extendSec && o.extendSec > 0.05
      ? `tpad=stop_mode=clone:stop_duration=${o.extendSec.toFixed(3)},`
      : ''
  let filter = `${o.baseLabel}${ext}scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[base];`
  let last = '[base]'
  if (o.vcs) {
    const step = overlayVideoClips(ctx, o.vcs, o.vcInput, o.vcHasAudio, last)
    filter += step.filter
    last = step.last
  }
  if (o.imgs) {
    const step = overlayImages(ctx, o.imgs, o.imgInput, last)
    filter += step.filter
    last = step.last
  }
  const seqStep = overlayTelopSeqs(ctx, o.seqs, o.seqInput, last)
  filter += seqStep.filter
  last = seqStep.last
  filter += overlayTelopFrames(ctx, o.frames, o.pngInput, last).filter
  return filter
}

// ---- 本編の切片（V1）を並べて [vcat] / [acat] を作る ----
//
// カット間クロスディゾルブ: 切片 i の xfade =「i と i+1 の間」を d 秒重ねて溶かす。
// モデルは「カット位置で完了する d 秒クロスフェード」——B側をソースの srcStart より
// d*速度 だけ手前から取り出して頭を d 秒延長し、Aの尻と xfade で重ねる。
// 出力尺 = lenA + (lenB + d) - d = 不変（テロップ/SEの enable 時刻に影響しない）。
//
// ※ 速度と「タイムライン上の長さ」は shared/timeline が正典。2026-08-03 まで
//   ここに同じ式を手書きしていた（`spOf` / `tlenOf`）。**正典には Math.max(0, …) が
//   入っていて、こちらには無かった**——`srcEnd < srcStart` の壊れた切片で、画面は
//   0で止まるのに書き出しだけ負の長さになる。片方だけ直した跡がそのまま残っていた形。

/** 頭/尻/間すべてで使えるトランジションの種類（xfade が持っている物） */
const XF_ALLOWED = new Set([
  'fade',
  'slideleft',
  'slideright',
  'slideup',
  'slidedown',
  'wipeleft',
  'wiperight'
])

/**
 * ペア (i, i+1) の実効ディゾルブ長（renderer でクランプ済み。最後の切片は次がないので0）。
 *
 * **映像側と音声側の両方がここを通る。** 片方だけ別の式を持つと、音と絵の尺が
 * ずれて concat の位置が食い違う（2026-08-03 まで1つの閉じ込みを共有していたので、
 * 切り出すときに真っ先に壊れる所だった）。
 */
export function xfadeDurOf(segs: ExportSeg[], i: number): number {
  return i >= 0 && i < segs.length - 1 && segs[i].xfade && segs[i].xfade!.dur > 0.01
    ? segs[i].xfade!.dur
    : 0
}

/** 沈んで戻る系（ディゾルブ/黒/白）か。この3つだけ fade フィルタで出す */
function isDipT(ty?: string): boolean {
  return ty === 'fade' || ty === 'dipblack' || ty === 'dipwhite'
}

/** ディップの色 */
function dipCol(ty?: string): string {
  return ty === 'dipwhite' ? 'white' : 'black'
}

/** 頭/尻 slide/wipe（黒とのxfade）用の名前 */
function motionName(ty?: string): string {
  return ty && XF_ALLOWED.has(ty) ? ty : 'fade'
}

/** 間 xfade 名: 黒/白ディップは fadeblack/fadewhite（沈んで戻る） */
function betweenName(ty?: string): string {
  return ty === 'dipblack'
    ? 'fadeblack'
    : ty === 'dipwhite'
      ? 'fadewhite'
      : ty && XF_ALLOWED.has(ty)
        ? ty
        : 'fade'
}

/** 頭が slide/wipe で入るか（間のディゾルブがあるときは、そちらが勝つ） */
function motionIn(segs: ExportSeg[], s: ExportSeg, i: number): boolean {
  return !!s.transIn && s.transIn.dur > 0 && xfadeDurOf(segs, i - 1) <= 0 && !isDipT(s.transIn.type)
}

/** 尻が slide/wipe で出るか */
function motionOut(segs: ExportSeg[], s: ExportSeg, i: number): boolean {
  return !!s.transOut && s.transOut.dur > 0 && xfadeDurOf(segs, i) <= 0 && !isDipT(s.transOut.type)
}

/**
 * 出力解像度へ揃える定型。
 *
 * **各切片を先に同じ大きさにしてから連結する**ので、黒ブランク（color）も
 * そのまま混ぜられる。末尾が `fps=` なので、この直後では `on/fps` がそのまま秒になる。
 */
function scalePadFilter(width: number, height: number, fpsArg: string): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fpsArg}`
}

/** 切片の組み立てが共通で要る物 */
export interface SegmentsCtx {
  width: number
  height: number
  outFps: number
  fpsArg: string
  useV: (idx: number) => string
  useA: (idx: number) => string
  ssOffsetOf: (idx: number, wantSec: number, audioUsed: boolean) => number
}

export interface SegmentsInput {
  segs: ExportSeg[]
  /** 切片の srcIdx → 入力index（マルチソース） */
  srcInput: number[]
  /** 入力ごとの音声の有無（ffprobe の実測） */
  srcHasAudio: boolean[]
  /** 全体として音声を扱うか（どれか1つでも音声があれば作る） */
  audioPresent: boolean
  /** 元動画の本数。1本なら音のフォーマット統一を付けない＝従来動作を完全維持 */
  nSrc: number
}

/** 切片を並べた結果 */
export interface SegmentsResult {
  filter: string
  /** 連結後のベース映像ラベル */
  baseLabel: string
  /** 音声を作ったときだけ `['-map', '[acat]']` */
  audioMap: string[] | null
}

/** 切片の映像チェーン。`[sv i]` を作って `[vcat]` へ連結する */
export function buildSegmentVideo(ctx: SegmentsCtx, o: SegmentsInput): string {
  const { width, height, outFps, fpsArg, useV, ssOffsetOf } = ctx
  const { segs, srcInput, srcHasAudio, audioPresent } = o
  const scalePad = scalePadFilter(width, height, fpsArg)
  let filter = ''
  const hasX = segs.some((_, i) => xfadeDurOf(segs, i) > 0)
  // xfade は全入力のタイムベース一致を要求する。scalePad の fps=30 が切片を 1/30 に、
  // concat は出力を 1/1000000(AVTB) にするため、混在チェーンでは xfade が
  // "timebase do not match" で失敗する。xfade を使うときは全切片を AVTB に統一する。
  // （非 xfade 経路は従来どおり付けない＝完全な後方互換）
  const needTb = hasX || segs.some((s, i) => motionIn(segs, s, i) || motionOut(segs, s, i))
  const tb = needTb ? ',settb=AVTB' : ''
  segs.forEach((s, i) => {
    const sp = segSpeed(s)
    const lenN = segTLen(s)
    const headExt = xfadeDurOf(segs, i - 1)
    const extLenN = lenN + headExt
    const trimStart = Math.max(0, s.srcStart - headExt * sp)
    const tin = s.transIn && s.transIn.dur > 0 && headExt <= 0 ? s.transIn : null
    const tout = s.transOut && s.transOut.dur > 0 && xfadeDurOf(segs, i) <= 0 ? s.transOut : null
    // dip系（ディゾルブ/黒/白）は fade フィルタで色付き in/out。ディゾルブ境界のディップは出さない。
    let fade = ''
    if (tin && isDipT(tin.type))
      fade += `,fade=t=in:st=0:d=${Math.min(tin.dur, extLenN).toFixed(3)}:color=${dipCol(tin.type)}`
    if (tout && isDipT(tout.type)) {
      const d = Math.min(tout.dur, extLenN)
      fade += `,fade=t=out:st=${(extLenN - d).toFixed(3)}:d=${d.toFixed(3)}:color=${dipCol(tout.type)}`
    }
    // 色調整（明るさ/コントラスト/彩度）。組み立ては shared/colorAdjust。
    // **eq は使わない**（GPL 専用で、同梱の LGPL 版には入っていない）。
    const adj = s.adjust
    const cf = colorAdjustFilter(adj)
    const eq = cf ? `,${cf}` : ''
    // 変形（回転/反転）。scalePad の前に適用＝回転後に出力サイズへフィット。
    // 90°刻みは transpose（劣化なし）、自由角度は rotate フィルタ（黒埋め）。
    let xf = ''
    const rot = ((Math.round(s.rotate ?? 0) % 360) + 360) % 360
    if (rot === 90) xf += ',transpose=1'
    else if (rot === 270) xf += ',transpose=2'
    else if (rot === 180) xf += ',transpose=1,transpose=1'
    else if (rot !== 0)
      xf += `,rotate=${((rot * Math.PI) / 180).toFixed(5)}:ow=rotw(${((rot * Math.PI) / 180).toFixed(5)}):oh=roth(${((rot * Math.PI) / 180).toFixed(5)}):fillcolor=black`
    if (s.flipH) xf += ',hflip'
    if (s.flipV) xf += ',vflip'
    // 動画ズーム（リフレーム）: プレビューの transform: translate(x,y) scale(s) を切片ごとに焼き込む。
    // s>=1 は拡大して切り出し(crop)、s<1 は縮小して黒余白(pad)。x,y はフレーム比の中心オフセット。
    // scalePad で出力サイズに整えた後に適用する（切片単位＝現セクションのみ反映）。
    let zm = ''
    const z = s.zoom
    if (hasClipMotion(s.motion)) {
      // 動きが付いている切片だけ zoompan にする（時間で拡大率を変えられる唯一のフィルタ）。
      // 時刻は**切片の頭から**。頭にディゾルブのぶん（headExt）が足してあるときは、
      // その秒数だけ手前から流れているので引く。
      // 直前が scalePad（末尾が fps=）なので、on/fps はそのまま秒になる。
      const t = headExt > 0 ? `(on/${outFps}-${headExt.toFixed(3)})` : `on/${outFps}`
      zm = `,${zoompanFilter(z, s.motion, {
        width,
        height,
        timeExpr: t,
        fpsArg,
        frames: 1,
        // いちばん下の段なので、広げた台紙の余白は黒（透ける先が無い）
        bg: 'black'
      })},setsar=1`
    } else if (z && (Math.abs(z.scale - 1) > 1e-3 || z.x !== 0 || z.y !== 0)) {
      // いちばん下の段なので、絵から外れた所は黒（透ける先が無い）
      zm = ',' + zoomPanChain(width, height, z, 'black')
    }
    // いちばん下の段なので、切った領域も黒
    const cr = cropFilter(s.crop, width, height, 'black')
    const mIn = motionIn(segs, s, i)
    const mOut = motionOut(segs, s, i)
    const coreLabel = mIn || mOut ? `[c${i}]` : `[sv${i}]`
    const vin = srcInput[s.srcIdx ?? 0] // マルチソース: この切片が使う入力（元動画）index
    if (s.videoBlank) {
      filter += `color=c=black:s=${width}x${height}:d=${extLenN.toFixed(3)}:r=${fpsArg},setsar=1${fade}${tb}${coreLabel};`
    } else {
      // この切片の音声を使うか（音声側の useSilence と同じ条件）
      const aUsed = audioPresent && !s.muted && !!srcHasAudio[s.srcIdx ?? 0]
      const off = ssOffsetOf(vin, trimStart, aUsed) // 入力 -ss を付けたぶん trim を前へずらす
      filter += `${useV(vin)}trim=start=${(trimStart - off).toFixed(3)}:end=${(s.srcEnd - off).toFixed(3)},setpts=(PTS-STARTPTS)/${sp}${xf},${scalePad}${zm}${cr}${eq}${fade}${tb}${coreLabel};`
    }
    // slide/wipe の頭/尻＝黒クリップとの xfade（映像がスライド/ワイプで出入り）。尺は不変。
    if (mIn || mOut) {
      let cur = coreLabel
      if (mIn) {
        const d = Math.min(tin!.dur, extLenN)
        const nx = mOut ? `[ci${i}]` : `[sv${i}]`
        filter += `color=c=black:s=${width}x${height}:d=${d.toFixed(3)}:r=${fpsArg},setsar=1,settb=AVTB[bi${i}];`
        filter += `[bi${i}]${cur}xfade=transition=${motionName(tin!.type)}:duration=${d.toFixed(3)}:offset=0${nx};`
        cur = nx
      }
      if (mOut) {
        const d = Math.min(tout!.dur, extLenN)
        filter += `color=c=black:s=${width}x${height}:d=${d.toFixed(3)}:r=${fpsArg},setsar=1,settb=AVTB[bo${i}];`
        filter += `${cur}[bo${i}]xfade=transition=${motionName(tout!.type)}:duration=${d.toFixed(3)}:offset=${(extLenN - d).toFixed(3)}[sv${i}];`
      }
    }
  })
  if (!hasX) {
    // 従来どおり単純連結
    filter += `${segs.map((_, i) => `[sv${i}]`).join('')}concat=n=${segs.length}:v=1:a=0[vcat];`
  } else {
    // 左から右へペアごとに連結: 間トランジションは xfade、それ以外は concat(n=2)。
    // offset は「出力時間の累計 - d」（速度込みのタイムライン尺で計算）。名前は betweenName で検証。
    let cur = '[sv0]'
    let acc = segTLen(segs[0])
    for (let i = 1; i < segs.length; i++) {
      const d = xfadeDurOf(segs, i - 1)
      const out = i === segs.length - 1 ? '[vcat]' : `[vx${i}]`
      if (d > 0)
        filter += `${cur}[sv${i}]xfade=transition=${betweenName(segs[i - 1]?.xfade?.type)}:duration=${d.toFixed(3)}:offset=${(acc - d).toFixed(3)}${out};`
      else filter += `${cur}[sv${i}]concat=n=2:v=1:a=0${out};`
      cur = out
      acc += segTLen(segs[i])
    }
    // hasX ⇒ 切片は2つ以上（xfadeDurOf が「次の切片あり」を要求）なので、ループは必ず [vcat] を出す
  }
  return filter
}

/** 切片の音声チェーン。`[sa i]` を作って `[acat]` へ連結する */
export function buildSegmentAudio(ctx: SegmentsCtx, o: SegmentsInput): string {
  const { useA, ssOffsetOf } = ctx
  const { segs, srcInput, srcHasAudio, nSrc } = o
  let filter = ''
  const hasX = segs.some((_, i) => xfadeDurOf(segs, i) > 0)
  // 無音で埋める切片: muted / 音声なしソース / ギャップ。ソース音声を使わず anullsrc で正確な長さを出す
  // （ギャップはソース尺を超える範囲を指し得るため、atrim だと音声が短くなり concat がズレる）。
  const useSilence = (s: ExportSeg): boolean => !!s.muted || !srcHasAudio[s.srcIdx ?? 0]
  // フォーマット統一が必要: 複数入力を混ぜる or anullsrc(48k/stereo)と混ざるとき。
  // 単一ソース＆無音なしの経路では付けない＝従来動作を完全維持。
  const needAfmt = nSrc > 1 || segs.some(useSilence)
  const afmt = needAfmt ? ',aformat=sample_rates=48000:channel_layouts=stereo' : ''
  segs.forEach((s, i) => {
    const sp = segSpeed(s)
    const headExt = xfadeDurOf(segs, i - 1)
    // 映像側の extLenN と必ず一致させる。**同じ segTLen を通す**のがその保証で、
    // 2026-08-03 まではここだけ手書きだった（コメントで一致を約束していただけ）。
    const extLen = segTLen(s) + headExt
    if (useSilence(s)) {
      filter += `anullsrc=r=48000:cl=stereo,atrim=0:${Math.max(0.05, extLen).toFixed(3)},asetpts=PTS-STARTPTS${afmt}[sa${i}];`
      return
    }
    // 切片音量倍率。速度は atempo。フェードは頭/尻の指定秒。
    const gain = s.vol != null && Math.abs(s.vol - 1) > 1e-3 ? `,volume=${s.vol.toFixed(3)}` : ''
    const tempo = sp !== 1 ? `,atempo=${sp.toFixed(4)}` : ''
    let af = ''
    if (s.afadeIn && s.afadeIn > 0)
      af += `,afade=t=in:st=0:d=${Math.min(s.afadeIn, extLen).toFixed(3)}`
    if (s.afadeOut && s.afadeOut > 0) {
      const d = Math.min(s.afadeOut, extLen)
      af += `,afade=t=out:st=${(extLen - d).toFixed(3)}:d=${d.toFixed(3)}`
    }
    // 映像と同じくディゾルブ受け側は頭を延長（acrossfade 後の合計尺が映像と一致する）
    const trimStart = Math.max(0, s.srcStart - headExt * sp)
    const ain = srcInput[s.srcIdx ?? 0]
    const off = ssOffsetOf(ain, trimStart, true) // 音声を使う入力に -ss は付けない（常に0）
    filter += `${useA(ain)}atrim=start=${(trimStart - off).toFixed(3)}:end=${(s.srcEnd - off).toFixed(3)},asetpts=PTS-STARTPTS${tempo}${gain}${af}${afmt}[sa${i}];`
  })
  if (!hasX) {
    filter += `${segs.map((_, i) => `[sa${i}]`).join('')}concat=n=${segs.length}:v=0:a=1[acat];`
  } else {
    let cur = '[sa0]'
    for (let i = 1; i < segs.length; i++) {
      const d = xfadeDurOf(segs, i - 1)
      const out = i === segs.length - 1 ? '[acat]' : `[ax${i}]`
      if (d > 0) filter += `${cur}[sa${i}]acrossfade=d=${d.toFixed(3)}${out};`
      else filter += `${cur}[sa${i}]concat=n=2:v=0:a=1${out};`
      cur = out
    }
  }
  return filter
}

/** カットを反映: 残った切片を出力解像度に揃えて連結する（映像＋音声） */
export function buildSegments(ctx: SegmentsCtx, o: SegmentsInput): SegmentsResult {
  let filter = buildSegmentVideo(ctx, o)
  let audioMap: string[] | null = null
  if (o.audioPresent) {
    filter += buildSegmentAudio(ctx, o)
    audioMap = ['-map', '[acat]']
  }
  return { filter, baseLabel: '[vcat]', audioMap }
}

// ---- 音のミックス（ベース音声＋効果音＋映像レイヤーの音 → ラウドネス正規化）----

/**
 * ベース音声の目印。
 *
 * カット無しのベース音声（元動画の音声そのまま）は、**フィルタで使うか
 * `-map` で直結かが後段の分岐で決まる**。使わないのに asplit の出力を作ると
 * エラーになるので、いったんこの目印を置き、**全部組み終わってから**
 * 「目印が残っていたら」入力ラベルを払い出して置換する。
 */
export const RAW_BASE_A = '@BASEA@'

/** 音のミックスが要る道具 */
export interface AudioMixCtx {
  useA: (idx: number) => string
  ssOffsetOf: (idx: number, wantSec: number, audioUsed: boolean) => number
}

export interface AudioMixInput {
  /** 切片があるか。あれば `[acat]`、無ければ元動画の音（＝目印）から始める */
  hasSegs: boolean
  audioPresent: boolean
  /** A1(ベース音声)トラック音量×マスター */
  baseVol: number
  ses: ExportSEClip[] | null
  seInput: number[]
  vcs: ExportVClip[] | null
  vcInput: number[]
  vcHasAudio: boolean[]
  /** 目標LUFS（YouTube最適 -14 等）。null なら正規化しない */
  loudnormLUFS: number | null
  /** ここまでで決まっている -map（切片が作った物、または元動画への直結） */
  audioMap: string[]
}

/**
 * 効果音と映像レイヤーの音をベース音声に混ぜ、最後にラウドネスを揃える。
 *
 * ※ **ses が無くても通す。** 以前は `if (ses)` の内側にあり、効果音を1本も
 *   置いていないプロジェクトでは**映像レイヤーの音が丸ごと書き出されなかった**。
 */
export function buildAudioMix(
  ctx: AudioMixCtx,
  o: AudioMixInput
): { filter: string; audioMap: string[] } {
  const { useA, ssOffsetOf } = ctx
  const { ses, seInput, vcs, vcInput, vcHasAudio } = o
  let filter = ''
  let audioMap = o.audioMap
  // A1(ベース音声)トラック音量×マスターを適用
  let baseAudioLbl = o.audioPresent ? (o.hasSegs ? '[acat]' : RAW_BASE_A) : null
  if (baseAudioLbl && Math.abs(o.baseVol - 1) > 1e-3) {
    filter += `${baseAudioLbl}volume=${o.baseVol.toFixed(3)}[abase];`
    baseAudioLbl = '[abase]'
    audioMap = ['-map', '[abase]']
  }

  if (ses || vcs) {
    const baseLbl = baseAudioLbl
    const mixParts: string[] = []
    if (baseLbl) mixParts.push(baseLbl)
    ses?.forEach((se, k) => {
      const ms = Math.max(0, Math.round(se.tStart * 1000))
      const durN = Math.max(0.05, se.duration)
      const vol = (se.volume ?? 1).toFixed(2)
      // フェードイン/アウト（afade）を volume と adelay の間に挟む
      const fi = Math.max(0, Math.min(se.fadeIn ?? 0, durN))
      const fo = Math.max(0, Math.min(se.fadeOut ?? 0, durN))
      let fade = ''
      if (fi > 0) fade += `,afade=t=in:st=0:d=${fi.toFixed(3)}`
      if (fo > 0) fade += `,afade=t=out:st=${(durN - fo).toFixed(3)}:d=${fo.toFixed(3)}`
      // 音源内オフセット（左端トリム/分割）ぶん頭を送って、そこから duration 秒を切り出す。
      // ベース音声と同じ 48k/stereo に揃えてから amix に入れる（サンプルレート差で崩れないように）。
      const so = Math.max(0, se.srcOffset ?? 0)
      // 声に合わせて下げる（ダッキング）。**adelay の後**に掛ける。
      // 前に掛けると、式の t がクリップ内の時間になって、声の位置とずれる。
      const duck = se.duckExpr
        ? `,volume=eval=frame:volume='${se.duckExpr.replace(/'/g, '')}'`
        : ''
      filter += `${useA(seInput[k])}atrim=${so.toFixed(3)}:${(so + durN).toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol}${fade},adelay=${ms}|${ms}${duck}[se${k}];`
      mixParts.push(`[se${k}]`)
    })
    // 映像レイヤーの音声もミックスへ（映像と同じ位置・同じ長さ）
    if (vcs) {
      vcs.forEach((vc, k) => {
        const vol = vc.volume ?? 1
        if (vol <= 0) return // 消音クリップはミックスに入れない
        // 音声ストリームが無い動画（画面録画など）は [N:a] が存在せず、参照すると
        // 書き出し全体が "Stream specifier ':a' matches no streams" で失敗する。
        if (!vcHasAudio[k]) return
        const durN = vcLen(vc)
        const ms = Math.max(0, Math.round(vc.tStart * 1000))
        const fi = Math.max(0, Math.min(vc.fadeIn ?? 0, durN))
        const fo = Math.max(0, Math.min(vc.fadeOut ?? 0, durN))
        let fade = ''
        if (fi > 0) fade += `,afade=t=in:st=0:d=${fi.toFixed(3)}`
        if (fo > 0) fade += `,afade=t=out:st=${(durN - fo).toFixed(3)}:d=${fo.toFixed(3)}`
        const off = ssOffsetOf(vcInput[k], vc.srcStart, true) // 音声を使う入力に -ss は付けない（常に0）
        filter += `${useA(vcInput[k])}atrim=${(vc.srcStart - off).toFixed(3)}:${(vc.srcEnd - off).toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol.toFixed(2)}${fade},adelay=${ms}|${ms}[vca${k}];`
        mixParts.push(`[vca${k}]`)
      })
    }
    if (mixParts.length >= 2 || (mixParts.length === 1 && !baseLbl)) {
      filter += `${mixParts.join('')}amix=inputs=${mixParts.length}:normalize=0:dropout_transition=0[amixout];`
      audioMap = ['-map', '[amixout]']
    }
  }

  // ラウドネス正規化（loudnorm）: 最終音声を目標LUFSへそろえる（YouTube最適 -14 等）。
  // audioPresent は「元動画に音声があるか」なので条件に入れない
  // （元動画が無音でも SE/BGM だけで音声を作る構成があり、そこでも正規化を効かせる）。
  // loudnorm は内部で192kHzに上げるため、aresample で48kHzへ戻す（AACが96kHzになるのを防ぐ）。
  if (o.loudnormLUFS !== null && audioMap.length === 2) {
    const cur = audioMap[1]
    const inLbl = cur.startsWith('[') ? cur : RAW_BASE_A
    filter += `${inLbl}loudnorm=I=${o.loudnormLUFS}:TP=-1.5:LRA=11,aresample=48000[aout];`
    audioMap = ['-map', '[aout]']
  }
  return { filter, audioMap }
}
