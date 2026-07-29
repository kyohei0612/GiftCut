// 一番上の「ファイル」メニュー。
//
// 中身は**並べる物の一覧**で渡す（右クリックメニューと同じ流儀）。
// どの行がどんな時に出るのかが、呼ぶ側で一列に並んで見える。
//
// ここに置くのは「パネルからは届かない操作」だけ。素材の追加・SRT読込・書き出しは
// プロジェクトパネルとモードバーでできるので出さない。
// 同じ物が2箇所にあると、どちらが正しいのかを毎回考えることになる。

import type { JSX } from 'react'

export type MenuRow =
  | { kind: 'item'; label: string; onClick: () => void; title?: string }
  /** 押せない見出し（「最近使ったプロジェクト」など） */
  | { kind: 'label'; label: string }
  | { kind: 'sep' }
  /** 最近使った物のように、細く出す行 */
  | { kind: 'recent'; label: string; title?: string; onClick: () => void }

export function MenuBar({
  open,
  onToggle,
  rows
}: {
  open: boolean
  onToggle: () => void
  rows: (MenuRow | false | null | undefined)[]
}): JSX.Element {
  return (
    <div className="menubar">
      <div className="menu-wrap">
        <span
          className={`menu-item ${open ? 'menu-item-on' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
        >
          ファイル
        </span>
        {open && (
          <div className="menu-dropdown" onClick={(e) => e.stopPropagation()}>
            {rows.filter(Boolean).map((r, i) => {
              const row = r as MenuRow
              if (row.kind === 'sep') return <div key={i} className="menu-drop-sep" />
              if (row.kind === 'label')
                return (
                  <div key={i} className="menu-drop-label">
                    {row.label}
                  </div>
                )
              return (
                <button
                  key={i}
                  className={`menu-drop-item ${row.kind === 'recent' ? 'menu-drop-recent' : ''}`}
                  title={row.title}
                  onClick={row.onClick}
                >
                  {row.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
