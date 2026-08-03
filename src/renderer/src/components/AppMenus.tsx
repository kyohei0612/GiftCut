// 右クリックで出る品書き（メニュー）を1か所に並べる。**中身は3つに分けてある。**
//
// ## 3つの畑
//
//   menus/TabMenus      … 区画（パネル）の置き場。切り離す・戻す・タブの並び替え
//   menus/ClipMenus     … 編集の操作。テロップ／動画切片・SE・画像
//   menus/OrganizeMenus … 片付け。フォルダへ移動・お気に入り
//
// **3つは定数もヘルパも1つも共有していない。** 元は492行の1ファイルで、
// 冒頭が「種類は6つ」と宣言していたが、6つは上の3つの畑に分かれていて、
// 唯一の共有物（`nestEntries`）は ClipMenus の中で閉じていた（2026-08-03）。
//
// ## 受け渡しはゼロ
//
// どれも `useMenus()` から自分で見に行くので、ここから渡す物は何も無い。
// 品書きが要る50個以上の名前は `state/menusContext` に集めてある。
import type { JSX } from 'react'
import { TabMenus } from './menus/TabMenus'
import { ClipMenus } from './menus/ClipMenus'
import { OrganizeMenus } from './menus/OrganizeMenus'

export function AppMenus(): JSX.Element {
  return (
    <>
      <TabMenus />
      <ClipMenus />
      <OrganizeMenus />
    </>
  )
}
