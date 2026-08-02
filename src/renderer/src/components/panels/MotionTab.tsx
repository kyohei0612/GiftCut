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

import { useEffect, useRef, useState, type JSX } from 'react'
import {
  keyAt,
  prevKeyTime,
  nextKeyTime,
  hasKeys,
  type Keys
} from '../../../../shared/keyframes'
import { ScrubNumber } from '../ScrubNumber'

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
  /** この項目だけ元に戻す（打った印を捨て、元の値があればそれも既定へ） */
  onReset: () => void
}

export function MotionTab({
  title,
  hint,
  rows,
  moreRows,
  clipTime,
  onSeekClipTime,
  onSaveMotion,
  onClearMotion,
  clearCount,
  onSelectRows,
  onRows,
  clipLen,
  targetKey
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
  /** 「動きを消す」が何個に効くか。2個以上ならボタンに出す（押す前に分かるように） */
  clearCount?: number
  /**
   * 選んだ項目が変わったときに知らせる（コピー／貼り付けの相手になる）。
   * 実際にコピーするのは呼ぶ側。ここは「どれを選んでいるか」だけを持つ。
   */
  onSelectRows?: (keys: string[]) => void
  /**
   * いま出ている行そのものを外へ渡す。
   *
   * **コピーが「印の付いていない項目」も写せるようにするため。** 印が無い行の値は
   * テロップなら pos/scale、クリップなら zoom… と持ち主がばらばらで、
   * 写す側からは辿れない。行は既にその読み書きを持っているので、行ごと渡す。
   */
  onRows?: (rows: MotionRow[]) => void
  /** そのクリップの長さ（秒）。頭・尻へ飛ぶボタンに使う */
  clipLen?: number
  /**
   * いま相手にしている物の識別（`telop:12` など）。
   * **相手が変わったら項目の選択は捨てる。** 選びっぱなしだと、別のクリップを
   * 触っているのに前の選択が生きていて、コピーが思わぬ相手から取られる。
   */
  targetKey?: string
}): JSX.Element {
  // **畳むのではなく、選ぶ。**
  // プレミアと同じで、見出しを押すとその組がまとめて選ばれる。選んだ状態で
  // コピーすれば、その組だけを別のクリップへ配れる。
  // 畳みたいときは左の ▾ を押す（畳んだままだと、そこに何があるか忘れる）。
  const [openMore, setOpenMore] = useState(true)
  const [openBasic, setOpenBasic] = useState(true)
  const [sel, setSel] = useState<string[]>([])
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    setSel([])
    onSelectRows?.([])
    // 相手が変わった時だけ捨てる（選ぶたびに捨てると選べない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey])
  /**
   * **この枠の外を触ったら、項目の選択は解く。**
   *
   * 解けないままだと、同じクリップを選び直しても選択が生きていて、
   * そこからの Ctrl+C が**ずっとモーション側に取られ続ける**
   * （クリップを写したつもりで貼っても、何も増えない）。
   * 「別の所を触った＝もうその項目の話ではない」という、見たままの規則にする。
   */
  useEffect(() => {
    const h = (e: PointerEvent): void => {
      const root = rootRef.current
      if (!root || root.contains(e.target as Node)) return
      setSel((prev) => {
        if (!prev.length) return prev
        onSelectRows?.([])
        return []
      })
    }
    window.addEventListener('pointerdown', h, true)
    return () => window.removeEventListener('pointerdown', h, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const allRows = [...rows, ...(moreRows ?? [])]
  // 行は描くたびに作り直されるが、渡すのは控えを差し替えるだけなので軽い。
  // **中括弧で包むこと。** `() => onRows?.(...)` と書くと渡した関数の戻り値
  // （行の配列）がそのまま effect の戻り値になり、React が「後片付けの関数では
  // ない物を返した」と見なしてタブごと落ちる（実際にモーションタブが空になった）。
  useEffect(() => {
    onRows?.(allRows)
  })
  const order = allRows.map((r) => r.key)
  const lastRef = useRef<string | null>(null)
  /** 選び直す。Ctrl=足し引き / Shift=そこまでまとめて */
  const pick = (keys: string[], e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): void => {
    setSel((prev) => {
      let next: string[]
      if (e.ctrlKey || e.metaKey) {
        const all = keys.every((k) => prev.includes(k))
        next = all ? prev.filter((k) => !keys.includes(k)) : [...new Set([...prev, ...keys])]
      } else if (e.shiftKey && lastRef.current) {
        const a = order.indexOf(lastRef.current)
        const b = order.indexOf(keys[keys.length - 1])
        if (a >= 0 && b >= 0) {
          const [s, t] = a < b ? [a, b] : [b, a]
          next = [...new Set([...prev, ...order.slice(s, t + 1)])]
        } else next = keys
      } else {
        // 同じ物をもう一度押したら外す（選んだまま抜けられないと操作が詰まる）
        next = keys.every((k) => prev.includes(k)) && prev.length === keys.length ? [] : keys
      }
      onSelectRows?.(next)
      return next
    })
    lastRef.current = keys[keys.length - 1] ?? null
  }
  const renderRow = (r: MotionRow): JSX.Element => {
        const on = hasKeys(r.keys)
        const here = !!keyAt(r.keys, clipTime)
        const prev = prevKeyTime(r.keys, clipTime)
        const next = nextKeyTime(r.keys, clipTime)
        const picked = sel.includes(r.key)
        return (
          <div className={`mo-row ${on ? 'mo-on' : ''} ${picked ? 'mo-picked' : ''}`} key={r.key}>
            <button
              className={`mo-watch ${on ? 'on' : ''}`}
              title={on ? '動きをやめる（打った印を全部捨てる）' : 'ここから動きを付ける'}
              onClick={r.onToggleKeys}
            >
              ⏱
            </button>
            {/* **名前を押すと、その項目が選ばれる。**
                選んだ状態でコピーすると、その項目だけを他のクリップへ配れる。
                Ctrl で足し引き、Shift でそこまでまとめて。 */}
            <span
              className="mo-label mo-pickable"
              title="押すとこの項目を選びます（Ctrlで足し引き / Shiftでまとめて）。選んでコピー→別のクリップで貼り付け"
              onClick={(e) => pick([r.key], e)}
            >
              {r.label}
            </span>
            {/* **押し込んで左右に振ると増減する。** 数を打ち込むより、
                見ながら少しずつ寄せる場面のほうがずっと多い。
                字間・行間と同じ操作に揃えてある（部品は components/ScrubNumber） */}
            <ScrubNumber
              className="mo-val"
              step={r.step}
              min={r.min}
              max={r.max}
              value={Number(r.value.toFixed(3))}
              disabled={!on && !r.editableWithoutKeys}
              title="押したまま左右に振ると増減します（クリックで打ち込み）"
              onChange={r.onValue}
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
            {/* **1項目だけ元に戻す。**
                「動きを消す」は全部が消えるので、1つだけ打ち直したい時に使えない。 */}
            <button
              className="mo-kbtn mo-reset"
              title="この項目だけ元に戻す（打った印も消えます）"
              onClick={r.onReset}
            >
              ↺
            </button>
          </div>
        )
  }
  /** 組の見出し（押すとその組をまとめて選ぶ） */
  const secHead = (
    label: string,
    group: MotionRow[],
    open: boolean,
    setOpen: (f: (v: boolean) => boolean) => void
  ): JSX.Element => {
    const keys = group.map((r) => r.key)
    const allPicked = keys.length > 0 && keys.every((k) => sel.includes(k))
    const on = group.filter((r) => hasKeys(r.keys)).length
    return (
      <div
        className={`mo-sec mo-pickable ${allPicked ? 'mo-picked' : ''}`}
        title="押すとこの組をまとめて選びます（選んでコピー→別のクリップで貼り付け）"
        onClick={(e) => pick(keys, e)}
      >
        {/* 畳むのは矢印だけ。見出し全体で畳むと、選ぶ操作とぶつかる */}
        <span
          className="mo-sec-arrow"
          title={open ? '畳む' : '開く'}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
        >
          {open ? '▾' : '▸'}
        </span>
        <span>{label}</span>
        {on > 0 && <span className="mo-sec-count mo-sec-on">{on}</span>}
      </div>
    )
  }
  return (
    <div className="panel-body" ref={rootRef}>
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
          <button
            className="mo-mini"
            title="選んでいる分すべてから、付いている動きを捨てる"
            onClick={onClearMotion}
          >
            動きを消す
            {(clearCount ?? 0) > 1 ? `（${clearCount}個）` : ''}
          </button>
        )}
        {/* **頭・尻へ一発で飛ぶ。**
            印を打つのはたいていクリップの端（そこから動き出す・そこで止まる）。
            端をタイムラインで探して合わせるのは、細いクリップほど当たらない。 */}
        <button
          className="mo-mini"
          title="このクリップの先頭へ（印を打つ起点）"
          onClick={() => onSeekClipTime(0)}
        >
          ⏮ 先頭
        </button>
        {clipLen != null && clipLen > 0 && (
          <button
            className="mo-mini"
            title="このクリップの末尾へ"
            onClick={() => onSeekClipTime(Math.max(0, clipLen - 0.001))}
          >
            末尾 ⏭
          </button>
        )}
        <span className="mo-time">{clipTime.toFixed(2)}s</span>
      </div>
      {hint && <div className="tpl-hint">{hint}</div>}
      {sel.length > 0 && (
        <div className="tpl-hint mo-pick-hint">
          {sel.length}項目を選択中 — コピーして、別のクリップを選んで貼り付けると移せます
        </div>
      )}

      {secHead('簡単な設定', rows, openBasic, setOpenBasic)}
      {openBasic && rows.map(renderRow)}

      {moreRows && moreRows.length > 0 && (
        <>
          {secHead('詳細設定', moreRows, openMore, setOpenMore)}
          {openMore && moreRows.map(renderRow)}
        </>
      )}
    </div>
  )
}
