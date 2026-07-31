// タイムラインに載る物の形。
//
// **App.tsx の中に書いていたので、外から触れなかった。**
// 読み込みの整え直し（projectLoad）も、部品も、同じ形を見る必要があるのに
// 型が画面の中に閉じていたせいで、各所で作り直す羽目になっていた。
//
// ※ shared/exportPayload.ts にも VClip / ImgClip があるが、あちらは
//    **書き出しに渡す形**（id や name を持たない）。役目が違うので別物。

import type { ClipMotion } from '../../../shared/clipMotion'
import type { Layout } from '../../../shared/timeline'
import type { SegTrans } from './transitions'

export interface VSeg {
  id: number
  srcId?: number // どの元動画か（マルチソース）。未指定=主ソース(sources[0])。
  srcStart: number // ソース動画内のイン点（秒）
  srcEnd: number // アウト点（秒）
  muted?: boolean // この区間の音声を消す（動画は残す）
  videoBlank?: boolean // この区間の映像を黒にする（長さは維持＝詰めない。音声は残る）
  speed?: number // 再生速度（1=等速, 2=2倍速, 0.5=スロー）。未指定は1
  // 頭(transIn)/尻(transOut)/次クリップとの間(xfade)。全て同じ TransType＝どの種類もどこにでも置ける。
  transIn?: SegTrans
  transOut?: SegTrans
  xfade?: SegTrans
  // 色調整（明るさ/コントラスト/彩度）。倍率で 1=無調整。プレビュー=CSS filter、書き出し=ffmpeg eq。
  adjust?: { b: number; c: number; s: number }
  rotate?: number // 回転角（度・時計回り、自由角度）。未指定=0
  flipH?: boolean // 左右反転
  flipV?: boolean // 上下反転
  vol?: number // この切片の音量倍率（0=無音, 1=等倍）。未指定=1
  afadeIn?: number // 音声フェードイン（秒）
  afadeOut?: number // 音声フェードアウト（秒）
  zoom?: { scale: number; x: number; y: number } // リフレーム（拡大率＋中心オフセット, フレーム比）
  // 動き（キーフレーム）。上の zoom を時間の関数にする。印が無ければ zoom は固定値のまま。
  motion?: ClipMotion
  crop?: { l: number; t: number; r: number; b: number } // クロップ（各辺の切り抜き率 0..1。切った領域は黒）
  label?: string // ラベルカラー（テロップと同じ。素材の見分け用）
  gap?: boolean // タイムラインの空白（映像なし・無音）。「位置を指定して配置」した際の隙間埋め。
}

export interface Source {
  id: number
  path: string // 原本パス（書き出しに使用＝無劣化）
  name: string
  origUrl: string // 原本の gcfile URL（プレビュー用プロキシは path をキーに proxyMap で持つ）
  duration: number
  fps: number
  // 波形は自分が解析した音声の長さ(dur)も持つ。動画の尺で位置を計算すると
  // 音声ストリームとの尺差ぶん、後ろに行くほど再生ヘッドとズレる。
  waveform?: { min: number[]; max: number[]; dur: number } | null
}

export interface Track {
  id: string
  name: string
  kind: 'video' | 'audio'
}

export interface TrackState {
  target: boolean
  hidden: boolean
  muted: boolean
  solo: boolean
  locked: boolean
  volume: number // 音量ゲイン 0..1（オーディオミキサー用。1=0dB）
}

export interface SEClip {
  id: number
  label?: string
  path: string
  name: string
  tStart: number
  duration: number
  volume: number
  fadeIn: number // フェードイン秒
  fadeOut: number // フェードアウト秒
  track: string // 載っているトラック（'A2'=SE / 'A3'=BGM）。既定はA2。
  srcOffset?: number // 音源内の開始オフセット秒（左端トリム/分割で進む）。未指定=0
  srcDur?: number // 音源の全長（右端トリムの上限）。未取得なら undefined
  /** 声が入っている間だけ音量を下げる（ダッキング）。BGM に付ける */
  duck?: boolean
}

export interface ImgClip {
  id: number
  label?: string
  path: string
  name: string
  tStart: number
  duration: number
  track: string // 載っている映像トラック（V1以外）
  // 動画切片と同じ変形/調整（プレビューのリフレーム枠・プロパティで編集）
  zoom?: { scale: number; x: number; y: number }
  motion?: ClipMotion // 動き（キーフレーム）。zoom を時間の関数にする
  rotate?: number
  flipH?: boolean
  flipV?: boolean
  opacity?: number // 0..1（未指定=1）
  adjust?: { b: number; c: number; s: number }
  crop?: { l: number; t: number; r: number; b: number }
}

export interface VClip {
  id: number
  label?: string
  path: string
  name: string
  track: string
  tStart: number
  srcStart: number
  srcEnd: number
  srcDur?: number
  zoom?: { scale: number; x: number; y: number }
  motion?: ClipMotion // 動き（キーフレーム）。zoom を時間の関数にする
  rotate?: number
  flipH?: boolean
  flipV?: boolean
  opacity?: number
  adjust?: { b: number; c: number; s: number }
  crop?: { l: number; t: number; r: number; b: number }
  muted?: boolean
  vol?: number
  afadeIn?: number
  afadeOut?: number
}

export type SegLayout = Layout<VSeg>

/** タイムライン上の目印（メモ） */
export interface Marker {
  id: number
  t: number // タイムライン秒
  label: string // メモ（空可）
}
