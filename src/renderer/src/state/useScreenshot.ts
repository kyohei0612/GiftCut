// プレビューの見た目をそのまま1枚の絵にする（スクショ）。
//
// ## なぜ分けてあるか
//
// **「掴んで動かす」と「撮る」は別の話。** 元は state/usePreviewManip に同居していて、
// 731行のうち200行がここだった。渡す物を数えたら8個（引き継ぎ-App分割.md の
// 数え方で、40個までなら切ってよい）＝**切り出せる形だった**ので出した（2026-08-03）。
// 中身は1文字も変えていない。
//
// ## 撮るのは「いま見えている物」
//
// 本編の映像・重ねた映像レイヤー・画像・テロップを、プレビューと同じ重ね順・
// 同じ変形で描き直す。**動画が無くても撮る**（画像や文字だけで作っている画面がある）。

import { zoomAt, type ClipMotion, type Zoom } from '../../../shared/clipMotion'
import { adjustCss, cropInset } from '../lib/clipLook'
import { toGcUrl } from '../lib/gcUrl'
import { telopStateAt } from '../lib/telopStyle'
import { renderCueToPng } from '../lib/rasterize'
import type { Cue } from '../lib/srt'
import type { VClip } from '../lib/projectTypes'
import { useDoc } from './contentContext'
import { useMediaCtx } from './mediaContext'
import { usePlaybackCtx } from './playbackContext'
import { useExportCtx } from './exportContext'
import { useIconsCtx } from './iconsContext'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'

export interface UseScreenshotDeps {
  /** 本編の映像を映している <video> */
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
  /** いま本編の映像が隠されているか（👁・黒ブランク・尺の外） */
  v1Hidden: boolean
  curBlank: boolean
  videoTLen: number
  /** いまの切片の寄せ（プレビューの transform と同じ物） */
  curSegZoom: { scale: number; x: number; y: number }
  cueTrack: (c: Cue) => string
  vcLen: (c: VClip) => number
  iconForCue: (c: Cue) => string | undefined
}

