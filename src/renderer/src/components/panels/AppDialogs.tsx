// 画面に覆いかぶさる物をまとめて出す所。
//
// 書き出し・字幕づくり・無音カット・ダッキング・環境設定・アイコン割当・
// 切り抜き・計測の小窓・確認・お知らせ。
//
// ## どれも「開いている間だけ出す」
//
// 開いているかは1つずつ別の状態で持つ。まとめて1つにすると、2つ同時に出したい場面
// （書き出し中に不具合の知らせが出る、など）で困る。
//
// ## 閉じ方は必ず用意する
//
// ✕ と Escape の両方。**閉じられない覆いは、裏を触れなくする一番きつい壊れ方**をする。
//
// ## 渡す物が少ないのは心臓に載せてあるから
//
// 覆い固有の物は state/dialogsContext。**props で配ると70個近くになる。**

import { toGcUrl } from '../../lib/gcUrl'
import { lazy, Suspense, type JSX } from 'react'

/** 計測の小窓。**配布した物でも開ける**が、要るまで読み込まない */
const PerfHud = lazy(() => import('../../dev/PerfHud'))
import { Toasts, PromptModal, ConfirmModal } from '../Overlays'
import { SilenceCutDialog, DuckingDialog } from '../dialogs/AudioDialogs'
import {
  ExportSettingsDialog,
  ExportProgressBox,
  RestorePrompt,
  TemplatePicker
} from '../dialogs/ProjectDialogs'
import { ShortcutSettings, IconAssignSettings } from '../dialogs/SettingsDialogs'
import { SubtitleDialog } from '../dialogs/SubtitleDialog'
import CropModal from '../CropModal'
import { LABEL_COLORS } from '../../lib/labels'
import { perf } from '../../lib/perfMonitor'
import { totalSegLen } from '../../../../shared/timeline'
import { totalCutLen } from '../../../../shared/silenceCut'
import { voiceRegions } from '../../../../shared/ducking'
import { ACTION_LIST, formatCombo } from '../../../../shared/shortcuts'
import { useDoc } from '../../state/contentContext'
import { useTracksCtx } from '../../state/tracksContext'
import { usePlaybackCtx } from '../../state/playbackContext'
import { useToastCtx } from '../../state/toastContext'
import { useExportCtx } from '../../state/exportContext'
import { useIconsCtx } from '../../state/iconsContext'
import { useDialogs } from '../../state/dialogsContext'

