// 保存した物を、いまの形へ整え直す。
//
// ## なぜ画面から出したか
//
// **ここは「静かに消える」事故が集まる場所。**
// 中のコメントがその記録になっている——ラベルの色、打った動き、部分装飾。
// どれも「読み込む側に書き足すのを忘れた」だけで、保存はされているのに
// 開き直すと消えていた。エラーも出ないので、気づくのは何日も後になる。
//
// App.tsx の奥（500行の関数の中）にあったので、**画面を起動しないと試せなかった**。
// 出しておけば、古い形のデータを渡して「消えないこと」を試験で押さえられる。
//
// ## 決まりごと
//
// ・**id はファイルの値を信用しない。** 振り直す（NaN や重複で採番が汚れる）
// ・**知らない値は捨てる。** 既定へ寄せるより、無い物として扱う方が安全
// ・**新しい項目を足したら、必ずここにも足す。** 忘れると静かに消える

/* eslint-disable @typescript-eslint/no-explicit-any */
import { defaultTelopStyle, sanitizeMotion } from './telopStyle'
import { loadSegTrans } from './transitions'
import { isNeutralZoom, isNeutralCrop, isNeutralAdjust } from './clipLook'
import { sanitizeClipMotion } from '../../../shared/clipMotion'
import { clamp } from '../../../shared/timeline'
import type { Cue } from './srt'
import type { Marker, VSeg, SEClip, ImgClip, VClip } from './projectTypes'

/**
 * 「そのトラックが今もあるか」を見て、無ければ在る物へ寄せる。
 *
 * **どのトラックが在るかは画面側しか知らない**ので、受け取る。
 * 消えたトラックを指したままにすると、タイムラインに出ないのに
 * プレビューと書き出しには出る「見えないクリップ」になる。
 */
export type TrackFix = (id: string, kind: 'video' | 'audio') => string

/**
 * 部分装飾（文字の一部だけ色や太さを変えた指定）を拾う。
 *
 * 始まりと終わりが数で、終わりの方が後ろにある物だけ残す。
 * **1つも残らなければ「無い」ことにする**（空の配列は「装飾あり」に見える）。
 */
function keepRuns(raw: any): any[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined
  const ok = raw
    .filter(
      (r: any) => typeof r?.start === 'number' && typeof r?.end === 'number' && r.end > r.start
    )
    .map((r: any) => ({ ...r }))
  return ok.length ? ok : undefined
}

/** テロップの既定のラベル色（付いていない物は、この色として扱う） */
const DEFAULT_LABEL = 'none'

export function loadCues(raw: any): Cue[] {
  return Array.isArray(raw)
    ? raw.map((c: any, i: number) => ({
        id: i + 1,
        start: Number(c.start) || 0,
        end: Number(c.end) || 0,
        text: String(c.text ?? ''),
        style: { ...defaultTelopStyle(), ...(c.style ?? {}) },
        // 部分装飾（保存はcues丸ごとだが読込側で落ちていた＝保存→開くとリッチテキスト消失バグの修正）
        //
        // **全部おかしければ「無い」ことにする。** 空の配列を残すと、
        // 装飾が付いている札として扱われる（見た目は素なのに、
        // 装飾ありの道を通る＝直すときに話が合わなくなる）
        runs: keepRuns(c.runs),
        scale: typeof c.scale === 'number' && c.scale > 0 ? c.scale : undefined, // テロップ拡縮も同様に復元
        label: typeof c.label === 'string' ? c.label : DEFAULT_LABEL,
        iconImage: typeof c.iconImage === 'string' ? c.iconImage : undefined,
        personIcon: c.personIcon === false ? false : undefined,
        pos:
          c.pos && typeof c.pos.x === 'number' && typeof c.pos.y === 'number'
            ? { x: c.pos.x, y: c.pos.y }
            : { x: 0.5, y: 0.85 },
        // V1以外の映像トラックIDはそのまま維持（V4等へ退避したテロップが戻らなくなるのを防ぐ）
        track:
          typeof c.track === 'string' && /^V\d+$/.test(c.track) && c.track !== 'V1'
            ? c.track
            : undefined,
        // 自分で打った動き（モーション）。ここで拾い忘れると、保存して開き直した
        // 瞬間に動きだけ静かに消える（クリップの色で同じ事故があった）
        motion: sanitizeMotion(c.motion)
      }))
    : []
}

