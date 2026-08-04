// 左パネル（プロパティ／モーション）。
//
// ## 何をしている所か
//
// 選んでいる物の設定を出す。テロップなら文字と見た目、動画の切片なら
// 速さや色、画像や映像クリップなら大きさと位置。タブでモーション（動き）に
// 切り替えると、同じ相手に対して印（キーフレーム）を置ける。
//
// ## なぜ App.tsx から出したか
//
// **1ファイル14,000行の中にあると、ここを直すのに全部を読むことになる。**
// 切り出す前に「渡す物」を数えたら73個あり、そのままでは受け渡しの方が
// 読みにくくなるので、先に心臓（state/）を作って**区画が自分で見に行く**形にした。
// その結果、渡す物は24個まで減っている。
//
// 残りの24個も、いずれ心臓へ移せる物が多い（再生の時刻、テンプレート、
// 枠の操作）。移した分だけ、ここの受け取りは短くなる。

import StylePanel from './StylePanel'
import { PropertiesPanel, RESET_TRANSFORM } from './panels/PropertiesPanel'
import { MotionPanel } from './MotionPanel'
import type { Adjust, Crop } from './panels/PropertyRows'
import type { MotionRow } from './panels/MotionTab'
import { useLayout } from '../state/layoutContext'
import { useLeftPanel } from '../state/leftPanelContext'
import { useSel } from '../state/selectionContext'
import { useDoc } from '../state/contentContext'
import { useIconsCtx } from '../state/iconsContext'
import { useEdit } from '../state/useEdit'
import type { Cue } from '../lib/srt'
import type { ReframeTarget } from '../lib/projectTypes'
import type { ClipMotion } from '../../../shared/clipMotion'
import type { Keys } from '../../../shared/keyframes'
import { segSpeed, segTLen, vcLen } from '../../../shared/timeline'
import { formatTime } from '../lib/srt'
import {
  DEFAULT_ADJUST,
  DEFAULT_CROP,
  DEFAULT_ZOOM,
  isNeutralAdjust,
  isNeutralCrop
} from '../lib/clipLook'
import type { TelopStyle } from '../lib/telopStyle'
import type { TelopTemplate } from '../lib/telopTemplates'

export interface LeftPanelProps {
  /** 文字を枠のどこへ寄せるか */
  alignTelop: (hx: 'l' | 'c' | 'r', vy: 't' | 'm' | 'b') => void
  /** 見本のスタイルを当てる（文字を選んでいればその範囲だけ） */
  applyTemplate: (tpl: TelopStyle) => void
  /** アイコンの位置を全テロップで揃えるかを切り替える */
  changeIconAuto: (on: boolean) => void
  clearClipMotions: () => void
  /** いまの再生位置（秒） */
  currentTime: number
  /** モーションで選んでいる項目（描き直しを待たずに読むので ref） */
  motionSelRef: React.MutableRefObject<string[]>
  /** いま出ているモーションの行（コピーが印の無い項目も写せるように） */
  motionRowsRef: React.MutableRefObject<MotionRow[]>
  nudgeClips: (
    from: { kind: 'video' | 'img' | 'vclip'; id: number },
    key: keyof ClipMotion,
    delta: number
  ) => void
  /** その映像トラックと対になる音声トラック */
  pairedAudioOf: (vTrack: string) => string
  /** そのテロップの見た目（部分装飾を重ねた実効スタイル） */
  panelStyleFor: (cue: Cue | null | undefined) => TelopStyle
  /** プレビューの枠で今つまんでいる相手 */
  reframeTarget: ReframeTarget | null
  resetClipChannel: (key: keyof ClipMotion) => void
  /** 元に戻せる項目がいくつあるか（「リセット」の出し分けに使う） */
  resetCount: () => number
  savePreset: (name: string) => void
  seekTo: (t: number) => void
  /** 文字の入る枠の基準点を決める */
  setBoxAnchor: (hx: 'l' | 'c' | 'r', vy: 't' | 'm' | 'b', retried?: boolean) => void
  setPersonIconForSelected: (on: boolean) => void
  setSelectedSegSpeed: (speed: number) => void
  /** 印を置く／外す（置いていなければ今の値で1つ置く） */
  toggleKeys: (
    label: string,
    cur: Keys | undefined,
    initial: number,
    at: number,
    patch: (fn: (keys: Keys | undefined) => Keys | undefined) => void
  ) => void
  updateSelectedStyle: (style: TelopStyle) => void
  updateSelectedText: (text: string) => void
  userTemplates: TelopTemplate[]
  // ※ duration と vcLen は消した。**渡されていたが分割代入に入っておらず、
  //    誰も読んでいなかった**（このフックの消費者は LeftPanel 1つだけ）。
  //    しかも vcLen は 595行のローカル const に名前を奪われていた
  /** そのテロップに出すアイコン画像（割り当ての優先順位を当てはめた結果） */
  iconForCue: (c: Cue) => string | undefined
}

