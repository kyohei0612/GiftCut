// 書き出しに渡す**形（型）だけ**を置く。関数は1つも無い。
//
// ## なぜ形だけ切り出したか（2026-08-04）
//
// 組み立て側（重ねる段・切片・音）は3つに分かれたが、**受け取る形は3つとも同じ**。
// どれかの中に置くと、他の2つがその1つを見に行くことになり「重ねる段が切片を
// 知っている」ように見える。形だけ下へ置けば、3つは**互いを知らないまま**でいられる。
//
// ## 画面側と同じ形か
//
// ここは main（書き出し）側の受け取り口で、画面側の `lib/projectTypes` とは別物。
// **わざと別**——画面には要るが書き出しに要らない物（選択状態・表示倍率）を
// 持ち込まないため。増やすときは「ffmpeg の式を組むのに要るか」で決める。
//
// ## 中身
//
// - `ExportCrop` … 各辺の切り抜き率
// - `ExportAdjust` … 色調整（明るさ/コントラスト/彩度）
// - `ExportZoom` … 拡大と位置
// - `ExportFrame` … テロップ1枚とその表示窓
// - `ExportSeg` … 本編（V1）の切片1つ
// - `ExportSEClip` … 効果音クリップ
// - `ExportImageClip` … 画像クリップ
// - `ExportVClip` … 映像レイヤークリップ（V2以降）
// - `ExportTelopSeq` … 連番でまとめたテロップ1本
// - `ExportPayload` … 上を全部束ねた、書き出し1回ぶんの入力
import type { ClipMotion } from '../shared/clipMotion'

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