export function loadSegs(raw: any): VSeg[] {
  return Array.isArray(raw)
    ? raw.map((s: any, i: number) => ({
        id: i + 1,
        srcId: typeof s.srcId === 'number' ? s.srcId : undefined,
        srcStart: Number(s.srcStart) || 0,
        srcEnd: Number(s.srcEnd) || 0,
        muted: s.muted === true ? true : undefined,
        videoBlank: s.videoBlank === true ? true : undefined,
        // atempo は 0.5〜100 しか受け付けないので、読み込み時にその範囲へクランプ
        speed:
          typeof s.speed === 'number' && s.speed > 0 ? clamp(s.speed, 0.5, 8) : undefined,
        transIn: loadSegTrans(s.transIn),
        transOut: loadSegTrans(s.transOut),
        xfade: loadSegTrans(s.xfade),
        adjust:
          s.adjust &&
          typeof s.adjust.b === 'number' &&
          typeof s.adjust.c === 'number' &&
          typeof s.adjust.s === 'number' &&
          !isNeutralAdjust(s.adjust)
            ? { b: s.adjust.b, c: s.adjust.c, s: s.adjust.s }
            : undefined,
        rotate: typeof s.rotate === 'number' && s.rotate ? (((s.rotate % 360) + 360) % 360) || undefined : undefined,
        flipH: s.flipH === true ? true : undefined,
        flipV: s.flipV === true ? true : undefined,
        vol: typeof s.vol === 'number' && s.vol >= 0 && s.vol !== 1 ? s.vol : undefined,
        afadeIn: typeof s.afadeIn === 'number' && s.afadeIn > 0 ? s.afadeIn : undefined,
        afadeOut: typeof s.afadeOut === 'number' && s.afadeOut > 0 ? s.afadeOut : undefined,
        zoom:
          s.zoom &&
          typeof s.zoom.scale === 'number' &&
          typeof s.zoom.x === 'number' &&
          typeof s.zoom.y === 'number' &&
          !isNeutralZoom(s.zoom)
            ? { scale: s.zoom.scale, x: s.zoom.x, y: s.zoom.y }
            : undefined,
        // 自分で打った動き。ここで拾い忘れると、保存して開き直した瞬間に
        // 動きだけ静かに消える（テロップの色・モーションで同じ事故がある）
        motion: sanitizeClipMotion(s.motion),
        crop:
          s.crop &&
          typeof s.crop.l === 'number' &&
          typeof s.crop.t === 'number' &&
          typeof s.crop.r === 'number' &&
          typeof s.crop.b === 'number' &&
          !isNeutralCrop(s.crop)
            ? { l: s.crop.l, t: s.crop.t, r: s.crop.r, b: s.crop.b }
            : undefined,
        // ラベルカラー。ここに書き忘れていたため、色を付けて保存しても
        // 開き直すと消えていた（他の種類は保存されるので余計に分かりにくい）。
        label: typeof s.label === 'string' && s.label ? s.label : undefined,
        gap: s.gap === true ? true : undefined
      }))
    : []
}

export function loadSeClips(raw: any): SEClip[] {
  return Array.isArray(raw)
    ? raw.map((s: any, i: number) => ({
        id: i + 1,
        path: String(s.path ?? ''),
        name: String(s.name ?? (s.path ? String(s.path).split(/[\\/]/).pop() : 'SE')),
        tStart: Number(s.tStart) || 0,
        duration: Number(s.duration) || 1,
        volume: typeof s.volume === 'number' ? s.volume : 1,
        fadeIn: typeof s.fadeIn === 'number' ? s.fadeIn : 0,
        fadeOut: typeof s.fadeOut === 'number' ? s.fadeOut : 0,
        track: typeof s.track === 'string' ? s.track : 'A2',
        srcOffset: typeof s.srcOffset === 'number' && s.srcOffset > 0 ? s.srcOffset : undefined,
        srcDur: typeof s.srcDur === 'number' && s.srcDur > 0 ? s.srcDur : undefined,
        // ここに足し忘れると、保存して開き直したときに設定だけ消える
        // （クリップの色で実際にやらかしている）
        duck: s.duck === true ? true : undefined
      }))
    : []
}

export function loadMarkers(raw: any): Marker[] {
  return Array.isArray(raw)
    ? raw
        .filter((m: any) => m && typeof m.t === 'number' && m.t >= 0)
        .map((m: any, i: number) => ({ id: i + 1, t: m.t, label: String(m.label ?? '') }))
        .sort((a: Marker, b: Marker) => a.t - b.t)
    : []
}

