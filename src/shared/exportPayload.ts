// 書き出しに渡す内容の組み立て。
//
// 「画面に見えている物」を「ffmpeg に渡す指示」へ翻訳する所。**ここを間違えると、
// 出来上がった動画が違う**（音が二重・非表示のはずの物が写る・尺が合わない等）。
// 気づくのは焼き上がった後なので、画面を起動せずに確かめられる形にしてある。
//
// 決まりごと:
//   - 👁 で消したトラックの物は**焼かない**（プレビューと同じ絵にする）
//   - ただし映像レイヤーの 👁 は「映像だけ消す」。音は残す（プレビューと同じ）
//   - 重ねる順は**下のトラックから**。上のトラック（V3）が前面
//   - 何も調整していない値（等倍・無回転・切り抜きなし）は渡さない。
//     渡すと ffmpeg のフィルタが1段増えるだけで、結果は変わらない
//   - 尺は「素材の実尺で切り詰めた切片」から出す。画面の見た目から出すと、
//     素材より長い切片があったときに書き出しとズレる

export interface Zoom {
  scale: number
  x: number
  y: number
}
export interface Adjust {
  b: number
  c: number
  s: number
}
export interface Crop {
  l: number
  r: number
  t: number
  b: number
}
export interface Trans {
  type: string
  dur: number
}

/** 本編の切片（画面側の VSeg のうち、書き出しに要る所だけ） */
export interface Seg {
  srcId?: number
  srcStart: number
  srcEnd: number
  gap?: boolean
  muted?: boolean
  videoBlank?: boolean
  speed?: number
  transIn?: Trans
  transOut?: Trans
  xfade?: Trans
  adjust?: Adjust
  rotate?: number
  flipH?: boolean
  flipV?: boolean
  vol?: number
  afadeIn?: number
  afadeOut?: number
  zoom?: Zoom
  crop?: Crop
}

export interface SeClip {
  path: string
  track: string
  tStart: number
  duration: number
  srcOffset?: number
  volume: number
  fadeIn: number
  fadeOut: number
  duck?: boolean
}

export interface VClip {
  path: string
  track: string
  tStart: number
  srcStart: number
  srcEnd: number
  zoom?: Zoom
  rotate?: number
  flipH?: boolean
  flipV?: boolean
  opacity?: number
  adjust?: Adjust
  crop?: Crop
  vol?: number
  muted?: boolean
  afadeIn?: number
  afadeOut?: number
}

export interface ImgClip {
  path: string
  track: string
  tStart: number
  duration: number
  zoom?: Zoom
  rotate?: number
  flipH?: boolean
  flipV?: boolean
  opacity?: number
  adjust?: Adjust
  crop?: Crop
}

export interface BuildInput {
  videoPath: string
  /** 入力に使う元動画。切片の srcId をこの並びの index に対応させる */
  sources: { id: number; path: string }[]
  size: { width: number; height: number }
  /** テロップを画像にした物（すでに焼いてある） */
  frames: { png: string; start: number; end: number }[]
  segments: Seg[]
  seClips: SeClip[]
  vClips: VClip[]
  imgClips: ImgClip[]
  /** 重なり順を決めるためのトラックの並び（上から順） */
  tracks: { id: string }[]
  /** そのトラックが 👁 で消されているか */
  hidden: (trackId: string) => boolean
  /** 本編（V1）が消されているか。消えていれば映像は黒にする */
  v1Hidden: boolean
  /** そのトラックの音量（トラック音量×マスター） */
  gainOf: (trackId: string) => number
  /** 切片の速度（未指定は1） */
  speedOf: (seg: Seg) => number
  /** 切片の元動画の実尺（分からなければ undefined） */
  srcDurationOf: (seg: Seg) => number | undefined
  /** 切片の並びから、その位置の実効クロスフェード長を出す */
  xfadeDurAt: (segs: Seg[], index: number) => number
  /** 切片の合計時間（速度反映） */
  totalLen: (segs: Seg[]) => number
  /** 声に合わせて下げる指定の式（無ければ undefined） */
  duckExpr?: string
  loudnormLUFS: number | null
  fps: number
  crf: number
  /** テロップの終わり・効果音の終わりなど、本編より後ろに伸びる物の終端 */
  tailEnds: number[]
}

const isNeutralZoom = (z?: Zoom): boolean => !z || (z.scale === 1 && z.x === 0 && z.y === 0)
const isNeutralAdjust = (a?: Adjust): boolean => !a || (a.b === 1 && a.c === 1 && a.s === 1)
const isNeutralCrop = (c?: Crop): boolean => !c || (c.l === 0 && c.r === 0 && c.t === 0 && c.b === 0)
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** 数字の入る所だけを渡す（等倍・無調整は渡さない） */
function visualOf(c: {
  zoom?: Zoom
  rotate?: number
  flipH?: boolean
  flipV?: boolean
  opacity?: number
  adjust?: Adjust
  crop?: Crop
}): Record<string, unknown> {
  return {
    zoom: isNeutralZoom(c.zoom) ? undefined : c.zoom,
    rotate: c.rotate,
    flipH: c.flipH,
    flipV: c.flipV,
    opacity: c.opacity != null && c.opacity < 1 ? c.opacity : undefined,
    adjust: isNeutralAdjust(c.adjust) ? undefined : c.adjust,
    crop: isNeutralCrop(c.crop) ? undefined : c.crop
  }
}

