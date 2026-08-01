// 右パネルの区画。素材の置き場・テロップテンプレ・アイコン・効果音・トランジション。
//
// ## どのタブも作りは同じ
//
// 「一覧を出す」「掴んで持っていく」「整理する（お気に入り・フォルダ）」の組み合わせ。
// 実体は components/panels/*Tab.tsx にあり、ここはその受け渡し。
//
// ## 渡す物が少ないのは心臓に載せてあるから
//
// 右パネル固有の物は state/rightPanelContext。**props で配ると100個を超える。**

import type { JSX } from 'react'
import { PaneHost, PanelTabs } from '../PanelChrome'
import { ProjectBinTab } from './ProjectBinTab'
import { TelopTemplatesTab } from './TelopTemplatesTab'
import { IconLibraryTab } from './IconLibraryTab'
import { SeLibraryTab } from './SeLibraryTab'
import { TransitionsTab } from './TransitionsTab'
import { useDoc } from '../../state/contentContext'
import { useSel } from '../../state/selectionContext'
import { useMediaCtx } from '../../state/mediaContext'
import { useToastCtx } from '../../state/toastContext'
import { useLayout } from '../../state/layoutContext'
import { useProjectStateCtx } from '../../state/projectStateContext'
import { useDragPreviewCtx } from '../../state/dragPreviewContext'
import { BUILTIN_TEMPLATES } from '../../lib/telopTemplates'
import { ICON_LIB } from './IconLibraryTab'
import { seMoveTarget } from './SeLibraryTab'
import { TRANS_TYPES, type TransType } from '../../lib/transitions'
import type { AnimIn } from '../../lib/telopStyle'
import { BUILTIN_MOTIONS } from '../../../../shared/builtinMotions'
import { useRightPanel } from '../../state/rightPanelContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface RightPanelAreaProps {
  [k: string]: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function RightPanelArea(p: RightPanelAreaProps): JSX.Element {
  const {
    PANE_LABEL, orderedTabs, TAB_DEFS, pickTab, setTabOrder, setTabMenu, setTabOverflow,
    setTplMenu, setOrgMenu, rightTab, setTransDrop, draggingTransRef, draggingTelopAnimRef,
    setDragChip, setTelopDrop, toggleTelopEmphasis, myMotions, motionPresets,
    applyMotionPreset, deleteMyMotion
  } = p
const {
    accSec, rightBodyRef, importSeInto, addMediaAtPlayhead, catOf, srtPath,
    labelGroups, removeMedia, beginMediaDrag, draggingMediaRef, localTemplates, isFav,
    draggingTemplateRef, iconFavs, toggleIconFav, draggingIconRef, seLibrary, seFavs,
    setSeFolderOf, toggleSeFav, TELOP_MOTIONS, addFilesToProject, addFolderToProject, handleImportSrt,
    loadVideo, selectByLabel, genThumbFor, prepareMediaMeta, allCats, openTplSec,
    tplSecRefs, toggleTplSec, saveCurrentAsTemplate, addCustomCat, deleteCustomCat, refreshPresets,
    applyTemplate, deleteUserTemplate, toggleFav, setTplCat, iconLibrary, iconFolders,
    iconOv, addIconImages, addIconFiles, addIconFolder, deleteIconFolder, removeIconImage,
    setIconFolderOf, seFolders, seOv, addSeFolder, deleteSeFolder, refreshSE,
    previewSE, setSelectedTransType, updateSelectedTransDur, deleteSelectedTrans, setTelopTransType, updateTelopTransDur,
    deleteSelectedTelopTrans
  } = useRightPanel()
  const { cues, setCues, segments } = useDoc()
  const {
    selectedTrans, setSelectedTrans, selectedTelopTrans, setSelectedTelopTrans,
    selectedIds, isSelected, selectedMediaId, setSelectedMediaId
  } = useSel()
  const { videoPath, mediaItems } = useMediaCtx()
  const { showToast } = useToastCtx()
  const { popped, isPopped, paneGeom, unpopPane, rightW } = useLayout()
  const { favorites, userTemplates, customCats, transDur, setTransDur } = useProjectStateCtx()
  const { setSeGhost, setVideoGhost, setImgGhost } = useDragPreviewCtx()
  return (
      <PaneHost id="right" title={PANE_LABEL.right} popped={isPopped('right')}
        geom={paneGeom.right} onClose={() => unpopPane('right')}>
      {/* --- 右: プロジェクト --- */}
      <section
        className="panel"
        style={{ width: rightW, flex: '0 0 auto' }}
      >
        <PanelTabs
          group="right"
          tabs={orderedTabs('right', TAB_DEFS.right)}
          active={rightTab}
          onPick={(id) => pickTab('right', id)}
          onTabMenu={(e, grp, id, label) => {
            e.preventDefault()
            e.stopPropagation()
            setTabOverflow(null)
            setTabMenu({ x: e.clientX, y: e.clientY, group: grp, id, label })
          }}
          onOverflow={(e, grp, hidden) => {
            e.stopPropagation()
            setTabMenu(null)
            setTabOverflow({ x: e.clientX, y: e.clientY, group: grp, hidden })
          }}
          onReorder={(ids) => setTabOrder((prev: Record<string, string[]>) => ({ ...prev, right: ids }))}
        />
        {/* --- 右: プロジェクト（素材の置き場）--- 中身は components/panels/ProjectBinTab.tsx */}
        {rightTab === 'project' && (
          <ProjectBinTab
            bodyRef={rightBodyRef}
            accSec={accSec}
            items={mediaItems}
            activePath={videoPath}
            selectedId={selectedMediaId}
            srtName={srtPath ? (srtPath.split(/[\\/]/).pop() ?? null) : null}
            cueCount={cues.length}
            labelGroups={labelGroups}
            onAddFiles={addFilesToProject}
            onAddFolder={addFolderToProject}
            onImportSrt={handleImportSrt}
            onAddAtPlayhead={addMediaAtPlayhead}
            onSelect={setSelectedMediaId}
            onOpenVideo={(m) => {
              // 何も読み込んでいなければ読み込む。既に編集中なら
              // タイムラインを壊さない（ダブルクリックで全消しは事故になる）。
              if (!videoPath) void loadVideo(m.path)
              else
                showToast('タイムラインへドラッグして配置してください（Ctrl+ドロップで挿入）。')
            }}
            onRemove={removeMedia}
            // **音はここからSEへ送れるようにする。**
            // プロジェクトに入れても SE の一覧には出てこないので、
            // 「入れたのに使えない」で止まっていた（案内文も SE を指していた）
            onContextMenu={(m, e) => {
              const opts: { label: string; act: () => void }[] = []
              if (m.kind === 'audio')
                opts.push({
                  label: '🔊 SE へ入れる（右の SE タブに並びます）',
                  act: () => void importSeInto([m.path])
                })
              opts.push({
                label: '▶ 再生ヘッドの位置へ置く',
                act: () => addMediaAtPlayhead(m)
              })
              opts.push({ label: '✕ プロジェクトから削除', act: () => removeMedia(m.id) })
              setOrgMenu({ x: e.clientX, y: e.clientY, options: opts })
            }}
            onDragStart={beginMediaDrag}
            onDragEnd={() => {
              draggingMediaRef.current = null
              setSeGhost(null)
              setVideoGhost(null)
              setImgGhost(null)
            }}
            onPickLabel={selectByLabel}
            onVisible={(vis) => {
              // 見えた物のサムネと波形をここで用意する。
              // どちらも「同じ物は1回だけ」なので、何度呼ばれても増えない。
              for (const m of vis) {
                if (m.kind === 'video') genThumbFor(m.id, m.path)
                prepareMediaMeta(m.path, m.kind)
              }
            }}
          />
        )}

        {/* --- テロップテンプレ --- 中身は components/panels/TelopTemplatesTab.tsx */}
        {rightTab === 'telop' && (
          <TelopTemplatesTab
            bodyRef={rightBodyRef}
            hasSelection={selectedIds.length > 0}
            userTemplates={userTemplates}
            builtinTemplates={BUILTIN_TEMPLATES}
            localTemplates={localTemplates}
            categories={allCats}
            customCategories={customCats}
            openSection={openTplSec}
            sectionRefs={tplSecRefs}
            isFav={isFav}
            catOf={catOf}
            onToggleSection={toggleTplSec}
            onSaveCurrent={saveCurrentAsTemplate}
            onAddFolder={addCustomCat}
            onDeleteFolder={deleteCustomCat}
            onRefresh={refreshPresets}
            onApply={applyTemplate}
            onDeleteUserTemplate={deleteUserTemplate}
            onToggleFav={toggleFav}
            onSetCat={setTplCat}
            onCardContextMenu={(t, e) => {
              e.preventDefault()
              e.stopPropagation()
              setTplMenu({ x: e.clientX, y: e.clientY, name: t.name, curCat: catOf(t) })
            }}
            onDragStartTpl={(style) => (draggingTemplateRef.current = style)}
            onDragEndTpl={() => (draggingTemplateRef.current = null)}
          />
        )}

        {/* --- アイコン（画像置き場）--- 中身は components/panels/IconLibraryTab.tsx */}
        {rightTab === 'icon' && (
          <IconLibraryTab
            library={iconLibrary}
            folders={iconFolders}
            moved={iconOv}
            favorites={iconFavs}
            bodyRef={rightBodyRef}
            accSec={accSec}
            onAddImages={addIconImages}
            onDropFiles={addIconFiles}
            onAddFolder={addIconFolder}
            onDeleteFolder={deleteIconFolder}
            onDelete={removeIconImage}
            onToggleFav={toggleIconFav}
            onApplyToSelection={(image) => {
              if (!selectedIds.length) return
              setCues((prev) =>
                prev.map((c) =>
                  isSelected(c.id) ? { ...c, iconImage: image, personIcon: undefined } : c
                )
              )
            }}
            onDragStart={(image) => (draggingIconRef.current = image)}
            onDragEnd={() => (draggingIconRef.current = null)}
            onContextMenu={(it, cur, e) => {
              const dests = [
                { key: ICON_LIB, label: 'アイコン画像', custom: false },
                ...iconFolders.map((f: { key: string; label: string }) => ({ key: f.key, label: f.label, custom: true }))
              ]
              setOrgMenu({
                x: e.clientX,
                y: e.clientY,
                options: [
                  ...dests.map((d) => ({
                    label: `${cur === d.key ? '✓ ' : ''}${d.custom ? '📁 ' : ''}${d.label}`,
                    checked: cur === d.key,
                    act: () =>
                      setIconFolderOf(String(it.id), d.key === ICON_LIB ? null : d.key)
                  })),
                  {
                    label: iconFavs.includes(String(it.id))
                      ? '★ お気に入り解除'
                      : '☆ お気に入りに追加',
                    act: () => toggleIconFav(String(it.id))
                  }
                ]
              })
            }}
          />
        )}

        {/* --- SE（効果音の置き場）--- 中身は components/panels/SeLibraryTab.tsx */}
        {rightTab === 'se' && (
          <SeLibraryTab
            library={seLibrary}
            folders={seFolders}
            moved={seOv}
            favorites={seFavs}
            bodyRef={rightBodyRef}
            accSec={accSec}
            onAddFolder={addSeFolder}
            onDeleteFolder={deleteSeFolder}
            onRefresh={refreshSE}
            onImport={() => void importSeInto()}
            onImportFolder={() => void importSeInto('folder')}
            onDropPaths={(paths) => void importSeInto(paths)}
            onPreview={previewSE}
            onMoveTo={setSeFolderOf}
            onToggleFav={toggleSeFav}
            onDragStart={(s, e) =>
              beginMediaDrag({ id: -1, path: s.path, name: s.name, kind: 'audio' }, e)
            }
            onAddAtPlayhead={(s) =>
              addMediaAtPlayhead({ id: -1, path: s.path, name: s.name, kind: 'audio' })
            }
            onDragEnd={() => {
              draggingMediaRef.current = null
              setSeGhost(null)
            }}
            onContextMenu={(s, cur, e) => {
              // 移動先の候補＝もとのフォルダ（SE/ の中の名前）＋自分で作ったフォルダ
              const dests = [
                ...Array.from(new Set(seLibrary.map((x: { category: string }) => x.category))).map((c) => ({
                  key: c,
                  label: c,
                  custom: false
                })),
                ...seFolders.map((f: { key: string; label: string }) => ({ key: f.key, label: f.label, custom: true }))
              ]
              setOrgMenu({
                x: e.clientX,
                y: e.clientY,
                options: [
                  ...dests.map((d) => ({
                    label: `${cur === d.key ? '✓ ' : ''}${d.custom ? '📁 ' : ''}${d.label}`,
                    checked: cur === d.key,
                    act: () => setSeFolderOf(s.path, seMoveTarget(s, d.key))
                  })),
                  {
                    label: seFavs.includes(s.path) ? '★ お気に入り解除' : '☆ お気に入りに追加',
                    act: () => toggleSeFav(s.path)
                  }
                ]
              })
            }}
          />
        )}

        {/* --- トランジション --- 中身は components/panels/TransitionsTab.tsx。
            動画クリップもテロップも「頭・間・尻のどこにでも置ける」同じ扱い。 */}
        {rightTab === 'transition' &&
          (() => {
            // 選んでいる帯を、動画側とテロップ側で同じ形にしてから渡す
            const seg = selectedTrans && segments.find((s) => s.id === selectedTrans.segId)
            const vt = !seg
              ? null
              : selectedTrans!.kind === 'xfade'
                ? seg.xfade
                : selectedTrans!.kind === 'in'
                  ? seg.transIn
                  : seg.transOut
            const videoBand =
              seg && vt && selectedTrans
                ? {
                    ico: '🎯',
                    place:
                      selectedTrans.kind === 'xfade'
                        ? '間（クリップ同士）'
                        : selectedTrans.kind === 'in'
                          ? '頭（クリップ開始）'
                          : '尻（クリップ終わり）',
                    type: vt.type,
                    dur: vt.dur,
                    kinds: TRANS_TYPES,
                    onType: (t: string) => setSelectedTransType(t as TransType),
                    onDur: updateSelectedTransDur,
                    onDelete: deleteSelectedTrans,
                    onDeselect: () => setSelectedTrans(null)
                  }
                : null
            const cue =
              selectedTelopTrans && cues.find((c) => c.id === selectedTelopTrans.cueId)
            const anim = cue ? cue.style.anim : null
            const isIn = selectedTelopTrans?.kind === 'in'
            const telopBand =
              cue && anim && selectedTelopTrans
                ? {
                    ico: '💬',
                    place: `テロップ ${isIn ? '頭（出現）' : '尻（消失）'}`,
                    type: isIn ? anim.in : anim.out,
                    dur: isIn ? anim.inDur : anim.outDur,
                    kinds: TELOP_MOTIONS,
                    onType: (t: string) => setTelopTransType(t as AnimIn),
                    onDur: updateTelopTransDur,
                    onDelete: deleteSelectedTelopTrans,
                    onDeselect: () => setSelectedTelopTrans(null)
                  }
                : null
            return (
              <TransitionsTab
                bodyRef={rightBodyRef}
                accSec={accSec}
                selectedVideoBand={videoBand}
                selectedTelopBand={telopBand}
                newDur={transDur}
                onNewDur={setTransDur}
                videoKinds={TRANS_TYPES}
                telopKinds={TELOP_MOTIONS}
                onDragStartVideo={(x, e) => {
                  draggingTransRef.current = { type: x.type as TransType }
                  setDragChip(e, x.ico, x.label)
                }}
                onDragEndVideo={() => {
                  draggingTransRef.current = null
                  setTransDrop(null)
                }}
                onDragStartTelop={(m, e) => {
                  draggingTelopAnimRef.current = { type: m.type as AnimIn }
                  setDragChip(e, m.ico, m.label)
                }}
                onDragEndTelop={() => {
                  draggingTelopAnimRef.current = null
                  setTelopDrop(null)
                }}
                onToggleEmphasis={toggleTelopEmphasis}
                builtinMotions={BUILTIN_MOTIONS}
                myMotions={myMotions}
                motionPresets={motionPresets}
                onApplyMotionPreset={applyMotionPreset}
                onDeleteMyMotion={deleteMyMotion}
              />
            )
          })()}
      </section>
      </PaneHost>
  )
}
