// プレビューに出す「いまの絵」を組み立てる。回転・拡大・つなぎ目の演出を1枚に合成する。
//
// ## 掛ける順番に意味がある
//
// CSS は**右にある物から先に**当たるので、**動かす物ほど左**に置く:
//
//   演出（slide） → 動かす・寄せる（translate/scale） → 回す → 反転
//
// **順番は自分で書かない。** 見た目は正典 `lib/clipXform`、演出との繋ぎは
// 同ファイルの `moveThen` が持つ（画面と書き出しを揃える式なので、
// 写すと片方だけ古くなる）。
//
// 2026-08-17 まで**ここだけ逆だった**（回転・反転が左）。そのせいで
// 反転した映像はプレビューで右へ掴むと左へ動き、回した映像は回った向きへ動いた。
// `lib/clipXform` は 08-03 に直っていたが、あちらが持つのは**重ねた物**
// （映像レイヤー・画像）で、**再生ヘッド位置の本線はここ**だった。
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
import { clipXform, moveThen } from '../lib/clipXform'
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

  // 再生ヘッド位置の切片の「寄り・回転・反転」（CSS transform）。**正典1つで作る。**
  // `curSegZoom` は動きの印を当てたあとの値（`useCurrentLook`）なので、
  // ここへ motion は渡さない（二度掛けになる）。
  const curSegXform = (() => {
    const src = tToSource(segLayout, currentTime)
    const seg = src ? segments[src.index] : undefined
    if (!seg) return undefined
    return clipXform({
      rotate: seg.rotate,
      flipH: seg.flipH,
      flipV: seg.flipV,
      zoom: curSegZoom
    })
  })()
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
  // 頭/尻が slide/wipe のとき、メイン映像に掛けるCSS（切片の見た目と合成）。
  const videoMainStyle = (() => {
    // **演出ぶんだけ**を出す。寄り・回転・反転はここで混ぜない
    //（混ぜると、繋ぎ方が2か所に書かれて片方だけ古くなる）
    const trans: { move?: string; clipPath?: string } = (() => {
      if (!inOutPreview || dipColor(inOutPreview.type)) return {}
      const { type, dir, p } = inOutPreview
      const off = (dir === 'in' ? 1 - p : p) * 100
      if (type === 'slideleft') return { move: `translateX(${dir === 'in' ? off : -off}%)` }
      if (type === 'slideright') return { move: `translateX(${dir === 'in' ? -off : off}%)` }
      if (type === 'slideup') return { move: `translateY(${dir === 'in' ? off : -off}%)` }
      if (type === 'slidedown') return { move: `translateY(${dir === 'in' ? -off : off}%)` }
      if (type === 'wipeleft') return { clipPath: `inset(0 0 0 ${off}%)` }
      if (type === 'wiperight') return { clipPath: `inset(0 ${off}% 0 0)` }
      return {}
    })()
    // **動かす物ほど左**（演出 → 寄り → 回す → 反転）。順番は `lib/clipXform` が持つ
    // クロップ（clip-path inset）。wipe中はwipe側のclipPathを優先
    return {
      transform: moveThen(trans.move, curSegXform),
      clipPath: trans.clipPath ?? curCropInset
    }
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
      // B側の見た目も**正典1つ**で作る（A側と同じ順番になる）。
      //
      // 2026-08-17 まで**ズームしか渡していなかった**ので、つなぎ目の間だけ
      // B の回転・反転が外れ、切り替わり切った瞬間に元へ戻っていた。
      // 動きの印は頭（0秒）で読む——B はまだ自分の先頭しか見せていない。
      const bXform = clipXform(B.seg, 0)
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
          bXform
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
          bXform
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
    curSegXform, inOutPreview, transOverlay, videoMainStyle,
    xfPreview, xfNextBUrl, xfDipOverlay
  }
}
