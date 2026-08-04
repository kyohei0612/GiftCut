// プロジェクトのテンプレート——**開始状態を揃える**ための雛形。
//
// ## 何を覚えるか
//
// 素材ビン・アイコンの見た目・テロップの整理（★/分類/自作）・既定スタイル・
// **画面の配置**。タイムラインの中身（切片・テロップ・音）は一切入れない。
//
// ## 原本を汚さない
//
// テンプレートから始めたら**保存先を引き継がない**（`setProjectPath(null)`）。
// 残すと直後の Ctrl+S が、元にしたプロジェクトを無警告で上書きする。
//
// ## 置き換えではなく「混ぜる」
//
// テロップの整理とアイコンの割り当ては、**いまの設定を消さずに足す**。
// 混ぜ方の決まりは `shared/templateMerge` にあり、「いまの設定が勝つ」向きも
// 含めて試験で見張ってある。置き換えにしていた頃は、**テンプレートを1回開く
// だけで育てた設定が全部消えた**（戻せない）。
//
// ## なぜ独立したファイルなのか
//
// 元は `useProjectFile.ts`（667行）の中で、あちらの冒頭が
// 「プロジェクトの開く・保存・復元**と、テンプレート**」と**2つ宣言していた**
//（2026-08-03 に出した）。開く・保存は「いま作っている物」を読み書きする話で、
// こちらは「次に始めるときの形」を決める話。触る持ち物がほとんど重ならない。
//
// ## 中身
//
// - `useProjectTemplates` … 下をまとめて返す唯一の入口（外へ出るのは後ろの3つ）
// - `templateJson` … いまの設定を雛形として文字列にする（中だけで使う）
// - `applyProjectTemplate` … 読んだ雛形を当てる。**混ぜる**（中だけで使う）
// - `saveAsTemplateFn` … 名前を尋ねて雛形として保存する
// - `openTemplateFn` … 雛形の一覧を出す（無ければその旨を言う）
// - `pickTemplate` … 一覧で選ばれた1つを読んで当てる
import { useState } from 'react'
import { toGcUrl } from '../lib/gcUrl'
import { mergeAssignments, mergeFavorites, mergeFolders, mergeNamed } from '../../../shared/templateMerge'
// ※ ここでは lib/telopTemplates と lib/iconLibrary の save* を**呼ばない**。
//   プロジェクトから来た物をアプリ側へ焼き付けないため（下の「混ぜるが保存しない」）。
//   保存するのは、人が「保存」を押したとき（state/useLabelsPresets の savePreset）と
//   整理を触ったとき（state/useLibraryOrganize）だけ。
import type { MediaItem } from '../components/panels/ProjectBinTab'
import { useProjectStateCtx } from './projectStateContext'
import { useToastCtx } from './toastContext'
import { useExportCtx } from './exportContext'
import { useMediaCtx } from './mediaContext'
import { useIconsCtx } from './iconsContext'

/**
 * 雛形を選ぶ窓の中身（起動時と手動の両方）。
 *
 * **ここが唯一の家。** 前は `useAppWiring` の `useState` に直書きされていて、
 * 受け取る側2つ（ここと `useAutosaveDraft`）はどちらも `any` だった＝
 * 形が変わっても誰も気づけない。
 */
export type TemplatePickerState = {
  items: { name: string; path: string }[]
  startup: boolean
}

// **`any` で受けない。** ここは呼ぶ側が実物を渡す入口なので、
// 型がズレた瞬間に呼び出し側で落ちる＝手で書いても腐らない。
export interface UseProjectTemplatesDeps {
  /** 素材の種類（動画/音/画像）をパスから見分ける */
  kindOf: (p: string) => 'video' | 'audio' | 'image'
  /** いまの画面の配置を控える／当てる（窓を出した形も含む） */
  layoutNow: () => Record<string, unknown>
  /** **`l` が `any` なのは借りている側もそうだから**（直すならあちらが先） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyLayout: (l: any) => void
  /** 名前を尋ねる小窓 */
  askText: (title: string, def: string, onOk: (v: string) => void) => void
  saveLS: (key: string, v: unknown) => void
}

