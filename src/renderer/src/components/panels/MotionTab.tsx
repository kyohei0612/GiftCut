// 左パネルの「モーション」タブ。プレミアの「モーション」と同じ操作感。
//
//   ⏱（ストップウォッチ）を押すと、その項目に**動き**が付く。
//   以後、再生ヘッドを動かして値を変えるたびに、その時刻に印（キー）が置かれる。
//   ⏱ を消すと印を全部捨てて、元の固定値に戻る。
//
//   ◀ ◆ ▶ … 前のキーへ / いまの位置にキーを置く・消す / 次のキーへ
//   ◆ が光っていれば、いまちょうどキーの上にいる
//
// 例: 0秒で右端、10秒で左端 → 右から左へ流れるテロップ
//
// 値は**そのクリップの先頭からの時刻**で持つ。タイムライン上の絶対時刻で持つと、
// クリップを動かした瞬間に動きが置いていかれる。
//
// 取り込んだ演出（05.飛び出し など）を**選ぶ**所はここではなく、
// 右パネルのトランジションタブ。名前が演出名なので、他の見本帳と並んでいる方が
// 探せる。ここは選んだあと数値を詰める所。

import { useState, type JSX } from 'react'
import {
  keyAt,
  prevKeyTime,
  nextKeyTime,
  hasKeys,
  type Keys
} from '../../../../shared/keyframes'

export interface MotionRow {
  key: string
  label: string
  /** いまの時刻での値（表示用。位置と拡大は「元の値＋動き」を出す） */
  value: number
  unit?: string
  step: number
  min: number
  max: number
  keys?: Keys
  /** ⏱ が消えている状態でも値を変えられるか（位置と拡大は元の値を変えられる） */
  editableWithoutKeys: boolean
  onValue: (v: number) => void
  onToggleKeys: () => void
  onPutKey: () => void
  onRemoveKey: () => void
}

export function MotionTab({
  title,
  hint,
  rows,
  moreRows,
  clipTime,
  onSeekClipTime,
  onSaveMotion,
  onClearMotion
}: {
  /** 何に対する設定か（選んでいるテロップの文字など） */
  title: string
  hint?: string
  rows: MotionRow[]
  /**
   * 普段は畳んでおく行（3D回転・明るさ・切り抜きなど）。
   * 全部いっぺんに出すと、よく使う位置・拡大が下へ流れて探せなくなる。
   */
  moreRows?: MotionRow[]
  /** クリップの先頭からの、いまの時刻（秒） */
  clipTime: number
  onSeekClipTime: (t: number) => void
  /** いま付いている動きに名前を付けて残す（右の「動き → 自分の動き」に並ぶ） */
  onSaveMotion?: () => void
  /** いま付いている動きを全部捨てる（見本帳の演出を試したあと元に戻す道） */
  onClearMotion?: () => void
}): JSX.Element {
  const [openMore, setOpenMore] = useState(false)
  const renderRow = (r: MotionRow): JSX.Element => {
        const on = hasKeys(r.keys)
        const here = !!keyAt(r.keys, clipTime)
        const prev = prevKeyTime(r.keys, clipTime)
        const next = nextKeyTime(r.keys, clipTime)
        return (
          <div className={`mo-row ${on ? 'mo-on' : ''}`} key={r.key}>
            <button
              className={`mo-watch ${on ? 'on' : ''}`}
              title={on ? '動きをやめる（打った印を全部捨てる）' : 'ここから動きを付ける'}
              onClick={r.onToggleKeys}
            >
              ⏱
            </button>
            <span className="mo-label">{r.label}</span>
            <input
              className="mo-val"
              type="number"
              step={r.step}
              min={r.min}
              max={r.max}
              value={Number(r.value.toFixed(3))}
              disabled={!on && !r.editableWithoutKeys}
              onChange={(e) => r.onValue(Number(e.target.value))}
            />
            {r.unit && <span className="mo-unit">{r.unit}</span>}
            <span className="mo-keys">
              <button
                className="mo-kbtn"
                title="前の印へ"
                disabled={prev == null}
                onClick={() => prev != null && onSeekClipTime(prev)}
              >
                ◀
              </button>
              <button
                className={`mo-kbtn mo-diamond ${here ? 'on' : ''}`}
                title={here ? 'この位置の印を消す' : 'この位置に印を置く'}
                disabled={!on}
                onClick={here ? r.onRemoveKey : r.onPutKey}
              >
                ◆
              </button>
              <button
                className="mo-kbtn"
                title="次の印へ"
                disabled={next == null}
                onClick={() => next != null && onSeekClipTime(next)}
              >
                ▶
              </button>
            </span>
          </div>
        )
  }
  return (
    <div className="panel-body">
      <div className="mo-head">
        <span className="mo-title">{title}</span>
        {/* **作った所で保存できるようにする。** 作る場所（ここ）と残す場所が
            離れていると、残せること自体に気づけない。
            残した物は右の「動き → 自分の動き」に並ぶ。 */}
        {onSaveMotion && (
          <button
            className="mo-mini"
            title="いま付いている動きに名前を付けて残す（右の「動き」に並びます）"
            onClick={onSaveMotion}
          >
            動きを保存
          </button>
        )}
        {onClearMotion && (
          <button className="mo-mini" title="この人に付いている動きを全部捨てる" onClick={onClearMotion}>
            動きを消す
          </button>
        )}
        <span className="mo-time">{clipTime.toFixed(2)}s</span>
      </div>
      {hint && <div className="tpl-hint">{hint}</div>}

      {rows.map(renderRow)}

      {/* よく使わない物は畳んでおく。付いている行があれば、畳んでいても数で分かるようにする */}
      {moreRows && moreRows.length > 0 && (
        <>
          <div className="mo-sec" onClick={() => setOpenMore((v) => !v)}>
            <span className="mo-sec-arrow">{openMore ? '▾' : '▸'}</span>
            <span>詳しい動き</span>
            {(() => {
              const on = moreRows.filter((r) => hasKeys(r.keys)).length
              return on > 0 ? <span className="mo-sec-count mo-sec-on">{on}</span> : null
            })()}
          </div>
          {openMore && moreRows.map(renderRow)}
        </>
      )}
    </div>
  )
}