export function AppDialogs(): JSX.Element {
const {
    silenceCut, perfStopped, templatePicker, setTemplatePicker, cropSrc, setShowExportDialog,
    exportStatus, restorePrompt, setRestorePrompt, silenceCuts, findSilences, shortcuts,
    capturingId, setCapturingId, setCropSrc, promptState, setPromptState, confirmState,
    showExportDialog, fpsLabel, srcFpsForExport, exportProject, exportPct, setExportStatus,
    applyProjectData, subtitleOpen, subModel, subtitleState, subMaxChars, setSubMaxChars,
    saveLS, subReplace, setSubReplace, runSubtitles, setSubtitleOpen, pickTemplate,
    silenceOpen, setSilenceCut, applySilenceCut, setSilenceOpen, duckOpen, duckOpts,
    setDuckOpts, duckEnv, setDuckOpen, seRefCb, prefsOpen, resetShortcuts,
    setPrefsOpen, setIconForColor, setIconForLane, perfOpen, setPerfOpen, setPerfStopped,
    toasts, closeConfirm
    , iconAssign, laneIconAssign, iconLibrary
  } = useDialogs()
  const { cues, segments, seClips } = useDoc()
  const { tracks } = useTracksCtx()
  const { currentTime } = usePlaybackCtx()
  const { showToast } = useToastCtx()
  const {
    exportOpts, exportDir, setExportDir, exportName, setExportName, exportExt, setExportExt
  } = useExportCtx()
  const { iconSettingsOpen, setIconSettingsOpen } = useIconsCtx()
  return (
    <>
  {/* ===== 書き出し中オーバーレイ ===== */}
  {/* 出入りのダイアログは components/dialogs/ProjectDialogs.tsx */}
  {showExportDialog && (
    <ExportSettingsDialog
      opts={exportOpts}
      sourceFpsLabel={fpsLabel(srcFpsForExport())}
      dir={exportDir}
      name={exportName}
      ext={exportExt}
      onName={setExportName}
      onExt={setExportExt}
      onPickDir={() => {
        void window.giftcut.chooseExportDir(exportDir || undefined).then((r) => {
          if (r?.path) setExportDir(r.path)
        })
      }}
      onExport={() => {
        setShowExportDialog(false)
        void exportProject()
      }}
      onClose={() => setShowExportDialog(false)}
    />
  )}
  {exportStatus && (
    <ExportProgressBox
      status={exportStatus}
      percent={exportPct}
      onCancel={() => {
        setExportStatus('キャンセル中…')
        void window.giftcut.cancelExport()
      }}
    />
  )}
  {restorePrompt && (
    <RestorePrompt
      state={restorePrompt}
      onDiscard={() => {
        void window.giftcut.autosaveClear()
        setRestorePrompt(null)
      }}
      onRestore={(data, videoExists) => {
        setRestorePrompt(null)
        void applyProjectData(data, videoExists, null)
      }}
    />
  )}
  {subtitleOpen && (
    <SubtitleDialog
      model={subModel}
      state={subtitleState}
      maxChars={subMaxChars}
      onMaxChars={(n) => {
        setSubMaxChars(n)
        saveLS('giftcut.subMaxChars', n)
      }}
      replace={subReplace}
      onReplace={setSubReplace}
      hasTelops={cues.length > 0}
      onRun={() => void runSubtitles()}
      onCancel={() => void window.giftcut?.cancelSubtitles?.()}
      onClose={() => setSubtitleOpen(false)}
    />
  )}

  {templatePicker && (
    <TemplatePicker
      items={templatePicker.items}
      startup={templatePicker.startup}
      onPick={(path) => void pickTemplate(path)}
      onDelete={(t) => {
        void window.giftcut?.deleteTemplate?.(t.path).then(async (r) => {
          if (!r?.ok) {
            showToast(`消せませんでした。\n${r?.error ?? ''}`)
            return
          }
          // 消したあとの一覧を出し直す。**残ったままだと消えたのか分からない**
          const next = await window.giftcut.listTemplates()
          const items = next?.ok ? next.items : []
          if (items.length) setTemplatePicker((prev: any) => (prev ? { ...prev, items } : prev))
          else setTemplatePicker(null) // 空になったら閉じる（何も無い箱を見せない）
          showToast(`「${t.name}」を消しました。`)
        })
      }}
      onOpenFolder={() => {
        void window.giftcut?.openFolder?.('template').then((r) => {
          if (!r?.ok) showToast(`フォルダを開けませんでした。\n${r?.error ?? ''}`)
        })
      }}
      onClose={() => setTemplatePicker(null)}
    />
  )}

  {/* 音まわりのダイアログは components/dialogs/AudioDialogs.tsx */}
  {silenceOpen && (
    <SilenceCutDialog
      state={silenceCut}
      onChange={(patch) => setSilenceCut((st: any) => ({ ...st, ...patch }))}
      cuts={silenceCuts}
      totalSec={totalCutLen(silenceCuts)}
      onFind={() => void findSilences()}
      onApply={applySilenceCut}
      onClose={() => setSilenceOpen(false)}
    />
  )}
  {duckOpen && (
    <DuckingDialog
      opts={duckOpts}
      onChange={(patch) => setDuckOpts((d: any) => ({ ...d, ...patch }))}
      busy={silenceCut.busy}
      found={!!silenceCut.found}
      voiceCount={
        silenceCut.found ? voiceRegions(silenceCut.found, totalSegLen(segments)).length : 0
      }
      hasEnvelope={duckEnv.length > 0}
      onFind={() => void findSilences()}
      onClose={() => setDuckOpen(false)}
    />
  )}

  {/* SE 再生用の隠し audio 要素。全クリップぶん常設すると Chromium のメディア要素上限に
      触れて新しい要素が読み込めず無音になるため、再生ヘッド近傍だけをマウントする。
      後ろ側（1秒）に余裕を持たせて、区間を出た瞬間に音がぶつ切りになるのを防ぐ。 */}
  {seClips
    .filter(
      (clip) =>
        currentTime >= clip.tStart - 3 && currentTime < clip.tStart + clip.duration + 1
    )
    .map((clip) => (
      <audio key={clip.id} src={toGcUrl(clip.path)} preload="auto" ref={seRefCb(clip.id)} />
    ))}

  {/* 設定のダイアログは components/dialogs/SettingsDialogs.tsx */}
  {prefsOpen && (
    <ShortcutSettings
      actions={ACTION_LIST}
      groups={['ファイル', 'ツール', '再生', '編集']}
      shortcuts={shortcuts}
      capturingId={capturingId}
      onCapture={setCapturingId}
      onReset={resetShortcuts}
      onClose={() => {
        setPrefsOpen(false)
        setCapturingId(null)
      }}
      formatCombo={formatCombo}
    />
  )}
  {iconSettingsOpen &&
    (() => {
      // 使用中の色だけ出す（全色ズラッと並べない）。
      // 割当済みの色は使っていなくても出す＝解除できるように。
      const usedLabels = new Set(cues.map((c) => c.label))
      return (
        <IconAssignSettings
          library={iconLibrary}
          colorRows={LABEL_COLORS.filter(
            (l) => usedLabels.has(l.color) || iconAssign[l.color]
          )}
          laneRows={tracks
            .filter((t) => t.kind === 'video' && t.id !== 'V1')
            .map((t) => ({
              id: t.id,
              label: t.id === 'V2' ? 'V2 テロップ' : t.name || t.id
            }))}
          colorAssign={iconAssign}
          laneAssign={laneIconAssign}
          onAssignColor={setIconForColor}
          onAssignLane={setIconForLane}
          hasTelop={cues.length > 0}
          onClose={() => setIconSettingsOpen(false)}
        />
      )
    })()}

  {/* ===== アイコン画像のクロップ（ライブラリ追加時）===== */}
  {cropSrc && (
    <CropModal
      src={cropSrc.src}
      ringColor="#8fa8c0"
      onCancel={() => setCropSrc(null)}
      onConfirm={(image) => {
        cropSrc.onDone(image)
        setCropSrc(null)
      }}
    />
  )}

  {/* 動きの計測（Ctrl+Shift+P）。**配布ビルドでも出る**。
      カクついた瞬間の数字が見えないと、何が詰まったのか分からない。 */}
  {perfOpen && (
    <Suspense fallback={null}>
      <PerfHud onClose={() => { perf.stop(); setPerfOpen(false) }} />
    </Suspense>
  )}
  {/* 開発中だけ出る「測定停止」。
      ※ここには検査票（動作確認チェックリスト）を置いていたが、使われないまま
      場所を取っていたので入れ替えた。開発中は起動と同時にずっと測っているので、
      **止めたい時に押す**のがここ。直したら再起動＝また自動で測り始める。
      見た目もここに書く（styles.css に置くと配布ビルドに残るため）。 */}
  {import.meta.env.DEV && (
    <button
      onClick={() => {
        perf.stop()
        void window.giftcut?.savePerfReport?.(perf.report()).then((r) => {
          showToast(r?.ok ? `測定を止めました。記録: ${r.path}` : '記録を書けませんでした')
        })
        setPerfStopped(true)
      }}
      disabled={perfStopped}
      title="ここまでの記録を書き出して測定を止めます（再起動でまた測り始めます）"
      style={{
        position: 'fixed',
        right: 12,
        bottom: 12,
        zIndex: 8000,
        background: '#1b2027',
        color: perfStopped ? '#6b7280' : '#e0a94a',
        border: '1px solid #3a3320',
        borderRadius: 999,
        padding: '6px 14px',
        fontSize: 12,
        letterSpacing: '0.06em',
        cursor: perfStopped ? 'default' : 'pointer',
        opacity: 0.72
      }}
    >
      {perfStopped ? '測定を止めました' : '測定停止'}
    </button>
  )}

  {/* 重ねて出す小物（お知らせ・文字入力・確認）は components/Overlays.tsx。
      形だけの部品なので、状態はここ（App）が持ったまま渡す。 */}
  <Toasts items={toasts} />
  {promptState && (
    <PromptModal
      state={promptState}
      onChange={(v) => setPromptState((st: any) => (st ? { ...st, value: v } : st))}
      onClose={() => setPromptState(null)}
    />
  )}
  {confirmState && <ConfirmModal state={confirmState} onClose={closeConfirm} />}
    </>
  )
}
