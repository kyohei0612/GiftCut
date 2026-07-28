// 右クリックメニューの見た目。**中身は「並べる物の一覧」で渡す。**
//
// 以前は6つのメニューがそれぞれ div とボタンを直に書いていて、
// 同じ見た目を6回ずつ書き直していた。増えるほど、どれかだけ作法が違う状態になる。
// ここに1つだけ置き、呼ぶ側は「何を並べたいか」だけを書く。
//
//   <ContextMenu x={m.x} y={m.y} innerRef={clampMenu} entries={[
//     { kind: 'title', label: 'ラベルカラー' },
//     { kind: 'swatches', colors: LABEL_COLORS, onPick: (c) => …  },
//     { kind: 'sep' },
//     { kind: 'item', label: '削除', danger: true, onClick: … }
//   ]} />
//
// 条件付きの行は false を混ぜてよい（`cond && {…}`）。ここで捨てる。

import type { ReactNode } from 'react'

export type MenuEntry =
  | { kind: 'title'; label: ReactNode }
  /** 使い方の一言（押せない） */
  | { kind: 'note'; label: string }
  | { kind: 'sep' }
  | {
      kind: 'item'
      label: ReactNode
      onClick: () => void
      /** 取り消せない操作は赤く出す */
      danger?: boolean
      /** いま選ばれている行（✓ の代わりに色を変える） */
      on?: boolean
      title?: string
    }
  /** 色見本の並び。none を渡すと「色なし」も出す */
  | {
      kind: 'swatches'
      colors: { color: string; name: string }[]
      onPick: (color: string) => void
      onNone?: () => void
    }
  /** 上のどれでもない物（並び替えの一覧など） */
  | { kind: 'node'; node: ReactNode }

export type MenuEntries = (MenuEntry | false | null | undefined)[]

export function ContextMenu({
  x,
  y,
  entries,
  innerRef
}: {
  x: number
  y: number
  entries: MenuEntries
  /** 画面の外へはみ出さないように寄せる（App の clampMenu） */
  innerRef?: (el: HTMLDivElement | null) => void
}): React.JSX.Element {
  return (
    <div
      className="ctx-menu"
      ref={innerRef}
      style={{ left: x, top: y }}
      // メニューの中のクリックで、裏のタイムラインの選択解除まで走らせない
      onClick={(e) => e.stopPropagation()}
    >
      {entries.filter(Boolean).map((e, i) => {
        const en = e as MenuEntry
        switch (en.kind) {
          case 'title':
            return (
              <div key={i} className="ctx-title">
                {en.label}
              </div>
            )
          case 'note':
            return (
              <div key={i} className="ctx-note">
                {en.label}
              </div>
            )
          case 'sep':
            return <div key={i} className="ctx-sep" />
          case 'swatches':
            return (
              <div key={i} className="ctx-swatches">
                {en.colors.map((l) => (
                  <button
                    key={l.color}
                    className="ctx-swatch"
                    style={{ background: l.color }}
                    title={l.name}
                    onClick={() => en.onPick(l.color)}
                  />
                ))}
                {en.onNone && (
                  <button className="ctx-swatch ctx-swatch-none" title="色なし" onClick={en.onNone} />
                )}
              </div>
            )
          case 'node':
            return <div key={i}>{en.node}</div>
          default:
            return (
              <button
                key={i}
                className={`ctx-item ${en.danger ? 'ctx-danger' : ''} ${en.on ? 'ctx-on' : ''}`}
                title={en.title}
                onClick={en.onClick}
              >
                {en.label}
              </button>
            )
        }
      })}
    </div>
  )
}
