// プレビューに出す「いまの絵」を組み立てる。回転・拡大・つなぎ目の演出を1枚に合成する。
//
// ## 掛ける順番に意味がある
//
// **映像自体を回す／反転する → 拡大する → 演出（slide / wipe）を掛ける**。
// 順番を変えると、回した後に横へ流したいのに斜めに流れる、といったことが起きる。
//
// ## 演出は2通りの出し方がある
//
// dip系（フェード・黒・白）… 映像の上に色を重ねる
// slide / wipe            … 映像そのものを動かす／削る
//
// 同じ「つなぎ目の演出」でも出し方が違うので、どちらなのかで分ける。
//
// ## クロスディゾルブは2本目の映像を重ねる
//
// カットの手前 d 秒から次の切片を別の <video> に出し、薄→濃で重ねる。
// **カットを過ぎてもしばらく重ねたまま**にする。1本目が次の場所へ飛び終わるまで、
// 前の切片の最後のコマが素通しで見えてちらつくため（飛ぶのは数コマ遅れる）。
//
// 次に来る演出のB側は**少し前から読み込んでおく**。始まる瞬間に読み込むと、
// そこで引っかかる。

import { XF_GRACE } from '../lib/appConst'
import { clamp, segSpeed, tToSource, xfadeDurAt } from '../../../shared/timeline'
import { dipColor } from '../lib/transitions'
import { useDoc } from './contentContext'
import { useMediaCtx } from './mediaContext'
import { usePlaybackCtx } from './playbackContext'
import { isNeutralZoom } from '../lib/clipLook'
import type { Layout } from '../../../shared/timeline'
import type { Source, VSeg } from '../lib/projectTypes'

export interface UsePreviewFrameDeps {
  /** クロスディゾルブを、カットを過ぎてから何秒だけ重ねたままにするか */
  segLayout: Layout<VSeg>[]
  srcOfSeg: (seg: VSeg | undefined) => Source | undefined
  /** 再生ヘッド位置の切片の拡大・切り抜き */
  curSegZoom: { scale: number; x: number; y: number }
  curCropInset: string | undefined
  /** 元動画の再生用URL（焼き直し済みがあればそちら） */
  previewUrl: (path: string, orig: string) => string
}

