// 左のプロパティ欄。**選んでいる物の設定**を出す。
//
// 出す中身は選択の種類で決まる（テロップ / 効果音 / 動画クリップ / 音声 /
// 映像レイヤー / 画像）。優先順は App 側が決めて、該当する物だけ渡す。
//
// くり返し出てくる行（色調整・クロップ・変形・割合・秒）は PropertyRows に
// まとめてある。ここは「どの種類に何を出すか」だけを持つ。

import type { JSX, ReactNode } from 'react'
import { ProjectSummary } from './ProjectSummary'
import {
  AdjustRows,
  CropRows,
  PercentRow,
  SecondsRow,
  SliderRow,
  TransformRow,
  nextRotate,
  type Adjust,
  type Crop
} from './PropertyRows'

/** 変形・調整をまとめて持つクリップ（映像レイヤーと画像で共通） */
export interface VisualClip {
  name: string
  zoom: { scale: number; x: number; y: number }
  opacity: number
  rotate?: number
  flipH?: boolean
  flipV?: boolean
  adjust: Adjust
  crop: Crop
}

export interface PropertiesPanelProps {
  /** まとめて編集している数（2以上のとき知らせを出す） */
  multiCount: number
  /** テロップ。中身の見た目パネルは App が組んで渡す（状態が多いため） */
  telop?: {
    text: string
    onText: (v: string) => void
    stylePanel: ReactNode
  } | null
  /** 効果音・BGM */
  se?: {
    name: string
    isSe: boolean
    volume: number
    fadeIn: number
    fadeOut: number
    duration: number
    others: number
    onChange: (patch: { volume?: number; fadeIn?: number; fadeOut?: number }) => void
  } | null
  /** 本編の動画クリップ */
  videoSeg?: {
    count: number
    speed: number
    speeds: number[]
    adjust: Adjust
    crop: Crop
    rotate?: number
    flipH?: boolean
    flipV?: boolean
    onSpeed: (v: number) => void
    onAdjust: (next: Adjust | null) => void
    onCrop: (next: Crop | null) => void
    onRotate: () => void
    onFlip: (axis: 'h' | 'v') => void
  } | null
  /** 本編の音声クリップ */
  audioSeg?: {
    count: number
    vol: number
    fadeIn: number
    fadeOut: number
    length: number
    muted: boolean
    onChange: (patch: { vol?: number; afadeIn?: number; afadeOut?: number }) => void
    onToggleMute: () => void
  } | null
  /** 映像レイヤー（V2以降に置いた動画） */
  vclip?: {
    clip: VisualClip
    track: string
    pairedAudio: string
    lengthLabel: string
    length: number
    others: number
    vol: number
    fadeIn: number
    fadeOut: number
    muted: boolean
    onZoomScale: (scale: number) => void
    onChange: (patch: Record<string, unknown>) => void
    onReset: () => void
  } | null
  /** 画像クリップ */
  image?: {
    clip: VisualClip
    duration: number
    others: number
    onZoomScale: (scale: number) => void
    onChange: (patch: Record<string, unknown>) => void
    onReset: () => void
  } | null
}

const RESET_TRANSFORM = {
  zoom: undefined,
  rotate: undefined,
  flipH: undefined,
  flipV: undefined,
  opacity: undefined,
  adjust: undefined,
  crop: undefined
}
export { RESET_TRANSFORM }

