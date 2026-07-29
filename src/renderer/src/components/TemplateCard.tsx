// テロップテンプレの小カード。
//
// 見本の「あア」は、**本番と同じ描画エンジン**（buildTelopSVG）で描く。
// 別のやり方で描くと、カードで見た目と実際に置いたテロップが食い違う。
// viewBox を preserveAspectRatio=meet でカードに合わせるので、
// 文字の大きさや装飾が変わっても、勝手に一番大きく収まる。
import type { JSX } from 'react'
import { buildTelopSVG, hexToRgba } from '../lib/telopStyle'
import { TELOP_CATS, type TelopTemplate } from '../lib/telopTemplates'

const THUMB_TEXT = 'あア'
const THUMB_FONT_1080 = 780 // 1080基準のフォントサイズ。62px高サムネで約45px表示（本家風にカードいっぱい）
export default function TemplateCard({
  tpl,
  onApply,
  onDelete,
  onDragStartTpl,
  onDragEndTpl,
  fav,
  onToggleFav,
  curCat,
  onSetCat,
  catOptions,
  onContextMenu
}: {
  tpl: TelopTemplate
  onApply: () => void
  onDelete?: () => void
  onDragStartTpl?: () => void
  onDragEndTpl?: () => void
  fav?: boolean
  onToggleFav?: () => void
  curCat?: string
  onSetCat?: (cat: string) => void
  catOptions?: { key: string; label: string }[]
  onContextMenu?: (e: React.MouseEvent) => void
}): JSX.Element {
  // 本番SVGエンジンで描画。viewBox(文字+装飾)を preserveAspectRatio=meet でカードにフィット
  // ＝自動で最大サイズ表示（本家風にカードいっぱい）。scaleTelopStyle不要。
  const tsvg = buildTelopSVG(tpl.style, THUMB_TEXT)
  const bg = tpl.style.background
  return (
    <div
      className="tpl-card"
      onClick={onApply}
      onContextMenu={onContextMenu}
      title="クリックで適用 / 右クリックでフォルダ移動 / ドラッグで適用"
      draggable
      onDragStart={onDragStartTpl}
      onDragEnd={onDragEndTpl}
    >
      {onDelete && (
        <button
          className="tpl-del"
          title="削除"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          ✕
        </button>
      )}
      {onToggleFav && (
        <button
          className={`tpl-fav ${fav ? 'on' : ''}`}
          title={fav ? 'お気に入り解除' : 'お気に入りに追加'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleFav()
          }}
        >
          {fav ? '★' : '☆'}
        </button>
      )}
      {onSetCat && (
        <select
          className="tpl-cat"
          title="カテゴリを変更"
          value={curCat}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation()
            onSetCat(e.target.value)
          }}
        >
          {(catOptions ?? TELOP_CATS).map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      )}
      <div className="tpl-thumb">
        <div
          style={{
            width: '94%',
            height: '86%',
            ...(bg.enabled
              ? { background: hexToRgba(bg.color, bg.opacity), borderRadius: 4 }
              : null)
          }}
          dangerouslySetInnerHTML={{ __html: tsvg.svg }}
        />
      </div>
      <div className="tpl-name">{tpl.name}</div>
    </div>
  )
}