export function useProjectTemplates(deps: UseProjectTemplatesDeps) {
  const { kindOf, layoutNow, applyLayout, askText, saveLS } = deps
  /**
   * 雛形を選ぶ窓（起動時と手動の両方）。**当てても原本は汚さない**＝新規扱いで開く。
   *
   * **配線から引き取った（2026-08-04）。** 開けるのはここだけで、配線は
   * `useState` を持って渡していただけだった。閉じるのと中身を出すのは画面（束）。
   */
  const [templatePicker, setTemplatePicker] = useState<TemplatePickerState | null>(null)
  const { showToast } = useToastCtx()
  const { ratio, setRatio } = useExportCtx()
  const { mediaItems, setMediaItems, mediaIdCounter } = useMediaCtx()
  const {
    iconSide, setIconSide, iconOffset, setIconOffset, iconScale, setIconScale,
    iconAuto, setIconAuto, iconAnchorPos, setIconAnchorPos
  } = useIconsCtx()
  const {
    setProjectPath, favorites, setFavorites, catOverrides, setCatOverrides,
    customCats, setCustomCats, userTemplates, setUserTemplates,
    newTelopStyle, setNewTelopStyle, iconAssign, setIconAssignState,
    laneIconAssign, setLaneIconAssign
  } = useProjectStateCtx()

  function templateJson(): string {
    return JSON.stringify(
      {
        version: 1,
        kind: 'template',
        ratio,
        mediaItems: mediaItems.map((m) => ({
          path: m.path,
          name: m.name,
          kind: m.kind,
          folder: m.folder
        })),
        iconSide,
        iconOffset,
        iconScale,
        iconAuto,
        iconAnchorPos,
        // テンプレは「開始状態を揃える」ものなので、テロップの自作テンプレと
        // アイコン割当・既定スタイルも含める（含めないと★が存在しないテンプレを指す）
        telop: { favorites, catOverrides, customCats, userTemplates },
        iconAssign,
        laneIconAssign,
        newTelopStyle,
        // 画面の配置も込みで覚える。テンプレは「開始状態を揃える」ものなので、
        // 窓を出した形で登録すれば、次からその形で始まる
        layout: layoutNow()
      },
      null,
      1
    )
  }

  /** テンプレを適用（メディアビン＋テロップ設定＋設定。タイムラインは触らない） */
  function applyProjectTemplate(data: any): void {
    const d = data as any
    // テンプレは「新規プロジェクトの開始状態」なので、保存先は引き継がない。
    // 残すと直後の Ctrl+S が元のプロジェクトを無警告で上書きしてしまう。
    setProjectPath(null)
    if (d.ratio) setRatio(d.ratio)
    if (Array.isArray(d.mediaItems)) {
      const items: MediaItem[] = d.mediaItems
        .filter((m: any) => m && typeof m.path === 'string')
        .map((m: any) => {
          const kind = kindOf(String(m.path))
          return {
            id: mediaIdCounter.current++,
            path: String(m.path),
            name: String(m.name ?? String(m.path).split(/[\\/]/).pop() ?? ''),
            kind,
            folder: typeof m.folder === 'string' ? m.folder : undefined,
            thumb: kind === 'image' ? toGcUrl(String(m.path)) : undefined
          }
        })
      // 画像はパスをそのままサムネに（テンプレ適用と同じ扱いに揃える）
      const withThumb = items.map((m) =>
        m.kind === 'image' ? { ...m, thumb: toGcUrl(m.path) } : m
      )
      setMediaItems(withThumb)
      // サムネ・尺・波形は見えている物だけ用意する（onVisible が呼ぶ）
    }
    if (d.iconSide) setIconSide(d.iconSide)
    if (d.iconOffset && typeof d.iconOffset.x === 'number') setIconOffset(d.iconOffset)
    if (typeof d.iconScale === 'number') setIconScale(d.iconScale)
    if (typeof d.iconAuto === 'boolean') setIconAuto(d.iconAuto)
    if (d.iconAnchorPos && typeof d.iconAnchorPos.x === 'number' && typeof d.iconAnchorPos.y === 'number')
      setIconAnchorPos({ x: d.iconAnchorPos.x, y: d.iconAnchorPos.y })
    // 動画ズーム（リフレーム）は切片ごと（loadedSegs で復元済み）。旧グローバル videoZoom は無視。
    //
    // テロップの整理（★/分類/自作フォルダ/自作テロップ）とアイコンの割り当ては
    // **置き換えではなく混ぜる**。混ぜ方の決まりは shared/templateMerge にあり、
    // 「いまの設定が勝つ」向きも含めてテストで見張ってある。
    // 置き換えにしていた頃は、テンプレを1回開くだけで育てた設定が全部消えた（戻せない）。
    //
    // ## **混ぜるが、アプリ側へは保存しない**（2026-08-03 に変えた）
    //
    // 前はここで `saveFavorites` などを呼んでいて、**プロジェクトを1つ開くだけで
    // その中身がアプリのライブラリへ焼き付いた**。新規で始めても前のプロジェクトの
    // ★・分類・自作フォルダ・自作テロップが残り、
    // **「デフォルトのテンプレートが意味をなさない」**（本人）状態になっていた。
    //
    // → 画面には出す（`setXxx` は残す＝人からもらったプロジェクトでも見た目が再現する）。
    //   **保存はしない**ので、閉じれば消える。自分の物にしたいなら「保存」を押す
    //   ——本人の言う「**登録とか保存した奴にしない限りはデフォルト**」がこれ。
    //
    // ※ 置き換えに戻したわけではない。**消すのではなく、書かないだけ**なので、
    //   上に書いてある「育てた設定が全部消える」事故は起きない。
    //
    // ※ **残っている穴**: 開いている間に自分で★を押すと、そのとき画面に出ている
    //   一覧（＝プロジェクト由来を含む）がまるごと保存される。切り分けるには
    //   「アプリ側の物」と「このプロジェクト由来の物」を別々に持つ必要があり、
    //   整理の心臓（useLibraryOrganize）まで手が入る。`やること.md` に控えてある。
    if (d.telop) {
      const favs = mergeFavorites(favorites, d.telop.favorites)
      // ※ ここに saveFavorites を戻すと本当に赤くなることを確かめてある（2026-08-03）。
      //   useProjectTemplates.test.ts が「プロジェクトを開く道で saveFavorites( を
      //   呼んでいる」で落ちる。**import も消してあるので型検査でも止まる**（二重の防波堤）
      if (favs !== favorites) setFavorites(favs)
      const cats = mergeAssignments(catOverrides, d.telop.catOverrides)
      if (cats !== catOverrides) setCatOverrides(cats)
      const folders = mergeFolders(customCats, d.telop.customCats)
      if (folders !== customCats) setCustomCats(folders)
      const tpls = mergeNamed(userTemplates, d.telop.userTemplates)
      if (tpls.length !== userTemplates.length) setUserTemplates(tpls)
    }
    const icons = mergeAssignments(iconAssign, d.iconAssign)
    if (icons !== iconAssign) setIconAssignState(icons)
    const laneIcons = mergeAssignments(laneIconAssign, d.laneIconAssign)
    if (laneIcons !== laneIconAssign) {
      setLaneIconAssign(laneIcons)
      saveLS('giftcut.laneIconAssign', laneIcons)
    }
    if (d.newTelopStyle && typeof d.newTelopStyle === 'object') setNewTelopStyle(d.newTelopStyle)
    // 画面の配置（窓を出した形も含む）。テンプレの目的は「開始状態を揃える」こと
    applyLayout(d.layout)
    showToast('テンプレートを読み込みました。', 'success')
  }

  // 現在の設定をテンプレートとして保存（GiftCut/テンプレート/ 配下）
  function saveAsTemplateFn(): void {
    askText('テンプレート名', 'マイテンプレート', (name) => {
      if (!name) return
      void window.giftcut.saveTemplate(name, templateJson()).then((res) => {
        if (res?.ok) showToast('テンプレートを保存しました:\n' + res.path, 'success')
        else showToast('保存失敗: ' + (res?.error ?? ''), 'error')
      })
    })
  }

  // テンプレートを開く＝テンプレートフォルダ内の一覧から選ぶ（アプリ内ピッカー）
  async function openTemplateFn(): Promise<void> {
    const t = await window.giftcut.listTemplates()
    if (!t?.ok || !t.items.length) {
      showToast('テンプレートがありません。\n「テンプレートとして保存」で作成してください。')
      return
    }
    setTemplatePicker({ items: t.items, startup: false })
  }

  async function pickTemplate(path: string): Promise<void> {
    setTemplatePicker(null)
    const res = await window.giftcut.loadTemplate(path)
    if (!res?.ok || !res.data) {
      showToast('テンプレートを開けませんでした:\n' + (res?.error ?? ''), 'error')
      return
    }
    applyProjectTemplate(res.data)
  }

  // **templateJson / applyProjectTemplate は返さない。** 受け取る所が無い
  // （この中でだけ使う。return の中は noUnusedLocals が見ないので、
  //   放っておくと「返しているのに誰も取らない」物が静かに増える）。
  return { saveAsTemplateFn, openTemplateFn, pickTemplate, templatePicker, setTemplatePicker }
}