export function useScreenshot(deps: UseScreenshotDeps) {
  const { videoRef, v1Hidden, curBlank, videoTLen, curSegZoom, cueTrack, vcLen, iconForCue } = deps
  const { cues, imgClips, vClips } = useDoc()
  const { tracks, trackStates } = useTracksCtx()
  const { videoSrc } = useMediaCtx()
  const { currentTimeRef } = usePlaybackCtx()
  const { ratio } = useExportCtx()
  const { iconAuto, iconOffset, iconScale, iconSide } = useIconsCtx()
  const { showToast } = useToastCtx()

  /**
   * スクショ。**途中でこけても、必ず理由を画面に出す。**
   *
   * ここは「絵を作る」「保存の窓を出す」の2段で、前半でこけると
   * **窓すら出ないまま何も起きない**（押しても無反応に見える）。
   * 実際に「撮っても保存されない」と言われたが、こちらでは再現できていない
   * ——原因を1つに決め打ちして直すのではなく、**次に起きたときに
   * 何が起きたかが分かる**ようにしてある。
   *
   * 何を捕まえるか:
   *   ・映像を写せない（配り方によっては canvas が「汚れた」扱いになる）
   *   ・テロップの絵づくり（renderCueToPng）でこける
   *   ・保存そのものが失敗する（こちらは元から出していた）
   */
  async function captureScreenshot(): Promise<void> {
    try {
      await captureScreenshotInner()
    } catch (e) {
      showToast(
        'スクショを作れませんでした。\n' +
          'この文言ごと知らせてください:\n' +
          String((e as Error)?.message ?? e),
        'error'
      )
    }
  }

  /**
   * 重ねる物（映像レイヤー・画像）を1枚、**プレビューと同じ変形で**描く。
   *
   * プレビューは CSS の `transform` でやっている（lib/clipXform）:
   *
   *   translate(x%,y%) → scale(s) → rotate → scaleX(-1) → scaleY(-1)  ／ 原点は中心
   *
   * ここは**その並びをそのままなぞる**。順番を入れ替えると、回した物の
   * 寄せ方向が変わって「撮った絵だけ位置が違う」になる。
   *
   * **2026-08-03 まで、ここも古い順（回す・反転が先）をなぞっていた。**
   * 画面側の CSS を直したので、こちらも一緒に直した。canvas は
   * **後から呼んだ変形ほど先に当たる**ので、CSS とは書く順が逆になる
   * （CSS: translate が左端 ⇔ canvas: translate を最後に呼ぶ）。
   * 明るさ等（`adjustCss`）と切り抜き（`cropInset` と同じ範囲）も同じ物を通す。
   *
   * ※ 切り抜きは**変形のあとに、その物の座標で**掛ける（CSS の clip-path と同じ順）。
   */
  function drawLayer(
    ctx: CanvasRenderingContext2D,
    el: CanvasImageSource,
    natW: number,
    natH: number,
    W: number,
    H: number,
    c: {
      rotate?: number
      flipH?: boolean
      flipV?: boolean
      zoom?: Zoom
      motion?: ClipMotion
      opacity?: number
      adjust?: { b: number; c: number; s: number }
      crop?: { l: number; t: number; r: number; b: number }
    },
    localT: number
  ): void {
    if (natW <= 0 || natH <= 0) return
    ctx.save()
    ctx.globalAlpha = c.opacity ?? 1
    const f = adjustCss(c.adjust)
    if (f) ctx.filter = f
    ctx.translate(W / 2, H / 2)
    // **動かすのを先に呼ぶ**（canvas は後から呼んだ物ほど先に当たるので、
    // これで「動かすのが最後に効く」＝画面の向きのまま動く）
    const z = zoomAt(c.zoom, c.motion, localT)
    ctx.translate(z.x * W, z.y * H)
    if (c.rotate) ctx.rotate((c.rotate * Math.PI) / 180)
    if (c.flipH) ctx.scale(-1, 1)
    if (c.flipV) ctx.scale(1, -1)
    ctx.scale(z.scale, z.scale)
    ctx.translate(-W / 2, -H / 2)
    if (c.crop && cropInset(c.crop)) {
      ctx.beginPath()
      ctx.rect(c.crop.l * W, c.crop.t * H, W * (1 - c.crop.l - c.crop.r), H * (1 - c.crop.t - c.crop.b))
      ctx.clip()
    }
    // object-fit: contain と同じ収め方
    const r = Math.min(W / natW, H / natH)
    ctx.drawImage(el, (W - natW * r) / 2, (H - natH * r) / 2, natW * r, natH * r)
    ctx.restore()
  }

  /** 画像を1枚読み込む（読めなければ null。撮影ごと止めない） */
  function loadImage(src: string): Promise<HTMLImageElement | null> {
    return new Promise((res) => {
      const img = new Image()
      img.onload = () => res(img)
      img.onerror = () => res(null)
      img.src = src
    })
  }

  // 現在のプレビュー画面（動画フレーム＋映像レイヤー＋画像＋テロップ）を PNG で保存。
  // 表示中と同じプロキシ映像を出力解像度で描き、テロップは書き出しと同じ rasterize を再利用。
  async function captureScreenshotInner(): Promise<void> {
    const v = videoRef.current
    const t0 = currentTimeRef.current
    // **動画が無くても撮る。** 画像だけ・文字だけで作っている所で撮れないのは
    // 「保存されない」としか見えない（実際そう言われた）。
    // 断るのは**本当に1つも出ていないとき**だけにする。
    const anyImg = imgClips.some(
      (c) => t0 >= c.tStart && t0 < c.tStart + c.duration && !trackStates[c.track]?.hidden
    )
    const anyVc = vClips.some((c) => {
      const local = t0 - c.tStart
      return local >= 0 && local < vcLen(c) && !trackStates[c.track]?.hidden
    })
    const anyCue = cues.some(
      (c) => !trackStates[cueTrack(c)]?.hidden && t0 >= c.start && t0 < c.end
    )
    if (!videoSrc && !anyImg && !anyVc && !anyCue) {
      showToast('いまの位置には、撮れる物が何もありません。\n動画・画像・文字のどれかを置いてから撮ってください。')
      return
    }
    const size =
      ratio === '16:9'
        ? { width: 1920, height: 1080 }
        : ratio === '9:16'
          ? { width: 1080, height: 1920 }
          : { width: 1080, height: 1080 }
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // 背景（動画が透明/レターボックスの部分）は黒で塗る
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, size.width, size.height)
    // 動画フレームをズーム変換込みで contain 描画（プレビューの transform と一致）
    const blank = curBlank || v1Hidden || (videoTLen > 0 && currentTimeRef.current >= videoTLen - 1e-3)
    const shotZoom = curSegZoom
    if (v && !blank && v.videoWidth > 0) {
      ctx.save()
      ctx.translate(shotZoom.x * size.width, shotZoom.y * size.height)
      ctx.translate(size.width / 2, size.height / 2)
      ctx.scale(shotZoom.scale, shotZoom.scale)
      ctx.translate(-size.width / 2, -size.height / 2)
      const r = Math.min(size.width / v.videoWidth, size.height / v.videoHeight)
      const dw = v.videoWidth * r
      const dh = v.videoHeight * r
      ctx.drawImage(v, (size.width - dw) / 2, (size.height - dh) / 2, dw, dh)
      ctx.restore()
    }
    // 重ねている映像レイヤーを描く。**実物の <video> をそのまま使う**——
    // 撮りたいのは「いま見えている絵」なので、読み直すと違うコマになる。
    // 実物は画面側が data-vcid を付けて出している（components/panels/PreviewLayers）
    for (const c of vClips) {
      const local = t0 - c.tStart
      if (local < 0 || local >= vcLen(c) || trackStates[c.track]?.hidden) continue
      const el = document.querySelector<HTMLVideoElement>(`.screen-vclip[data-vcid="${c.id}"]`)
      if (!el || el.videoWidth <= 0) continue
      drawLayer(ctx, el, el.videoWidth, el.videoHeight, size.width, size.height, c, local)
    }
    // 画像を描く。**並べ替えはプレビューと同じ**（前後が入れ替わると重なりが変わる）
    const imgShown = imgClips
      .filter((c) => t0 >= c.tStart && t0 < c.tStart + c.duration && !trackStates[c.track]?.hidden)
      .slice()
      .sort(
        (a, b) =>
          tracks.findIndex((tr) => tr.id === b.track) - tracks.findIndex((tr) => tr.id === a.track)
      )
    for (const c of imgShown) {
      const el = await loadImage(toGcUrl(c.path))
      if (!el) continue
      drawLayer(ctx, el, el.naturalWidth, el.naturalHeight, size.width, size.height, c, t0 - c.tStart)
    }
    // テロップ（👁表示中のみ）を書き出しと同じ描画で重ねる
    const t = currentTimeRef.current
    const shown = cues.filter(
      (c) => !trackStates[cueTrack(c)]?.hidden && t >= c.start && t < c.end
    )
    for (const c of shown) {
      const avatar = iconForCue(c)
      const asc = avatar ? iconScale : 1
      const st = telopStateAt(c.style.anim, c.motion, t - c.start, c.end - c.start)
      const png = await renderCueToPng(
        c, size.width, size.height, avatar, asc, st, iconSide, iconOffset.x, iconOffset.y, iconAuto
      )
      await new Promise<void>((res) => {
        const img = new Image()
        img.onload = () => {
          ctx.drawImage(img, 0, 0, size.width, size.height)
          res()
        }
        img.onerror = () => res()
        img.src = png
      })
    }
    // **ここは一番こけやすい所。** 映像を描いたキャンバスは、配り方によっては
    // 「汚れた」扱いになり `toDataURL()` が例外を投げる。捕まえないと
    // **保存の窓すら出ないまま何も起きない**（押しても無反応に見える）。
    // 上の包みでも拾えるが、原因が読める言い方にしたいのでここでも見る。
    let dataUrl: string
    try {
      dataUrl = canvas.toDataURL('image/png')
    } catch (e) {
      throw new Error('映像を画像に写せませんでした（' + String(e) + '）')
    }
    const r = await window.giftcut.saveImage(dataUrl)
    if (r?.ok && r.path) showToast('スクショを保存しました:\n' + r.path, 'success')
    else if (r?.error && r.error !== 'キャンセル') showToast('保存失敗: ' + r.error, 'error')
  }

  return { captureScreenshot }
}
