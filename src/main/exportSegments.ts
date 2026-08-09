// 本編（V1）の切片を**横に並べて** `[vcat]` / `[acat]` を作る側。
// 上へ重ねる段（./exportOverlays）とは互いを知らない。
//
// ## 長さと速度は shared/timeline が正典
//
// 2026-08-03 まで、ここに同じ式を手書きしていた（`spOf` / `tlenOf`）。
// **正典には `Math.max(0, …)` が入っていて、こちらには無かった**——壊れた切片で、
// 画面は0で止まるのに書き出しだけ負の長さになる。**書き起こさないこと。**
//
// ## つなぎ目は「カット位置で完了する d 秒クロスフェード」
//
// 出力の尺は変わらない（下の節に式がある）。変わってしまうと、テロップと効果音の
// 出る時刻が全部ずれる——**しかも書き出してからしか分からない。**
//
// ## 中身
//
// - `XF_ALLOWED` … xfade が持っているトランジションの種類
// - `xfadeDurOf` … ペア (i, i+1) の実効ディゾルブ長。**映像側と音声側の両方が通る**
// - `isDipT` … 沈んで戻る系（ディゾルブ/黒/白）か
// - `dipCol` … ディップの色
// - `motionName` … 頭/尻 slide/wipe の xfade 名
// - `betweenName` … 間 xfade の名前（黒/白ディップは fadeblack/fadewhite）
// - `motionIn` … 頭が slide/wipe で入るか（間のディゾルブがあればそちらが勝つ）
// - `motionOut` … 尻が slide/wipe で出るか
// - `scalePadFilter` … 出力解像度へ揃える定型（連結の前に全切片を同じ大きさに）
// - `SegmentsCtx` / `SegmentsInput` / `SegmentsResult` … 受け渡しの形
// - `buildSegmentVideo` … `[sv i]` を作って `[vcat]` へ連結する
// - `buildSegmentAudio` … `[sa i]` を作って `[acat]` へ連結する
// - `buildSegments` … 上の2つを呼んで、ベース映像のラベルと -map を返す
import { hasClipMotion, zoomPanChain, zoompanFilter } from '../shared/clipMotion'
import { colorAdjustFilter } from '../shared/colorAdjust'
// 速度と「タイムライン上の長さ」は shared/timeline が正典（上の節）
import { segSpeed, segTLen } from '../shared/timeline'
import { cropFilter } from './exportFilters'
import type { ExportSeg } from './exportTypes'

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
  /**
   * 窓（source 時間の [start, end)）付きで映像を使う（`shared/filterLabels` の `useVAt`）。
   * 窓が分かっていると split（全コマを全枝へコピー）ではなく segment（該当する枝へ
   * だけ送る）で配れる。無ければ `useV` に落ちる（試験などはそのままでよい）
   */
  useVAt?: (idx: number, start: number, end: number) => string
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
  const { width, height, outFps, fpsArg, useV, useVAt, ssOffsetOf } = ctx
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
      // **窓（trim の範囲）を添えて使う。** 窓が分かっていれば、解決側（filterLabels）が
      // split ではなく segment で配れる——split=600 が「全コマ×600枝のコピー」に
      // なっていたのが、書き出しの遅さの入口側の扇だった（2026-08-09）
      const src = useVAt ? useVAt(vin, trimStart - off, s.srcEnd - off) : useV(vin)
      filter += `${src}trim=start=${(trimStart - off).toFixed(3)}:end=${(s.srcEnd - off).toFixed(3)},setpts=(PTS-STARTPTS)/${sp}${xf},${scalePad}${zm}${cr}${eq}${fade}${tb}${coreLabel};`
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
    // 左から右へ連結: 間トランジションは xfade、**連続する concat は1ノードに畳む**。
    //
    // ## なぜ畳むか（2026-08-09。書き出しが実時間の1.74倍かかる件の犯人だった）
    //
    // 前は concat=n=2 を切片の数だけ直列に繋いでいた。ffmpeg はコマごとに
    // graph の全ノードを見て回るので、**この直列が居るだけで**（overlay や
    // zoompan まで含めた）graph 全体が道連れで遅くなる。部品を1つずつ測ると
    // 全部シロなのに全体だけ黒い、という出方をする——tv 基準（カット600・
    // 頭5分の標本）の実測で、この畳みだけで映像側 470.6 → 184.7秒（2.5倍）。
    //
    // concat=n=K は n=2 の直列と**数学的に同じ**（出力のタイムスタンプは
    // 入力の順に作り直される）ので、絵は1ビットも変わらない。
    // xfade は両側の重なりが要るので畳めない——そこだけ接合が残る。
    //
    // offset は「出力時間の累計 - d」（速度込みのタイムライン尺で計算）。名前は betweenName で検証。
    let cur = '[sv0]'
    let acc = segTLen(segs[0])
    let pend: string[] = [] // 畳み待ちの [sv i]
    let g = 0
    const flush = (out: string): void => {
      filter += `${cur}${pend.join('')}concat=n=${pend.length + 1}:v=1:a=0${out};`
      cur = out
      pend = []
    }
    for (let i = 1; i < segs.length; i++) {
      const d = xfadeDurOf(segs, i - 1)
      const last = i === segs.length - 1
      if (d > 0) {
        if (pend.length) flush(`[vj${g++}]`)
        const out = last ? '[vcat]' : `[vx${i}]`
        filter += `${cur}[sv${i}]xfade=transition=${betweenName(segs[i - 1]?.xfade?.type)}:duration=${d.toFixed(3)}:offset=${(acc - d).toFixed(3)}${out};`
        cur = out
      } else {
        pend.push(`[sv${i}]`)
        if (last) flush('[vcat]')
      }
      acc += segTLen(segs[i])
    }
    // hasX ⇒ 切片は2つ以上（xfadeDurOf が「次の切片あり」を要求）なので、
    // ループは必ず [vcat] を出す（最後が xfade でも concat でも）
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
    // **連続する concat は1ノードに畳む**（理由は映像側の同じ場所のコメント。
    // 音側も asplit の枝が同じ直列を作っていて、道連れの片棒だった）
    let cur = '[sa0]'
    let pend: string[] = [] // 畳み待ちの [sa i]
    let g = 0
    const flush = (out: string): void => {
      filter += `${cur}${pend.join('')}concat=n=${pend.length + 1}:v=0:a=1${out};`
      cur = out
      pend = []
    }
    for (let i = 1; i < segs.length; i++) {
      const d = xfadeDurOf(segs, i - 1)
      const last = i === segs.length - 1
      if (d > 0) {
        if (pend.length) flush(`[aj${g++}]`)
        const out = last ? '[acat]' : `[ax${i}]`
        filter += `${cur}[sa${i}]acrossfade=d=${d.toFixed(3)}${out};`
        cur = out
      } else {
        pend.push(`[sa${i}]`)
        if (last) flush('[acat]')
      }
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
