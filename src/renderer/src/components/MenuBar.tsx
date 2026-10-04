// 一番上の「ファイル」メニュー。
//
// 中身は**並べる物の一覧**で渡す（右クリックメニューと同じ流儀）。
// どの行がどんな時に出るのかが、呼ぶ側で一列に並んで見える。
//
// ここに置くのは「パネルからは届かない操作」だけ。素材の追加・SRT読込・書き出しは
// プロジェクトパネルとモードバーでできるので出さない。
// 同じ物が2箇所にあると、どちらが正しいのかを毎回考えることになる。
//
// ## たまにしか使わない物は、1段奥（`sub`）へ入れる
//
// 2026-10-04、行が **26本・高さ 880px** になり、1080p の窓（881px）をまるごと
// 覆っていた（本人「死ぬほど出てくる」）。毎回使う物（開く・保存）が、
// 一度きりの物（置き場のフォルダ5つ・取り込み）に埋もれる。
// 奥の段は**載せる（ホバー）でも押すでも開く**。押して開けないと、
// ホバーの癖が無い人には「押しても何も起きない行」に見える。

import { useState, type JSX } from 'react'

export type MenuRow =
  | { kind: 'item'; label: string; onClick: () => void; title?: string }
  /** 押せない見出し（「最近使ったプロジェクト」など） */
  | { kind: 'label'; label: string }
  | { kind: 'sep' }
  /** 最近使った物のように、細く出す行 */
  | { kind: 'recent'; label: string; title?: string; onClick: () => void }
  /** 1段奥へ入れる束（右へ開く） */
  | {
      kind: 'sub'
      label: string
      rows: (MenuRow | false | null | undefined)[]
    }

function Rows({ rows }: { rows: (MenuRow | false | null | undefined)[] }): JSX.Element {
  // 開いている奥の段は1つだけ（隣へ移ったら前の段は閉じる）
  const [openSub, setOpenSub] = useState<number | null>(null)
  return (
    <>
      {rows.filter(Boolean).map((r, i) => {
        const row = r as MenuRow
        if (row.kind === 'sep') return <div key={i} className="menu-drop-sep" />
        if (row.kind === 'label')
          return (
            <div key={i} className="menu-drop-label">
              {row.label}
            </div>
          )
        if (row.kind === 'sub')
          return (
            <div
              key={i}
              className="menu-sub-wrap"
              onMouseEnter={() => setOpenSub(i)}
              onMouseLeave={() => setOpenSub((o) => (o === i ? null : o))}
            >
              <button
                className={`menu-drop-item menu-drop-sub ${openSub === i ? 'menu-drop-sub-on' : ''}`}
                // **押したら開く（閉じない）。** 載せた時点でもう開いているので、
                // 切り替えにすると「載せて開く → 押して閉じる」で押した人には開かない
                onClick={() => setOpenSub(i)}
              >
                {row.label}
              </button>
              {openSub === i && (
                <div className="menu-dropdown menu-subdrop">
                  <Rows rows={row.rows} />
                </div>
              )}
            </div>
          )
        return (
          <button
            key={i}
            className={`menu-drop-item ${row.kind === 'recent' ? 'menu-drop-recent' : ''}`}
            title={row.title}
            onMouseEnter={() => setOpenSub(null)}
            onClick={row.onClick}
          >
            {row.label}
          </button>
        )
      })}
    </>
  )
}

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
            <Rows rows={rows} />
          </div>
        )}
      </div>
    </div>
  )
}
