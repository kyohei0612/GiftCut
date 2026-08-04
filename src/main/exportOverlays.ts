// `[base]` の上へ**1段ずつ重ねる**側。本編の切片を並べる所（./exportSegments）とは
// 互いを知らない。ffmpeg も electron も呼ばない（文字列を組み立てるだけ）。
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
// - `OverlayCtx` … 全部の段で同じ値（食い違うと段ごとに絵がずれる）
// - `OverlayStep` … 1段積んだ結果。`last` は次に積む先のラベル
// - `overlayVideoClips` … 映像レイヤー（V2以降の動画）を重ねる
// - `overlayImages` … 画像クリップを重ねる（テロップより下）
// - `overlayTelopSeqs` … 連番でまとめたテロップを重ねる（1本＝1段）
// - `overlayTelopFrames` … 1枚ずつのテロップを重ねる。最後が `[v]`
// - `OverlaysInput` … 上の4段へ渡す物をまとめた入れ物
// - `buildOverlays` … `[base]` を作って上の4つを下から順に積む
import { overlayEnableExpr } from '../shared/filterGraph'
import { hasClipMotion, zoomPanChain, zoompanFilter } from '../shared/clipMotion'
import { colorAdjustFilter } from '../shared/colorAdjust'
// 重ねた動画の長さは shared/timeline が正典。**ここで書き起こさない**
import { vcLen } from '../shared/timeline'
import { cropFilter, needsEq, opacityFilter } from './exportFilters'
import type { ExportFrame, ExportImageClip, ExportTelopSeq, ExportVClip } from './exportTypes'

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