export function LeftPanel(): React.JSX.Element {
  // **受け取らず、心臓から自分で見に行く**（state/leftPanelContext.tsx）。
  // 右パネル・プレビュー・タイムラインと同じ流儀に揃えてある。
  const {
    alignTelop,
    applyTemplate,
    changeIconAuto,
    pairedAudioOf,
    panelStyleFor,
    savePreset,
    setBoxAnchor,
    setPersonIconForSelected,
    setSelectedSegSpeed,
    updateSelectedStyle,
    updateSelectedText,
    userTemplates,    iconForCue
  } = useLeftPanel()

  // **区画は props で受け取らず、心臓から自分で見に行く**（state/layoutContext.tsx）。
  // 渡す形にすると、区画を切り出すたびに受け渡しが増えて、
  // App が小さくなっても全体は読みにくくなる（試算で73個だった）。
  const { leftW, leftTab, setLeftTab } = useLayout()
  const { selectedIds, selectedSeIds, selectedImgIds, selectedVClipIds, selectedVideoIds, selectedAudioIds } = useSel()
  const { segments, seClips, imgClips, vClips } = useDoc()
  const { iconSide, setIconSide, iconOffset, setIconOffset, iconScale, setIconScale, iconAuto, setIconSettingsOpen } = useIconsCtx()
  const { updateSelectedImg, updateSelectedSE, updateSelectedVClip, setSelectedAdjust, setSelectedCrop, setImgZoom, setVClipZoom, rotateSelectedSeg, flipSelectedSeg, toggleMuteSelectedSegments, setSelectedAudio, clearBox, selected } = useEdit()

  return (
    // data-editor-safe: ここを押してもテロップの打ち直しは閉じない。
    // **左パネルは「選んだ文字だけ色を変える」の行き先**なので、押した瞬間に
    // 閉じると、変えたかった選択そのものが消える（決まりは useDismissOnOutside）
    <section className="panel" data-editor-safe="" style={{ width: leftW, flex: '0 0 auto' }}>
      <div className="panel-tabs">
        <span
          className={`tab ${leftTab === 'props' ? 'tab-on' : ''}`}
          onClick={() => setLeftTab('props')}
        >
          プロパティ
        </span>
        {/* プレミアと同じで、動きは別のタブにまとめる。
            プロパティ（見た目の設定）と混ぜると、どちらも探しにくくなる。 */}
        <span
          className={`tab ${leftTab === 'motion' ? 'tab-on' : ''}`}
          onClick={() => setLeftTab('motion')}
        >
          モーション
        </span>
      </div>
      {leftTab === 'motion' ? (
        <MotionPanel />
      ) : (
        (() => {
        const se = selectedSeIds.length
          ? seClips.find((c) => c.id === selectedSeIds[0])
          : undefined
        const vseg = selectedVideoIds.length
          ? segments.find((s) => s.id === selectedVideoIds[0])
          : undefined
        const aseg = selectedAudioIds.length
          ? segments.find((s) => s.id === selectedAudioIds[0])
          : undefined
        const vc = selectedVClipIds.length
          ? vClips.find((c) => c.id === selectedVClipIds[0])
          : undefined
        const im = selectedImgIds.length
          ? imgClips.find((c) => c.id === selectedImgIds[0])
          : undefined
        // **名前を変えてある。** 前はローカル定数を `vcLen` と呼んでいて、
        // 正典（shared/timeline の vcLen）の名前を奪い、生の式で影を作っていた
        const vcSec = vc ? vcLen(vc) : 0
        return (
          <PropertiesPanel
            multiCount={selectedIds.length}
            telop={
              selected
                ? {
                    text: selected.text,
                    onText: updateSelectedText,
                    stylePanel: (
                      <StylePanel
                        style={panelStyleFor(selected)}
                        onChange={updateSelectedStyle}
                        presets={userTemplates}
                        onSavePreset={savePreset}
                        onApplyPreset={applyTemplate}
                        label={selected.label}
                        iconOn={iconForCue(selected) !== undefined}
                        onToggleIcon={setPersonIconForSelected}
                        currentIconImage={iconForCue(selected)}
                        onOpenIconSettings={() => setIconSettingsOpen(true)}
                        iconScale={iconScale}
                        onIconScaleChange={setIconScale}
                        iconAuto={iconAuto}
                        onIconAutoChange={changeIconAuto}
                        iconSide={iconSide}
                        onIconSideChange={setIconSide}
                        iconOffset={iconOffset}
                        onIconOffsetChange={setIconOffset}
                        onAlign={alignTelop}
                        onBoxAnchor={setBoxAnchor}
                        onClearBox={clearBox}
                      />
                    )
                  }
                : null
            }
            se={
              !selected && se
                ? {
                    name: se.name,
                    isSe: se.track === 'A2',
                    volume: se.volume,
                    fadeIn: se.fadeIn,
                    fadeOut: se.fadeOut,
                    duration: se.duration,
                    others: selectedSeIds.length - 1,
                    onChange: updateSelectedSE
                  }
                : null
            }
            videoSeg={
              !selected && !se && selectedVideoIds.length
                ? {
                    count: selectedVideoIds.length,
                    speed: vseg ? segSpeed(vseg) : 1,
                    speeds: [0.5, 0.75, 1, 1.25, 1.5, 2],
                    adjust: vseg?.adjust ?? DEFAULT_ADJUST,
                    crop: vseg?.crop ?? DEFAULT_CROP,
                    rotate: vseg?.rotate,
                    flipH: vseg?.flipH,
                    flipV: vseg?.flipV,
                    onSpeed: setSelectedSegSpeed,
                    onAdjust: (next) => setSelectedAdjust(next),
                    onCrop: (next) => setSelectedCrop(next),
                    onRotate: rotateSelectedSeg,
                    onFlip: flipSelectedSeg
                  }
                : null
            }
            audioSeg={
              !selected && !se && !selectedVideoIds.length && selectedAudioIds.length
                ? {
                    count: selectedAudioIds.length,
                    vol: aseg?.vol ?? 1,
                    fadeIn: aseg?.afadeIn ?? 0,
                    fadeOut: aseg?.afadeOut ?? 0,
                    length: aseg ? segTLen(aseg) : 1,
                    muted: !!aseg?.muted,
                    onChange: setSelectedAudio,
                    onToggleMute: toggleMuteSelectedSegments
                  }
                : null
            }
            vclip={
              !selected &&
              !se &&
              !selectedVideoIds.length &&
              !selectedAudioIds.length &&
              vc
                ? {
                    clip: {
                      name: vc.name,
                      zoom: vc.zoom ?? DEFAULT_ZOOM,
                      opacity: vc.opacity ?? 1,
                      rotate: vc.rotate,
                      flipH: vc.flipH,
                      flipV: vc.flipV,
                      adjust: vc.adjust ?? DEFAULT_ADJUST,
                      crop: vc.crop ?? DEFAULT_CROP
                    },
                    track: vc.track,
                    pairedAudio: pairedAudioOf(vc.track),
                    lengthLabel: formatTime(vcSec),
                    length: vcSec,
                    others: selectedVClipIds.length - 1,
                    vol: vc.vol ?? 1,
                    fadeIn: vc.afadeIn ?? 0,
                    fadeOut: vc.afadeOut ?? 0,
                    muted: !!vc.muted,
                    onZoomScale: (scale) =>
                      setVClipZoom(vc.id, { ...(vc.zoom ?? DEFAULT_ZOOM), scale }),
                    onChange: (patch) => {
                      // 何も足していない状態（無調整）は保存に残さない
                      const p = { ...patch } as Record<string, unknown>
                      if ('adjust' in p) {
                        const a = p.adjust as Adjust
                        p.adjust = isNeutralAdjust(a) ? undefined : a
                      }
                      if ('crop' in p) {
                        const c = p.crop as Crop
                        p.crop = isNeutralCrop(c) ? undefined : c
                      }
                      updateSelectedVClip(p)
                    },
                    onReset: () => updateSelectedVClip(RESET_TRANSFORM)
                  }
                : null
            }
            image={
              !selected &&
              !se &&
              !selectedVideoIds.length &&
              !selectedAudioIds.length &&
              !vc &&
              im
                ? {
                    clip: {
                      name: im.name,
                      zoom: im.zoom ?? DEFAULT_ZOOM,
                      opacity: im.opacity ?? 1,
                      rotate: im.rotate,
                      flipH: im.flipH,
                      flipV: im.flipV,
                      adjust: im.adjust ?? DEFAULT_ADJUST,
                      crop: im.crop ?? DEFAULT_CROP
                    },
                    duration: im.duration,
                    others: selectedImgIds.length - 1,
                    onZoomScale: (scale) =>
                      setImgZoom(im.id, { ...(im.zoom ?? DEFAULT_ZOOM), scale }),
                    onChange: (patch) => {
                      const p = { ...patch } as Record<string, unknown>
                      if ('adjust' in p) {
                        const a = p.adjust as Adjust
                        p.adjust = isNeutralAdjust(a) ? undefined : a
                      }
                      if ('crop' in p) {
                        const c = p.crop as Crop
                        p.crop = isNeutralCrop(c) ? undefined : c
                      }
                      updateSelectedImg(p)
                    },
                    onReset: () => updateSelectedImg(RESET_TRANSFORM)
                  }
                : null
            }
          />
        )
      })()
      )}
    </section>
  )
}
