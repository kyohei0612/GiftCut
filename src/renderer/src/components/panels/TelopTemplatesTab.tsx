// 右パネルの「テロップ」タブ。テロップの見た目（スタイル）の見本帳。
//
// クリックで、選んでいるテロップに適用（何も選んでいなければ「次に足す物」の既定）。
// タイムラインへドラッグしても付けられる。
//
// 並びは ★お気に入り → マイテンプレート → プリセット → 色カテゴリ／自作フォルダ。
// アコーディオンは1つだけ開く（このタブは数が多く、全部開くと探せなくなる）。

import type { JSX } from 'react'
import TemplateCard from '../TemplateCard'
import type { TelopTemplate } from '../../lib/telopTemplates'

export interface TemplateSection {
  key: string
  label: string
  cards: JSX.Element[]
  /** 自分で作ったフォルダ（✕ で消せる） */
  custom?: boolean
}

export function TelopTemplatesTab({
  bodyRef,
  hasSelection,
  userTemplates,
  builtinTemplates,
  localTemplates,
  categories,
  customCategories,
  openSection,
  sectionRefs,
  isFav,
  catOf,
  onToggleSection,
  onSaveCurrent,
  onAddFolder,
  onDeleteFolder,
  onRefresh,
  onApply,
  onDeleteUserTemplate,
  onToggleFav,
  onSetCat,
  onCardContextMenu,
  onDragStartTpl,
  onDragEndTpl
}: {
  bodyRef: React.Ref<HTMLDivElement>
  /** テロップを選んでいるか（説明文が変わる） */
  hasSelection: boolean
  userTemplates: TelopTemplate[]
  builtinTemplates: TelopTemplate[]
  localTemplates: TelopTemplate[]
  categories: { key: string; label: string }[]
  customCategories: { key: string; label: string }[]
  openSection: string | null
  sectionRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>
  isFav: (name: string) => boolean
  catOf: (t: TelopTemplate) => string
  onToggleSection: (key: string) => void
  onSaveCurrent: () => void
  onAddFolder: () => void
  onDeleteFolder: (key: string) => void
  onRefresh: () => void
  onApply: (style: TelopTemplate['style']) => void
  onDeleteUserTemplate: (index: number) => void
  onToggleFav: (name: string) => void
  onSetCat: (name: string, cat: string) => void
  onCardContextMenu: (t: TelopTemplate, e: React.MouseEvent) => void
  onDragStartTpl: (style: TelopTemplate['style']) => void
  onDragEndTpl: () => void
}): JSX.Element {
  const cardsOf = (
    list: TelopTemplate[],
    keyPfx: string,
    withDel = false,
    withCat = false
  ): JSX.Element[] =>
    list.map((t, i) => (
      <TemplateCard
        key={keyPfx + i}
        tpl={t}
        onApply={() => onApply(t.style)}
        onDelete={withDel ? () => onDeleteUserTemplate(i) : undefined}
        fav={isFav(t.name)}
        onToggleFav={() => onToggleFav(t.name)}
        curCat={withCat ? catOf(t) : undefined}
        onSetCat={withCat ? (cat) => onSetCat(t.name, cat) : undefined}
        catOptions={categories}
        onContextMenu={withCat ? (e) => onCardContextMenu(t, e) : undefined}
        onDragStartTpl={() => onDragStartTpl(t.style)}
        onDragEndTpl={onDragEndTpl}
      />
    ))

  const favs = [...userTemplates, ...builtinTemplates, ...localTemplates].filter((t) =>
    isFav(t.name)
  )
  const secs: TemplateSection[] = []
  if (favs.length) secs.push({ key: 'fav', label: '★ お気に入り', cards: cardsOf(favs, 'f') })
  if (userTemplates.length)
    secs.push({ key: 'user', label: 'マイテンプレート', cards: cardsOf(userTemplates, 'u', true) })
  secs.push({ key: 'builtin', label: 'プリセット', cards: cardsOf(builtinTemplates, 'b') })
  // 色4カテゴリ（中身がある時のみ）＋ 自作フォルダ（空でも出す＝入れ先として見える）
  for (const c of categories) {
    const items = localTemplates.filter((t) => catOf(t) === c.key)
    const isCustom = customCategories.some((cc) => cc.key === c.key)
    if (items.length || isCustom)
      secs.push({
        key: c.key,
        label: c.label,
        cards: cardsOf(items, c.key, false, true),
        custom: isCustom
      })
  }

  return (
    <div className="panel-body" ref={bodyRef}>
      {/* **道具が先、説明が後。**
          以前はこの文が一番上にあり、まだ節が閉じていて何も見えていない段階で
          「クリックで…」と言っていた。押す物が見えてから読ませる。 */}
      <div className="bin-toolbar">
        <button className="btn small" onClick={onSaveCurrent} title="いまの見た目を1つ残す">
          ＋ 保存
        </button>
        <button className="btn small" title="新しいフォルダ（カテゴリ）を作成" onClick={onAddFolder}>
          📁＋ フォルダ
        </button>
        <button
          className="btn small"
          title="外に置いたテロップ素材（telop-presets）を読み直す。アプリの再起動は要りません"
          style={{ marginLeft: 'auto' }}
          onClick={onRefresh}
        >
          ↻ 更新
        </button>
      </div>
      {/* 使い方は「押す物が見えてから」。節を開くまでは、まず開く所を案内する */}
      <div className="tpl-hint">
        {openSection
          ? hasSelection
            ? 'クリックで選択中のテロップに適用'
            : 'クリックで「次に足すテロップ」の既定スタイルに設定'
          : '下の ▶ を押して開くと、見た目の一覧が出ます'}
      </div>
      {secs.map((s) => (
        <div key={s.key} ref={(el) => (sectionRefs.current[s.key] = el)}>
          <button
            className={`tpl-acc ${openSection === s.key ? 'open' : ''}`}
            onClick={() => onToggleSection(s.key)}
          >
            <span className="tpl-acc-ar">{openSection === s.key ? '▼' : '▶'}</span>
            {s.custom ? '📁 ' : ''}
            {s.label}（{s.cards.length}）
            {s.custom && (
              <span
                className="tpl-acc-del"
                title="フォルダを削除（中のテロップは元カテゴリへ戻る）"
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteFolder(s.key)
                }}
              >
                ✕
              </span>
            )}
          </button>
          {openSection === s.key &&
            (s.cards.length ? (
              <div className="tpl-grid">{s.cards}</div>
            ) : (
              <div className="tpl-hint" style={{ padding: '6px 2px' }}>
                空のフォルダです。テロップを右クリック→このフォルダを選ぶと入ります。
              </div>
            ))}
        </div>
      ))}
    </div>
  )
}
