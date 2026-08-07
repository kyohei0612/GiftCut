// 字幕づくりの窓。
//
// **押してすぐ走らせない。** 聞き取りは動画の長さによっては何分もかかり、
// 途中で止めにくい。何が起きるのか・どれくらいかかるのかを先に出してから始める。
//
// 初回だけ聞き取りの模型（モデル）を落とす必要がある。これも黙って始めず、
// 大きさを見せてから聞く（回線によっては数分かかるため）。

import type { JSX } from 'react'
import { useEscClose } from '../../lib/useEscClose'

export interface SubtitleModel {
  /** 手元にあるか */
  ready: boolean
  /** 表示用の名前 */
  label: string
  /** 落とすときの大きさ（MB）。手元にあれば使わない */
  sizeMB: number
}

export type SubtitlePhase =
  | { phase: 'idle' }
  | { phase: 'download'; percent: number }
  | { phase: 'extract' }
  | { phase: 'listen'; percent: number }
  | { phase: 'align' }
  | { phase: 'error'; message: string }

export function SubtitleDialog({
  model,
  state,
  maxChars,
  onMaxChars,
  replace,
  onReplace,
  hasTelops,
  onRun,
  onCancel,
  onClose
}: {
  model: SubtitleModel
  state: SubtitlePhase
  /** 1枚に載せる文字数 */
  maxChars: number
  onMaxChars: (n: number) => void
  /** いまのテロップを置き換えるか（false なら足す） */
  replace: boolean
  onReplace: (v: boolean) => void
  hasTelops: boolean
  onRun: () => void
  onCancel: () => void
  onClose: () => void
}): JSX.Element {
  const busy = state.phase !== 'idle' && state.phase !== 'error'
  const label = (): string => {
    switch (state.phase) {
      case 'download':
        return `聞き取りの準備を落としています… ${state.percent}%`
      case 'extract':
        return '音を取り出しています…'
      case 'listen':
        return `聞き取っています… ${state.percent}%`
      case 'align':
        return '喋っている所へ合わせています…'
      default:
        return ''
    }
  }
  // Escape でも閉じる。**走っている間は受け付けない**——聞き取り中に消えても
  // 処理は止まらず、見えなくなるだけで戻れない（理由は lib/useEscClose）
  useEscClose(onClose, !busy)
  return (
    <div className="export-overlay">
      <div className="restore-box">
        <div className="restore-title">字幕を作る</div>
        <div className="restore-msg">
          喋っている内容を聞き取って、テロップとしてタイムラインに並べます。
          <br />
          出だしは<b>無音の切れ目とカット点</b>に合わせるので、声とずれません。
          <br />
          {/* **外に出ないことは、先に言う。** 音声を扱う道具で一番気にされる所 */}
          <span className="tpl-hint">
            聞き取りはこのPCの中だけで行います（音声はどこにも送りません）。
          </span>
        </div>

        {!model.ready && (
          <div className="restore-warn">
            初回だけ、聞き取りの準備（{model.label} / 約{model.sizeMB}MB）を落とします。
            <br />
            一度入れれば次からは要りません（更新しても消えません）。
          </div>
        )}

        <div className="sp-row">
          <span className="sp-label">1枚の文字数</span>
          <input
            type="range"
            min={10}
            max={30}
            step={1}
            value={maxChars}
            disabled={busy}
            onChange={(e) => onMaxChars(Number(e.target.value))}
          />
          <span className="sp-val">{maxChars}文字</span>
        </div>
        <div className="tpl-hint">
          長い文は助詞（〜が / 〜けど…）の後ろで割ります。単語の途中では切りません。
        </div>

        {hasTelops && (
          <label className="mo-showall" style={{ marginTop: 6 }}>
            <input
              type="checkbox"
              checked={replace}
              disabled={busy}
              onChange={(e) => onReplace(e.target.checked)}
            />
            いまのテロップを置き換える（外すと足します）
          </label>
        )}

        {busy && (
          <div className="tpl-hint" style={{ marginTop: 10 }}>
            {label()}
          </div>
        )}
        {state.phase === 'error' && (
          <div className="restore-warn" style={{ marginTop: 10 }}>
            {state.message}
          </div>
        )}

        <div className="restore-btns">
          {busy ? (
            <button className="btn" onClick={onCancel}>
              やめる
            </button>
          ) : (
            <button className="btn" onClick={onClose}>
              閉じる
            </button>
          )}
          <button className="btn btn-primary" onClick={onRun} disabled={busy}>
            {model.ready ? '字幕を作る' : '準備して作る'}
          </button>
        </div>
      </div>
    </div>
  )
}