/** 対の音声トラック（V2 → A2） */
export function pairedAudioTrack(videoTrack: string): string {
  return 'A' + (videoTrack.match(/\d+/)?.[0] ?? '2')
}

export function buildExportPayload(input: BuildInput): Record<string, unknown> {
  // 尺はすべて「素材の実尺で切り詰めた切片」から出す
  const clamped = input.segments.map((s) =>
    s.gap ? s : { ...s, srcEnd: Math.min(s.srcEnd, input.srcDurationOf(s) ?? s.srcEnd) }
  )
  const bodyLen = input.totalLen(clamped)
  // 本編より後ろに物が置いてあれば、そのぶん伸ばす（黒＋無音で埋める）
  const extendSec = Math.max(0, Math.max(0, ...input.tailEnds) - bodyLen)

  const srcIdxOf = (seg: Seg): number => {
    if (seg.srcId == null) return 0
    const i = input.sources.findIndex((s) => s.id === seg.srcId)
    return i < 0 ? 0 : i
  }
  // 重なりは下のトラックから。tracks は上から並んでいるので、後ろにある物を先に描く
  const bottomFirst = <T extends { track: string }>(list: T[]): T[] =>
    list
      .slice()
      .sort(
        (a, b) =>
          input.tracks.findIndex((t) => t.id === b.track) -
          input.tracks.findIndex((t) => t.id === a.track)
      )

  return {
    videoPath: input.videoPath,
    sources: input.sources.map((s) => ({ path: s.path })),
    width: input.size.width,
    height: input.size.height,
    frames: input.frames,
    extendSec,
    segments: clamped.map((s, i) => {
      const d = input.xfadeDurAt(clamped, i)
      return {
        srcIdx: srcIdxOf(s),
        srcStart: s.srcStart,
        srcEnd: s.srcEnd,
        muted: !!s.muted,
        // V1 の 👁 非表示はプレビューで真っ黒になるので、書き出しも同じにする
        videoBlank: !!s.videoBlank || input.v1Hidden,
        speed: input.speedOf(s),
        transIn: s.transIn,
        transOut: s.transOut,
        xfade: d > 0 ? { type: s.xfade?.type ?? 'fade', dur: d } : undefined,
        adjust: isNeutralAdjust(s.adjust) ? undefined : s.adjust,
        rotate: s.rotate,
        flipH: s.flipH,
        flipV: s.flipV,
        vol: s.vol,
        afadeIn: s.afadeIn,
        afadeOut: s.afadeOut,
        zoom: isNeutralZoom(s.zoom) ? undefined : s.zoom,
        crop: isNeutralCrop(s.crop) ? undefined : s.crop
      }
    }),
    // 効果音・BGM（トラック音量×マスターを掛けてから渡す）
    seClips: input.seClips.map((c) => ({
      path: c.path,
      tStart: c.tStart,
      duration: c.duration,
      srcOffset: c.srcOffset,
      volume: clamp(c.volume * input.gainOf(c.track), 0, 4),
      fadeIn: c.fadeIn,
      fadeOut: c.fadeOut,
      // 声に合わせて下げる指定。プレビューで使っているのと同じ折れ線を式にして渡す
      duckExpr: c.duck && input.duckExpr ? input.duckExpr : undefined
    })),
    // 映像レイヤー。👁非表示は映像だけ消す（不透明度0）。音は残す＝プレビューと同じ
    vClips: bottomFirst(
      input.vClips.map((c) => (input.hidden(c.track) ? { ...c, opacity: 0 } : c))
    ).map((c) => ({
      path: c.path,
      tStart: c.tStart,
      srcStart: c.srcStart,
      srcEnd: c.srcEnd,
      ...visualOf(c),
      volume: c.muted ? 0 : clamp((c.vol ?? 1) * input.gainOf(pairedAudioTrack(c.track)), 0, 4),
      fadeIn: c.afadeIn,
      fadeOut: c.afadeOut
    })),
    // 画像（👁非表示のトラックの物は焼かない）
    images: bottomFirst(input.imgClips.filter((c) => !input.hidden(c.track))).map((c) => ({
      path: c.path,
      tStart: c.tStart,
      duration: c.duration,
      ...visualOf(c)
    })),
    baseAudioVolume: input.gainOf('A1'),
    loudnormLUFS: input.loudnormLUFS,
    totalDurationSec: bodyLen + extendSec,
    fps: input.fps,
    crf: input.crf
  }
}