export function usePreviewFrame(deps: UsePreviewFrameDeps) {
  const { segLayout, srcOfSeg, curSegZoom, curCropInset, previewUrl } = deps
  const { segments } = useDoc()
  const { videoSrc, sources } = useMediaCtx()
  const { currentTime } = usePlaybackCtx()

  // 再生ヘッド位置の切片の回転/反転（CSS transform）。ズーム/トランジションと合成する。
  const curSegXform = (() => {
    const src = tToSource(segLayout, currentTime)
    const seg = src ? segments[src.index] : undefined
    if (!seg) return ''
    const parts: string[] = []
    if (seg.rotate) parts.push(`rotate(${seg.rotate}deg)`)
    if (seg.flipH) parts.push('scaleX(-1)')
    if (seg.flipV) parts.push('scaleY(-1)')
    return parts.join(' ')
  })()
  // 動画ズームのCSS変換（プレビュー用・現切片）。translateはフレーム比→%、原点は中心。
  const videoZoomTransform = isNeutralZoom(curSegZoom)
    ? undefined
    : `translate(${(curSegZoom.x * 100).toFixed(3)}%, ${(curSegZoom.y * 100).toFixed(3)}%) scale(${curSegZoom.scale.toFixed(4)})`
  // 頭/尻トランジションのプレビュー。dip系(fade/黒/白)は色オーバーレイ、slide/wipeは映像自体を動かす。
  // 現在の切片の in/out と再生ヘッド位置から「進捗 p(0..1)」を出す。xfade境界のディップは出さない。
  const inOutPreview = (() => {
    const L = segLayout.find((l: { tStart: number; tEnd: number }) => currentTime >= l.tStart && currentTime < l.tEnd)
    if (!L) return null
    const local = currentTime - L.tStart
    const ti = L.seg.transIn
    const to = L.seg.transOut
    const xfPrev = L.index > 0 ? xfadeDurAt(segLayout, L.index - 1) : 0
    const xfNext = xfadeDurAt(segLayout, L.index)
    if (ti && ti.dur > 0 && local < ti.dur && !xfPrev)
      return { type: ti.type, dir: 'in' as const, p: clamp(local / ti.dur, 0, 1) }
    if (to && to.dur > 0 && local > L.len - to.dur && !xfNext)
      return { type: to.type, dir: 'out' as const, p: clamp((local - (L.len - to.dur)) / to.dur, 0, 1) }
    return null
  })()
  // dip系の色オーバーレイ（頭=色→映像、尻=映像→色）。slide/wipe のときは null（映像側で表現）。
  const transOverlay = (() => {
    if (!inOutPreview) return null
    const col = dipColor(inOutPreview.type)
    if (!col) return null
    // in: p=0で覆い1→p=1で0 / out: p=0で0→p=1で1
    const opacity = inOutPreview.dir === 'in' ? 1 - inOutPreview.p : inOutPreview.p
    return { color: col, opacity }
  })()
  // 頭/尻が slide/wipe のとき、メイン映像に掛けるCSS（回転/反転・ズーム変換と合成）。
  const videoMainStyle = (() => {
    // トランジション（slide/wipe）分の transform / clipPath
    const trans: React.CSSProperties = (() => {
      const base: React.CSSProperties = { transform: videoZoomTransform }
      if (!inOutPreview || dipColor(inOutPreview.type)) return base
      const { type, dir, p } = inOutPreview
      const off = (dir === 'in' ? 1 - p : p) * 100
      const zoom = videoZoomTransform ? ` ${videoZoomTransform}` : ''
      if (type === 'slideleft') return { transform: `translateX(${dir === 'in' ? off : -off}%)${zoom}` }
      if (type === 'slideright') return { transform: `translateX(${dir === 'in' ? -off : off}%)${zoom}` }
      if (type === 'slideup') return { transform: `translateY(${dir === 'in' ? off : -off}%)${zoom}` }
      if (type === 'slidedown') return { transform: `translateY(${dir === 'in' ? -off : off}%)${zoom}` }
      if (type === 'wipeleft') return { transform: videoZoomTransform, clipPath: `inset(0 0 0 ${off}%)` }
      if (type === 'wiperight') return { transform: videoZoomTransform, clipPath: `inset(0 ${off}% 0 0)` }
      return base
    })()
    // 現切片の回転/反転を先頭に合成（＝映像自体を回す/反転させてから、ズーム/スライドを掛ける）
    const tf = [curSegXform, trans.transform].filter(Boolean).join(' ')
    // クロップ（clip-path inset）。wipe中はwipe側のclipPathを優先（trans.clipPathがあればそれを使う）。
    const clip = trans.clipPath ?? curCropInset
    return { ...trans, transform: tf || undefined, clipPath: clip }
  })()

  // クロスディゾルブのプレビュー状態: 再生ヘッドが [カット-d, カット) にいる間、
  // 次クリップ(B)を2本目のvideoでオーバーレイし opacity 0→1 でフェードイン。
  // カット到達後も XF_GRACE 秒だけ B を不透明で保持し、main が B にシークし終わるまで
  // A の最終フレームが素通しでちらつくのを防ぐ（プロキシでもシークは1〜数フレーム遅れる）。
  const xfPreview = (() => {
    if (!videoSrc) return null
    for (let i = 0; i < segLayout.length - 1; i++) {
      const d = xfadeDurAt(segLayout, i)
      if (!d) continue
      const cut = segLayout[i].tEnd
      const B = segLayout[i + 1]
      const sp = segSpeed(B.seg)
      const blank = !!B.seg.videoBlank // 黒ブランクへのディゾルブは黒divのフェードで表現
      const type = segLayout[i].seg.xfade?.type ?? 'fade'
      // マルチソース: B側は自分の元動画のURL/ズームでプレビュー（A側と別ソースでも正しい映像）
      const bs = srcOfSeg(B.seg)
      const bUrl = bs ? previewUrl(bs.path, bs.origUrl) : null
      const bZoom = B.seg.zoom
      if (currentTime >= cut - d && currentTime < cut) {
        // トランジション中: B がソース頭の手前(srcStart - 残り*速度)から先読み。p=進捗0→1。
        //
        // **手前が足りないぶんは、最初のコマで止める**（書き出しの `tpad=start_mode=clone`
        // と同じ絵にする）。止めないと、要求が 0秒に張り付いたまま B だけ流れ続け、
        // ズレを直す度に頭へ引き戻される＝**先頭の0.25秒を繰り返す**別の絵になる。
        const want = B.seg.srcStart - (cut - currentTime) * sp
        return {
          p: clamp(1 - (cut - currentTime) / d, 0, 1),
          type,
          blank,
          srcTime: Math.max(0, want),
          frozen: want <= 0,
          speed: sp,
          bUrl,
          bZoom
        }
      }
      if (currentTime >= cut && currentTime < cut + XF_GRACE) {
        // カット直後の猶予: main が B に追いつくまで B 本編を不透明で保持
        return {
          p: 1,
          type,
          blank,
          srcTime: B.seg.srcStart + (currentTime - cut) * sp,
          frozen: false, // カットを過ぎたら B は本編なので必ず動く
          speed: sp,
          bUrl,
          bZoom
        }
      }
    }
    return null
  })()
  // 次に来る「間トランジション」のB側ソースURLを先読み（境界の少し前からvideoBへロードしておき、
  // ディゾルブ開始の瞬間にsrc切替リロードのヒッチが出ないようにする）。マルチソース時のみ。
  const xfNextBUrl = (() => {
    if (!videoSrc || sources.length <= 1) return null
    for (let i = 0; i < segLayout.length - 1; i++) {
      const d = xfadeDurAt(segLayout, i)
      if (!d) continue
      const cut = segLayout[i].tEnd
      if (cut + XF_GRACE < currentTime) continue // 既に過ぎた境界
      if (cut - currentTime > 8) break // 8秒より先はまだ読まない
      const bs = srcOfSeg(segLayout[i + 1].seg)
      return bs ? previewUrl(bs.path, bs.origUrl) : null
    }
    return null
  })()
  // 黒/白ディップを「間」に置いたとき、書き出し(fadeblack/fadewhite)に合わせて色に沈んで戻る覆い。
  // 中央(p=0.5)で覆いが最大＝一度色に沈み、B が出てくる。
  const xfDipOverlay = (() => {
    if (!xfPreview || xfPreview.blank) return null
    const col = dipColor(xfPreview.type)
    if (!col) return null
    return { color: col, opacity: 1 - Math.abs(1 - 2 * xfPreview.p) }
  })()


  return {
    curSegXform, videoZoomTransform, inOutPreview, transOverlay, videoMainStyle,
    xfPreview, xfNextBUrl, xfDipOverlay
  }
}
