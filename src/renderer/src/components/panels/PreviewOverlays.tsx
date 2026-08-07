// プレビューの映像に重ねて出る物。
//
//   ReframeBox      … 拡大縮小・回転の枠（動画・画像・重ねた動画が相手）
//   ZoomAnchor      … 拡大の中心（◎）。どこへ向かって寄るかを決める
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
  anchorOn,
  onToggleAnchor,
  onDone
}: {
  target: ReframeTargetInfo
  onReframeStart: (e: React.PointerEvent, corner: number) => void
  onRotateStart: (e: React.PointerEvent) => void
  onReset: () => void
  /** リセットが何個に効くか。1個のつもりで押して他まで戻るのを防ぐ */
  resetCount: number
  /** 拡大の中心（マーカー）を出しているか */
  anchorOn: boolean
  onToggleAnchor: () => void
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
        {/* どこへ向かって寄るかを決める。押している間だけマーカーが出る
            （出しっぱなしにすると、絵を見たいときに邪魔になる） */}
        <button
          className={`reframe-btn${anchorOn ? ' on' : ''}`}
          onClick={onToggleAnchor}
          title="拡大の中心を決めます。◎ を動かした先へ向かって寄ります"
        >
          ◎ 拡大の中心
        </button>
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
 * テロップを選んでいるときのバー。
 *
 * **動かす手段はあるのに、戻す手段が無かった。** 動画・画像・重ねた動画には
 * リフレーム枠のバーに「リセット」があるのに、テロップにだけ無く、
 * 行き過ぎたときは手で戻すしかなかった（元の位置は誰も覚えていない）。
 *
 * 枠そのものはテロップ側（`.telop-box-sel` と四隅）が既に持っているので、
 * ここは**バーだけ**を出す。形は動画側と揃える——同じ役目の物が2つの
 * 見た目を持つと、どちらが何だったか毎回思い出すことになる。
 */
export function TelopBar({
  count,
  onReset,
  resetCount,
  onDone
}: {
  /** いま選んでいるテロップの数 */
  count: number
  onReset: () => void
  /** リセットが何個に効くか（鍵のかかった段の物は入らない） */
  resetCount: number
  onDone: () => void
}): JSX.Element {
  return (
    <div className="reframe-bar telop-bar" onPointerDown={(e) => e.stopPropagation()}>
      <span className="reframe-target">📝 テロップ{count > 1 ? `（${count}個）` : ''}</span>
      <button
        className="reframe-btn"
        onClick={onReset}
        title="置き場所と大きさを元へ戻し、打った動きも消します（選択中すべて）。見た目の設定は消えません"
        disabled={resetCount === 0}
      >
        位置と動きを戻す
        {resetCount > 1 ? `（${resetCount}個）` : ''}
      </button>
      <button className="reframe-btn" onClick={onDone} title="選択を外す">
        ✓ 完了
      </button>
    </div>
  )
}

/**
 * 拡大の中心（◎）。掴んで動かすと、そこへ向かって寄るようになる。
 *
 * **これは画面だけの道具。** 動かした結果はいまある位置（x/y）へ書き込まれるので、
 * 書き出し側には何も増えない（理由は `shared/clipMotion` の
 * `zoomOffsetForAnchor` の真上）。だから、この印そのものは保存されない。
 */
export function ZoomAnchor({
  anchor,
  onDragStart
}: {
  /** フレーム比（0..1）。0.5/0.5 が真ん中 */
  anchor: { x: number; y: number }
  onDragStart: (e: React.PointerEvent) => void
}): JSX.Element {
  return (
    <div
      className="zoom-anchor"
      style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}
      title="ここへ向かって寄ります（掴んで移動）"
      onPointerDown={onDragStart}
    >
      ◎
    </div>
  )
}

/**
 * まだ何も無いときの案内。
 *
 * 市松模様（＝透明）だけだと、初見では「壊れている？」に見える。
 * **次に何をすればいいか**を書く。
 *
 * **文言は渡してもらう**（2026-08-07）。同じ形の案内がタイムラインにも要ったので、
 * 見た目だけここに置いて、何を書くかは使う側が決める。
 * 作り直すと、片方の言い回しだけが変わっていく（このリポジトリで4回起きた型）。
 */
export function ScreenEmpty({ title, sub }: { title: string; sub: string }): JSX.Element {
  return (
    <div className="screen-empty">
      <div className="screen-empty-title">{title}</div>
      <div className="screen-empty-sub">{sub}</div>
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