export function PropertiesPanel(props: PropertiesPanelProps): JSX.Element {
  const { telop, se, videoSeg, audioSeg, vclip, image } = props
  return (
    <div className="panel-body">
      {telop ? (
        <>
          {props.multiCount > 1 && (
            <div className="multi-banner">
              {props.multiCount}個をまとめて編集中（スタイル・アイコンは全てに適用）
            </div>
          )}
          <label className="field-label">テロップ テキスト</label>
          <textarea
            className="text-input"
            value={telop.text}
            onChange={(e) => telop.onText(e.target.value)}
            rows={Math.max(1, telop.text.split('\n').length)}
          />
          {telop.stylePanel}
        </>
      ) : se ? (
        <>
          <label className="field-label">{se.isSe ? 'SE（効果音）' : 'オーディオクリップ'}</label>
          <div className="time-val" style={{ marginBottom: 8 }}>
            🔊 {se.name}
            {se.others > 0 && `（他${se.others}個も一緒に）`}
          </div>
          <PercentRow
            label="音量"
            value={se.volume}
            step={0.02}
            onChange={(v) => se.onChange({ volume: v })}
          />
          <SecondsRow
            label="フェードイン"
            value={se.fadeIn}
            max={Math.max(0.5, se.duration)}
            onChange={(v) => se.onChange({ fadeIn: v })}
          />
          <SecondsRow
            label="フェードアウト"
            value={se.fadeOut}
            max={Math.max(0.5, se.duration)}
            onChange={(v) => se.onChange({ fadeOut: v })}
          />
        </>
      ) : videoSeg ? (
        <>
          <label className="field-label">
            動画クリップ{videoSeg.count > 1 && `（${videoSeg.count}個）`}
          </label>
          <div className="sp-row">
            <span className="sp-label">再生速度</span>
          </div>
          <div className="seg seg-wide">
            {videoSeg.speeds.map((sp) => (
              <button
                key={sp}
                className={`seg-btn ${Math.abs(videoSeg.speed - sp) < 1e-3 ? 'seg-on' : ''}`}
                onClick={() => videoSeg.onSpeed(sp)}
              >
                {sp}x
              </button>
            ))}
          </div>
          <div className="tpl-hint" style={{ marginTop: 8 }}>
            速くするとクリップが短くなり、後ろのテロップ・SE・画像・マーカー・映像レイヤーも一緒にずれます。
          </div>
          <AdjustRows value={videoSeg.adjust} onChange={videoSeg.onAdjust} />
          <button
            className="btn small"
            onClick={() => videoSeg.onAdjust(null)}
            style={{ marginTop: 4 }}
          >
            色調整をリセット
          </button>
          <TransformRow
            rotate={videoSeg.rotate}
            flipH={videoSeg.flipH}
            flipV={videoSeg.flipV}
            onRotate={videoSeg.onRotate}
            onFlipH={() => videoSeg.onFlip('h')}
            onFlipV={() => videoSeg.onFlip('v')}
          />
          <CropRows value={videoSeg.crop} onChange={videoSeg.onCrop} />
          <button className="btn small" onClick={() => videoSeg.onCrop(null)} style={{ marginTop: 4 }}>
            クロップをリセット
          </button>
        </>
      ) : audioSeg ? (
        <>
          <label className="field-label">
            音声クリップ{audioSeg.count > 1 && `（${audioSeg.count}個）`}
          </label>
          <SliderRow
            label="音量"
            min={0}
            max={2}
            step={0.02}
            value={audioSeg.vol}
            onChange={(v) => audioSeg.onChange({ vol: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SecondsRow
            label="フェードイン"
            value={audioSeg.fadeIn}
            max={Math.max(0.5, audioSeg.length)}
            onChange={(v) => audioSeg.onChange({ afadeIn: v })}
          />
          <SecondsRow
            label="フェードアウト"
            value={audioSeg.fadeOut}
            max={Math.max(0.5, audioSeg.length)}
            onChange={(v) => audioSeg.onChange({ afadeOut: v })}
          />
          <div className="seg seg-wide" style={{ marginTop: 8 }}>
            <button
              className={`seg-btn ${audioSeg.muted ? 'seg-on' : ''}`}
              onClick={audioSeg.onToggleMute}
              title="このクリップの音だけを消す（映像と長さは残す）"
            >
              🔇 消音
            </button>
          </div>
          <div className="tpl-hint" style={{ marginTop: 8 }}>
            D / Delete はクリップを削除して後ろを詰めます。音だけ消したいときは上の「消音」。
          </div>
        </>
      ) : vclip ? (
        <>
          <label className="field-label">映像レイヤー（{vclip.track}）</label>
          <div className="time-val" style={{ marginBottom: 8 }}>
            🎬 {vclip.clip.name}
            {vclip.others > 0 && `（他${vclip.others}個も一緒に）`}
          </div>
          <div className="tpl-hint" style={{ marginBottom: 8 }}>
            音声は {vclip.pairedAudio} に連動（長さ {vclip.lengthLabel}）
          </div>
          <PercentRow
            label="拡大"
            value={vclip.clip.zoom.scale}
            min={20}
            max={800}
            onChange={(v) => vclip.onZoomScale(v)}
          />
          <PercentRow
            label="不透明度"
            value={vclip.clip.opacity}
            max={100}
            onChange={(v) => vclip.onChange({ opacity: v })}
          />
          <SliderRow
            label="音量"
            min={0}
            max={2}
            step={0.02}
            value={vclip.vol}
            onChange={(v) => vclip.onChange({ vol: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SecondsRow
            label="フェードイン"
            value={vclip.fadeIn}
            max={Math.max(0.5, vclip.length)}
            onChange={(v) => vclip.onChange({ afadeIn: v })}
          />
          <SecondsRow
            label="フェードアウト"
            value={vclip.fadeOut}
            max={Math.max(0.5, vclip.length)}
            onChange={(v) => vclip.onChange({ afadeOut: v })}
          />
          <TransformRow
            rotate={vclip.clip.rotate}
            flipH={vclip.clip.flipH}
            flipV={vclip.clip.flipV}
            onRotate={() => vclip.onChange({ rotate: nextRotate(vclip.clip.rotate) })}
            onFlipH={() => vclip.onChange({ flipH: !vclip.clip.flipH })}
            onFlipV={() => vclip.onChange({ flipV: !vclip.clip.flipV })}
          />
          {/* 消音は音声の設定なので変形から出す（動画切片も音声側に置いている） */}
          <div className="seg seg-wide" style={{ marginTop: 6 }}>
            <button
              className={`seg-btn ${vclip.muted ? 'seg-on' : ''}`}
              onClick={() => vclip.onChange({ muted: !vclip.muted })}
              title="この映像の音だけを消す"
            >
              🔇 消音
            </button>
          </div>
          <AdjustRows
            value={vclip.clip.adjust}
            onChange={(next) => vclip.onChange({ adjust: next })}
          />
          <CropRows value={vclip.clip.crop} onChange={(next) => vclip.onChange({ crop: next })} />
          <button className="btn small" style={{ marginTop: 6 }} onClick={vclip.onReset}>
            変形・調整をリセット
          </button>
          <div className="tpl-hint" style={{ marginTop: 8 }}>
            プレビューの枠をドラッグで拡大/移動、四隅の↻で回転。Delete で削除。
          </div>
        </>
      ) : image ? (
        <>
          <label className="field-label">画像クリップ</label>
          <div className="time-val" style={{ marginBottom: 8 }}>
            🖼 {image.clip.name}
            {image.others > 0 && `（他${image.others}個も一緒に）`}
          </div>
          <SliderRow
            label="長さ"
            min={0.2}
            max={30}
            step={0.1}
            value={image.duration}
            onChange={(v) => image.onChange({ duration: v })}
            format={(v) => `${v.toFixed(2)}s`}
          />
          <PercentRow
            label="拡大"
            value={image.clip.zoom.scale}
            min={20}
            max={800}
            onChange={(v) => image.onZoomScale(v)}
          />
          <PercentRow
            label="不透明度"
            value={image.clip.opacity}
            max={100}
            onChange={(v) => image.onChange({ opacity: v })}
          />
          <TransformRow
            rotate={image.clip.rotate}
            flipH={image.clip.flipH}
            flipV={image.clip.flipV}
            onRotate={() => image.onChange({ rotate: nextRotate(image.clip.rotate) })}
            onFlipH={() => image.onChange({ flipH: !image.clip.flipH })}
            onFlipV={() => image.onChange({ flipV: !image.clip.flipV })}
          />
          <AdjustRows
            value={image.clip.adjust}
            onChange={(next) => image.onChange({ adjust: next })}
          />
          <CropRows value={image.clip.crop} onChange={(next) => image.onChange({ crop: next })} />
          <button className="btn small" style={{ marginTop: 6 }} onClick={image.onReset}>
            変形・調整をリセット
          </button>
          <div className="tpl-hint" style={{ marginTop: 8 }}>
            プレビューの枠をドラッグで拡大/移動、四隅の↻で回転。Delete で削除。
          </div>
        </>
      ) : (
        // **何も選んでいない時も、この場所は仕事をする**（2026-08-05）。
        // 前は一行だけで 250 × 450 が常時死んでいた。中身は ProjectSummary
        // （「他所に出ていない事」だけを出す、という決め方もあちらに書いてある）
        <ProjectSummary />
      )}
    </div>
  )
}
