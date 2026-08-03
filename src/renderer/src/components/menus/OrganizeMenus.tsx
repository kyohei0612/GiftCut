// 素材カードの右クリック——**片付け**（フォルダへ移動・お気に入り）。
//
// テロップの見本と、SE／アイコンの2つ。**見た目は同じに揃えてある**
// （並べ方が違うと「テロップだけ別の操作」に見える）。
//
// ## 押したら必ず閉じる
//
// 閉じ忘れると、次にどこかを押したとき「まだ開いている品書き」に取られる。
import type { JSX } from 'react'
import { ContextMenu } from '../ContextMenu'
import { useMenus } from '../../state/menusContext'

export function OrganizeMenus(): JSX.Element {
  // **受け取らず、心臓から自分で見に行く**（区画と同じ流儀）
  const {
    tplMenu, setTplMenu, orgMenu, setOrgMenu, clampMenu, allCats, customCats, setTplCat,
    isFav, toggleFav
  } = useMenus()
  return (
    <>
      {/* テロップカード: フォルダ（カテゴリ）へ移動 */}
      {tplMenu && (
        <ContextMenu
          x={tplMenu.x}
          y={tplMenu.y}
          innerRef={clampMenu}
          entries={[
            { kind: 'title', label: 'フォルダへ移動' },
            ...allCats.map(
              (c: { key: string; label: string }) =>
                ({
                  kind: 'item',
                  on: tplMenu.curCat === c.key,
                  label: `${tplMenu.curCat === c.key ? '✓ ' : ''}${
                    customCats.some((cc: { key: string }) => cc.key === c.key) ? '📁 ' : ''
                  }${c.label}`,
                  onClick: () => {
                    setTplCat(tplMenu.name, c.key)
                    setTplMenu(null)
                  }
                }) as const
            ),
            { kind: 'sep' },
            {
              kind: 'item',
              label: isFav(tplMenu.name) ? '★ お気に入り解除' : '☆ お気に入りに追加',
              onClick: () => {
                toggleFav(tplMenu.name)
                setTplMenu(null)
              }
            }
          ]}
        />
      )}

      {/* SE/アイコン: フォルダ移動＋お気に入り（テロップと同じ見た目） */}
      {orgMenu && (
        <ContextMenu
          x={orgMenu.x}
          y={orgMenu.y}
          innerRef={clampMenu}
          entries={[
            { kind: 'title', label: 'フォルダへ移動' },
            ...orgMenu.options.map(
              (o: { label: string; checked?: boolean; act: () => void }) =>
                ({
                  kind: 'item',
                  on: o.checked,
                  label: o.label,
                  onClick: () => {
                    o.act()
                    setOrgMenu(null)
                  }
                }) as const
            )
          ]}
        />
      )}
    </>
  )
}
