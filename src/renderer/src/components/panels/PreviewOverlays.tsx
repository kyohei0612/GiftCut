// プレビューの映像に重ねて出る物。
//
//   ReframeBox      … 拡大縮小・回転の枠（動画・画像・重ねた動画が相手）
//   ScreenEmpty     … まだ何も無いときの案内
//   ProgressBadges  … 裏で進んでいる仕事の進み具合
//   TelopEditor     … テロップをその場で打ち替える欄
//
// どれも「映像の上に浮く」という一点だけが共通で、中身は互いに無関係。
// 1つの大きな塊にせず、別々の部品にしてある（片方を触るときに
// もう片方を読まなくて済む）。

import type { JSX } from 'react'
import type { Cue } from '../../lib/srt'

/** 拡大縮小・回転の枠が相手にしている物 */
export interface ReframeTargetInfo {
  kind: 'img' | 'vclip' | string
  name: string
  track?: string
  zoom: { scale: number }
}

/**
 * リフレーム枠。四隅を掴めば拡大縮小、外側の ↻ で回転、本体を掴めば移動。
 *
 * **何を操作中かを名前で出す。** 動画・画像・重ねた動画のどれが相手かを
 * 出しておかないと、別の物を拡大してしまう。
 */
export function ReframeBox({
  target,
  onReframeStart,
  onRotateStart,
  onReset,
  resetCount,
  onDone
}: {
  target: ReframeTargetInfo
  onReframeStart: (e: React.PointerEvent, corner: number) => void
  onRotateStart: (e: React.PointerEvent) => void
  onReset: () => void
  /** リセットが何個に効くか。1個のつもりで押して他まで戻るのを防ぐ */
  resetCount: number
  onDone: () => void
}): JSX.Element {
  return (
    <div className="reframe-box">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={`reframe-handle rh-${i}`}
          onPointerDown={(e) => onReframeStart(e, i)}
        />
      ))}
      {/* 回転ハンドル: 四隅の少し外側。掴んで回すと現在クリップを回転（Shiftで15°スナップ） */}
      {[0, 1, 2, 3].map((i) => (
        <div
          key={`rot-${i}`}
          className={`reframe-rot rr-${i}`}
          title="ドラッグで回転（Shiftで15°）"
          onPointerDown={onRotateStart}
        >
          ↻
        </div>
      ))}
      <div className="reframe-bar" onPointerDown={(e) => e.stopPropagation()}>
        {/* 何を操作中かを明示（動画 or 画像）＝誤って別の要素を拡大しないように */}
        <span className="reframe-target" title={target.name}>
          {target.kind === 'img' ? '🖼' : '🎬'} {target.name}
          {target.kind === 'vclip' ? `（${target.track}）` : ''}
        </span>
        <span className="reframe-scale">{Math.round(target.zoom.scale * 100)}%</span>
        {/* 何個に効くかを出す。選択中の全部に効くので、
            1個のつもりで押して他まで戻る、が起きないように */}
        <button
          className="reframe-btn"
          onClick={onReset}
          title="等倍に戻し、打った動きも消します（選択中すべて）"
        >
          リセット
          {resetCount > 1 ? `（${resetCount}個）` : ''}
        </button>
        <button className="reframe-btn" onClick={onDone} title="リフレームを終了">
          ✓ 完了
        </button>
      </div>
    </div>
  )
}

/**
 * まだ何も無いときの案内。
 *
 * 市松模様（＝透明）だけだと、初見では「壊れている？」に見える。
 * **次に何をすればいいか**を書く。
 */
export function ScreenEmpty(): JSX.Element {
  return (
    <div className="screen-empty">
      <div className="screen-empty-title">動画をここにドラッグ</div>
      <div className="screen-empty-sub">右の「＋ ファイル追加」からでも読み込めます</div>
    </div>
  )
}

/** 裏で進んでいる仕事の進み具合（プレビューの焼き直し・素材のまとめ） */
export function ProgressBadges({
  proxyPct,
  packPct
}: {
  proxyPct: number | null
  packPct: number | null
}): JSX.Element {
  return (
    <>
      {proxyPct != null && (
        <div className="proxy-badge" title="編集用プレビューを最適化中（書き出しは原本フル画質）">
          ⚙ プレビュー最適化中… {proxyPct}%
        </div>
      )}
      {packPct != null && (
        <div
          className="proxy-badge"
          title="素材ごとまとめています（大きい素材があると時間がかかります）"
        >
          📦 素材ごとまとめ中… {packPct}%
        </div>
      )}
    </>
  )
}

/**
 * テロップをその場で打ち替える欄。
 *
 * **Enter で確定、Shift+Enter で改行。** 文字打ちは「打ち終わったら Enter」が
 * 体に入っているので、ここで改行が入ると確定のつもりが1行増える。
 * 改行のほうを修飾キー側へ寄せる。変換確定の Enter は拾わない。
 */
export function TelopEditor({
  cue,
  textRef,
  onChangeText,
  onSelChange,
  onClearRuns,
  onClose
}: {
  cue: Cue
  textRef: React.RefObject<HTMLTextAreaElement>
  onChangeText: (id: number, text: string) => void
  /** どこを選んでいるか。左パネルの「その文字だけ変える」が見る */
  onSelChange: (sel: { start: number; end: number }) => void
  onClearRuns: (id: number) => void
  onClose: () => void
}): JSX.Element {
  const trackSel = (el: HTMLTextAreaElement): void =>
    onSelChange({ start: el.selectionStart, end: el.selectionEnd })
  return (
    <div className="telop-editor" onPointerDown={(e) => e.stopPropagation()}>
      <textarea
        className="telop-editor-text"
        ref={textRef}
        autoFocus
        value={cue.text}
        rows={Math.max(1, cue.text.split('\n').length)}
        onChange={(e) => {
          onChangeText(cue.id, e.target.value)
          trackSel(e.currentTarget)
        }}
        onSelect={(e) => trackSel(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onClose()
            return
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <div className="telop-editor-tools">
        <span className="te-label">
          文字を選択 → 左パネルの色/フォント/サイズで“その文字だけ”変更
        </span>
        <button
          className="te-btn"
          title="選択文字の部分装飾をクリア"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onClearRuns(cue.id)}
        >
          選択の装飾クリア
        </button>
        <button className="te-btn te-done" onClick={onClose}>
          完了
        </button>
      </div>
    </div>
  )
}