export function loadImgClips(raw: any, fallbackTrack: TrackFix): ImgClip[] {
  return Array.isArray(raw)
    ? raw
        .filter((c: any) => c && typeof c.path === 'string' && typeof c.tStart === 'number')
        .map((c: any, i: number) => ({
          id: i + 1,
          path: c.path,
          name: String(c.name ?? c.path.split(/[\\/]/).pop() ?? '画像'),
          tStart: Math.max(0, Number(c.tStart) || 0),
          duration: Number(c.duration) > 0 ? Number(c.duration) : 5,
          // 存在しないトラックを指したままだと、タイムラインに出ないのに
          // プレビューと書き出しには出る「見えないクリップ」になる
          track: fallbackTrack(typeof c.track === 'string' ? c.track : 'V3', 'video'),
          zoom:
            c.zoom &&
            typeof c.zoom.scale === 'number' &&
            typeof c.zoom.x === 'number' &&
            typeof c.zoom.y === 'number' &&
            !isNeutralZoom(c.zoom)
              ? { scale: c.zoom.scale, x: c.zoom.x, y: c.zoom.y }
              : undefined,
          motion: sanitizeClipMotion(c.motion),
          rotate:
            typeof c.rotate === 'number' && c.rotate
              ? ((c.rotate % 360) + 360) % 360 || undefined
              : undefined,
          flipH: c.flipH === true ? true : undefined,
          flipV: c.flipV === true ? true : undefined,
          opacity:
            typeof c.opacity === 'number' && c.opacity >= 0 && c.opacity < 1
              ? c.opacity
              : undefined,
          adjust:
            c.adjust &&
            typeof c.adjust.b === 'number' &&
            typeof c.adjust.c === 'number' &&
            typeof c.adjust.s === 'number' &&
            !isNeutralAdjust(c.adjust)
              ? { b: c.adjust.b, c: c.adjust.c, s: c.adjust.s }
              : undefined,
          crop:
            c.crop &&
            typeof c.crop.l === 'number' &&
            typeof c.crop.t === 'number' &&
            typeof c.crop.r === 'number' &&
            typeof c.crop.b === 'number' &&
            !isNeutralCrop(c.crop)
              ? { l: c.crop.l, t: c.crop.t, r: c.crop.r, b: c.crop.b }
              : undefined
        }))
    : []
}

export function loadVClips(raw: any, fallbackTrack: TrackFix): VClip[] {
  return Array.isArray(raw)
    ? raw
        .filter(
          (c: any) =>
            c &&
            typeof c.path === 'string' &&
            typeof c.tStart === 'number' &&
            typeof c.srcEnd === 'number'
        )
        .map((c: any, i: number) => ({
          id: i + 1,
          path: c.path,
          name: String(c.name ?? c.path.split(/[\\/]/).pop() ?? '動画'),
          track: typeof c.track === 'string' ? c.track : 'V2',
          tStart: Math.max(0, Number(c.tStart) || 0),
          srcStart: Math.max(0, Number(c.srcStart) || 0),
          srcEnd: Number(c.srcEnd) || 0,
          srcDur: typeof c.srcDur === 'number' && c.srcDur > 0 ? c.srcDur : undefined,
          zoom:
            c.zoom && typeof c.zoom.scale === 'number' && !isNeutralZoom(c.zoom)
              ? { scale: c.zoom.scale, x: c.zoom.x, y: c.zoom.y }
              : undefined,
          motion: sanitizeClipMotion(c.motion),
          rotate:
            typeof c.rotate === 'number' && c.rotate
              ? ((c.rotate % 360) + 360) % 360 || undefined
              : undefined,
          flipH: c.flipH === true ? true : undefined,
          flipV: c.flipV === true ? true : undefined,
          opacity:
            typeof c.opacity === 'number' && c.opacity >= 0 && c.opacity < 1
              ? c.opacity
              : undefined,
          adjust:
            c.adjust && typeof c.adjust.b === 'number' && !isNeutralAdjust(c.adjust)
              ? { b: c.adjust.b, c: c.adjust.c, s: c.adjust.s }
              : undefined,
          crop:
            c.crop && typeof c.crop.l === 'number' && !isNeutralCrop(c.crop)
              ? { l: c.crop.l, t: c.crop.t, r: c.crop.r, b: c.crop.b }
              : undefined,
          muted: c.muted === true ? true : undefined,
          vol: typeof c.vol === 'number' && c.vol !== 1 ? c.vol : undefined,
          afadeIn: typeof c.afadeIn === 'number' && c.afadeIn > 0 ? c.afadeIn : undefined,
          afadeOut: typeof c.afadeOut === 'number' && c.afadeOut > 0 ? c.afadeOut : undefined
        }))
    : []
}

/* eslint-enable @typescript-eslint/no-explicit-any */
