// プレビューの区画。映像・重ねる物・全体バー・操作バーを並べる。
//
// ## <video> は常に2本ある
//
// 切片の境目で毎回シークすると数百ms 止まるので、裏でもう1本を次の位置へ
// 合わせておき、境目では表示を入れ替える（A面/B面）。**ミキサーを見ている間も
// 捨てずに隠すだけ**にするのは、捨てると再生が止まるため。
//
// ## 映像の上に重なる物は3層
//
//   映像そのもの（回転・拡大・演出を合成した CSS を当てる）
//   重ねた動画・画像（components/panels/PreviewLayers）
//   テロップと、掴むための枠（components/panels/PreviewOverlays）
//
// ## 枠の外を押したら選択を外す
//
// 押した先が枠そのもの（余白）なら、選んでいる物を全部落として枠も閉じる。
// これが無いと、選択が残ったまま Delete が効いて別の物が消える。
//
// ## 渡す物が少ないのは心臓に載せてあるから
//
// プレビュー固有の物は state/previewContext。**props で配ると100個を超える。**

import { useState, type JSX } from 'react'
import { PanelTabs } from '../PanelChrome'
import { AudioMixer, PreviewScrub, TransportBar } from './PreviewBars'
import { ImageLayers, TelopLayer, VideoLayers } from './PreviewLayers'
import {
  ProgressBadges,
  ReframeBox,
  ScreenEmpty,
  TelopBar,
  TelopEditor,
  ZoomAnchor
} from './PreviewOverlays'
import { formatTimecode } from '../../../../shared/timeline'
import { formatCombo } from '../../../../shared/shortcuts'
import { newTrackState } from '../../lib/trackState'
import { clamp, tToSource } from '../../../../shared/timeline'
import { useDoc } from '../../state/contentContext'
import { useSel } from '../../state/selectionContext'
import { useTracksCtx } from '../../state/tracksContext'
import { useMediaCtx } from '../../state/mediaContext'
import { usePlaybackCtx } from '../../state/playbackContext'
import { useExportCtx } from '../../state/exportContext'
import { useIconsCtx } from '../../state/iconsContext'
import { useToastCtx } from '../../state/toastContext'
import { usePreviewCtx } from '../../state/previewContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface PreviewAreaProps {
  [k: string]: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function PreviewArea(): JSX.Element {
  // **受け取らず、心臓から自分で見に行く**（他の区画と同じ流儀）
  const {
    orderedTabs, TAB_DEFS, monitorTab, pickTab, setTabMenu, setTabOverflow, setTabOrder, shortcuts, cueTrack, srcOfSeg, loadVideo, updateSource, segLayoutRef, segsRef, segIdCounter, suppressHistoryRef, initializedForPathRef, stopPlayback, clearSegSel, toggleTrack, duration, draggingMediaRef,
    screenRef, videoRef, videoBRef, videoElsRef, elKey, activeHalf, effActiveSrcId,
    previewSources, previewUrl, monitorAspect, xfPreview, xfBStyle, xfNextBUrl,
    xfDipOverlay, transOverlay, videoMainStyle, curAdjustCss, curBlank, v1Hidden,
    videoTLen, activeCues, windowVClips, vcRefCb, clipXform, vcLen, iconForCue,
    proxyPct, packPct, onVideoReframeStart, onVideoRotateStart, resetVideoZoom,
    zoomAnchor, toggleZoomAnchor, onZoomAnchorStart,
    resetSelectedTelops, telopResetCount,
    resetCount, selectPreviewOverlay, reframeTarget, onTelopPointerDown,
    onTelopResizeStart, editorTextRef, updateCueText, setEditorSel, clearRunsInSelection,
    draggingTemplateRef, draggingIconRef, applyTemplateToCue, applyIconToCue,
    togglePlay, skipSec, stepFrame, jumpMarker, addMarkerAtPlayhead, captureScreenshot,
    seekAndReveal, handleVideoEnded, startFader, setTrackVolume, setMasterVolume,
    transportInfo
  } = usePreviewCtx()
  const { cues, setSegments } = useDoc()
  const {
    selectedIds, setSelectedIds, setEditingId, editingId, setVideoSelected, videoSelected,
    selectedVideoIds, selectedImgIds, selectedVClipIds
  } = useSel()
  const { tracks, trackStates } = useTracksCtx()
  const { videoSrc, videoPath, setVideoDuration } = useMediaCtx()
  const { currentTime, playing, playRateRef, currentTimeRef, fps } = usePlaybackCtx()
  const { ratio, masterVolume } = useExportCtx()
  const { iconAuto, iconOffset, iconScale, iconSide } = useIconsCtx()
  const { showToast } = useToastCtx()
  /**
   * プレビューだけの拡大（1＝全体表示）。
   *
   * **プロジェクトには入れない。** 見るためだけの物で、書き出しにも保存にも
   * 関わらない（クリップの拡大＝リフレームとは別物。あちらは絵が変わる）。
   * 覚えさせないのは、開き直したときに「なぜか寄っている」状態から始まらないため。
   */
  const [previewZoom, setPreviewZoom] = useState(1)
  return (
      <section
        className="panel monitor"
        style={{ flex: '1 1 0', minWidth: 0 }}
      >
        <PanelTabs
          group="monitor"
          tabs={orderedTabs('monitor', TAB_DEFS.monitor)}
          active={monitorTab}
          onPick={(id) => pickTab('monitor', id)}
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
          onReorder={(ids) => setTabOrder((prev: Record<string, string[]>) => ({ ...prev, monitor: ids }))}
          right={
            <>
              {/* **プレビューの拡大。** 細かい所（縁の太さ・アイコンの縁）を見るための物で、
                  書き出しには一切関わらない。等倍のときは何も足さない（＝いままでどおり）。
                  枠ごと大きくするので、はみ出した分はモニタ区画を送って見る。 */}
              <span className="pz-group" title="プレビューの拡大（書き出しには影響しません）">
                <button className="chip" onClick={() => setPreviewZoom((z) => Math.max(1, z / 1.5))}>
                  −
                </button>
                <button
                  className="chip"
                  title="全体表示に戻す"
                  onClick={() => setPreviewZoom(1)}
                >
                  {Math.round(previewZoom * 100)}%
                </button>
                <button className="chip" onClick={() => setPreviewZoom((z) => Math.min(8, z * 1.5))}>
                  ＋
                </button>
              </span>
              {transportInfo}
            </>
          }
        />
        {/* ミキサー表示中も video は破棄せず隠すだけ（再生を止めないため） */}
        <div
          className="monitor-stage"
          style={{ display: monitorTab === 'program' ? 'flex' : 'none' }}
          onPointerDown={(e) => {
            // 画面（フレーム）の外＝モニターの余白をクリックしたら選択解除・枠を閉じる
            if (e.target === e.currentTarget) {
              setVideoSelected(false)
              clearSegSel()
              setSelectedIds([])
              setEditingId(null)
            }
          }}
        >
          <div
            ref={screenRef}
            className="screen"
            // `--ar` は縦横比を**数**で渡す物。CSS 側で「幅いっぱいに収まる高さ」を
            // 出すのに要る（`aspect-ratio` の文字列では割り算できない）。styles.css の .screen を見ること
            style={
              {
                aspectRatio: monitorAspect,
                '--ar': String(
                  Number(monitorAspect.split('/')[0]) / Number(monitorAspect.split('/')[1])
                ),
                // プレビューだけの拡大。1 のときは何も足さない（＝いままでどおりの大きさ）
                '--pz': String(previewZoom)
              } as React.CSSProperties
            }
            onPointerDown={(e) => {
              // プレビューの空きエリア（テロップ以外）をクリック＝テロップ選択解除＋動画リフレーム。
              // テロップ本体/リサイズハンドル/編集エディタは stopPropagation 済みでここへ来ない。
              if (e.button !== 0) return
              setSelectedIds([])
              setEditingId(null)
              if (videoSrc) {
                setVideoSelected(true)
                onVideoReframeStart(e, null) // 本体ドラッグ＝パン（クリックだけなら動かない）
              }
            }}
            // ホイールでの拡大縮小は付けない。枠が出ているだけで意図せず映像が
            // 拡大され、元に戻すのが手間になるため（拡大はスライダーと四隅のドラッグで行う）。
            onDragOver={(e) => {
              if (draggingMediaRef.current?.kind === 'video') e.preventDefault()
            }}
            onDrop={(e) => {
              const m = draggingMediaRef.current
              // 動画以外はここでは受け取らない。preventDefault を先に呼ぶと
              // 「処理済み」と見なされ、画像や音声を落としたときに何も起きず消える。
              if (m?.kind !== 'video') return
              e.preventDefault()
              if (!videoPath) void loadVideo(m.path)
              else showToast('タイムラインへドロップすると、その位置に配置できます。')
            }}
          >
            {/* 元動画ごとに <video> を常設し、切替は「表示の切替」だけで行う。
                src を差し替えると要素が一度アンロードされて背景が透ける＝ちらつきの原因になるため。

                さらに**1本につき2つ（A面/B面）**持つ。片方を映している間に
                もう片方を次のカットの頭へ送っておき、カットで表示を入れ替える。
                カットのたびに飛んで待たされる（実測145〜235ms）のを、
                再生の裏に隠す＝プレミアのプリロールと同じ考え方。 */}
            {previewSources.flatMap((s: any) =>
              ([0, 1] as const).map((half) => {
              const isActive = s.id === effActiveSrcId && half === (activeHalf[s.id] ?? 0)
              return (
                <video
                  key={`${s.id}:${half}`}
                  ref={(el) => {
                    if (el) {
                      videoElsRef.current.set(elKey(s.id, half), el)
                      if (isActive) videoRef.current = el
                    } else videoElsRef.current.delete(elKey(s.id, half))
                  }}
                  className="screen-video"
                  style={{
                    opacity:
                      !isActive ||
                      v1Hidden ||
                      curBlank ||
                      (videoTLen > 0 && currentTime >= videoTLen - 1e-3)
                        ? 0
                        : 1,
                    // 非表示のソースはクリック等を拾わない
                    pointerEvents: isActive ? undefined : 'none',
                    // **見た目の指定は、映していない面にも同じものを当てておく。**
                    // 入れ替えた瞬間に filter や transform が付くと、その面の
                    // 描き方（合成の経路）が切り替わり、そこで待ちが出る。
                    // 先に当てておけば、入れ替えで変わるのは透明度だけになる。
                    filter: curAdjustCss,
                    ...videoMainStyle
                  }}
                  src={previewUrl(s.path, s.origUrl)}
                  preload="auto"
                  // **どの面も muted にしない。**
                  // 音のある動画はメディア時計が音声側に従うため、muted を
                  // 切り替えると時計が張り替わり、絵まで250ms止まる（カットのたびに発生）。
                  // 裏の面は音量0で黙らせている（上の音量 effect と入れ替えの所）。
                  muted={false}
                  onLoadedMetadata={(e) => {
                    const d = e.currentTarget.duration || 0
                    if (s.id >= 0) updateSource(s.id, { duration: d })
                    if (!isActive) return
                    setVideoDuration(d)
                    // 初期切片は「この動画で初回だけ」作る（プロキシ差し替えの再発火では作らない）
                    if (
                      segsRef.current.length === 0 &&
                      d > 0 &&
                      initializedForPathRef.current !== s.path
                    ) {
                      initializedForPathRef.current = s.path
                      suppressHistoryRef.current = true // 初期切片は履歴化しない
                      setSegments([{ id: segIdCounter.current++, srcStart: 0, srcEnd: d }])
                    }
                  }}
                  onLoadedData={(e) => {
                    // ロード直後、停止中なら現在位置（自ソースぶん）へシークして正しいフレームを出す
                    const v = e.currentTarget
                    if (playRateRef.current > 0) return
                    if (isActive) {
                      const src = tToSource(segLayoutRef.current, currentTimeRef.current)
                      if (src) v.currentTime = src.srcTime
                    } else {
                      // 待機中のソースは自分の最初の出番の頭に置いておく
                      const first = segLayoutRef.current.find((l: any) => srcOfSeg(l.seg)?.id === s.id)
                      if (first) v.currentTime = first.seg.srcStart
                    }
                  }}
                  onEnded={isActive ? handleVideoEnded : undefined}
                  onError={() => {
                    if (isActive) stopPlayback()
                  }}
                />
              )
              })
            )}
            {videoSrc && (
              // クロスディゾルブ用の2本目video。区間外は透明＆pause（駆動は専用effect）
              // マルチソース: B側切片のソースURLを使う（別ソース間の境界でも正しい相手が映る）
              <video
                ref={videoBRef}
                className="screen-video screen-video-b"
                style={
                  xfPreview && !xfPreview.blank && !v1Hidden
                    ? xfBStyle(xfPreview)
                    : { opacity: 0 }
                }
                src={xfPreview?.bUrl ?? xfNextBUrl ?? videoSrc}
                preload="auto"
                muted
              />
            )}
            {xfPreview?.blank && !v1Hidden && (
              <div
                className="trans-overlay"
                style={{ background: '#000', opacity: xfPreview.p }}
              />
            )}
            {xfDipOverlay && !v1Hidden && (
              <div
                className="trans-overlay"
                style={{ background: xfDipOverlay.color, opacity: xfDipOverlay.opacity }}
              />
            )}
            {/* 重なる中身（重ねた動画→画像→テロップ）は
                components/panels/PreviewLayers.tsx。並び順が重なり順になる */}
            <VideoLayers
              clips={windowVClips}
              vcLen={vcLen}
              vcRefCb={vcRefCb}
              clipXform={clipXform}
              previewUrl={previewUrl}
              onSelect={selectPreviewOverlay}
            />
            <ImageLayers clipXform={clipXform} onSelect={selectPreviewOverlay} />
            <TelopLayer
              activeCues={activeCues}
              cueTrack={cueTrack}
              iconForCue={iconForCue}
              iconScale={iconScale}
              iconAuto={iconAuto}
              iconSide={iconSide}
              iconOffset={iconOffset}
              ratio={ratio}
              draggingTemplateRef={draggingTemplateRef}
              draggingIconRef={draggingIconRef}
              applyTemplateToCue={applyTemplateToCue}
              applyIconToCue={applyIconToCue}
              onResizeStart={onTelopResizeStart}
              onPointerDown={onTelopPointerDown}
              onEdit={(c) => {
                stopPlayback()
                setSelectedIds([c.id])
                setEditingId(c.id)
              }}
            />
            {transOverlay && (
              <div
                className="trans-overlay"
                style={{ background: transOverlay.color, opacity: transOverlay.opacity }}
              />
            )}
            {/* 映像に重ねて出る物は components/panels/PreviewOverlays.tsx */}
            {(videoSelected ||
              selectedVideoIds.length > 0 ||
              selectedImgIds.length === 1 ||
              selectedVClipIds.length === 1) &&
              reframeTarget && (
              <ReframeBox
                target={reframeTarget}
                onReframeStart={onVideoReframeStart}
                onRotateStart={onVideoRotateStart}
                onReset={resetVideoZoom}
                resetCount={resetCount()}
                anchorOn={!!zoomAnchor}
                onToggleAnchor={toggleZoomAnchor}
                onDone={() => {
                  setVideoSelected(false)
                  clearSegSel()
                }}
              />
            )}
            {/* 拡大の中心（◎）。枠のバーの「◎ 拡大の中心」で出し入れする。
                枠（z-index 6）より上に置く——下に潜ると掴めない */}
            {zoomAnchor && <ZoomAnchor anchor={zoomAnchor} onDragStart={onZoomAnchorStart} />}
            {/* テロップを選んでいるときのバー。枠と四隅はテロップ側が持っているので、
                ここは戻す口だけを出す（動画側のバーと形を揃えてある） */}
            {selectedIds.length > 0 && !videoSelected && (
              <TelopBar
                count={selectedIds.length}
                onReset={resetSelectedTelops}
                resetCount={telopResetCount()}
                onDone={() => {
                  setSelectedIds([])
                  setEditingId(null)
                }}
              />
            )}
            {!videoSrc && !activeCues.length && <ScreenEmpty />}
            <ProgressBadges proxyPct={proxyPct} packPct={packPct} />
            {editingId != null &&
              activeCues.some((c: { id: number }) => c.id === editingId) && (
                <TelopEditor
                  cue={cues.find((c: any) => c.id === editingId)!}
                  textRef={editorTextRef}
                  onChangeText={updateCueText}
                  onSelChange={setEditorSel}
                  onClearRuns={clearRunsInSelection}
                  onClose={() => setEditingId(null)}
                />
              )}
          </div>
        </div>

        {/* オーディオトラックミキサー（components/panels/PreviewBars.tsx） */}
        {monitorTab === 'mixer' && (
          <AudioMixer
            tracks={tracks
              .filter((t) => t.kind === 'audio')
              .map((tr) => {
                const st = trackStates[tr.id] ?? newTrackState(tr.id)
                return {
                  id: tr.id,
                  name: tr.name,
                  muted: st.muted,
                  solo: st.solo,
                  volume: st.volume ?? 1
                }
              })}
            master={masterVolume}
            onToggleMute={(id) => toggleTrack(id, 'muted')}
            onToggleSolo={(id) => toggleTrack(id, 'solo')}
            onVolume={setTrackVolume}
            onMaster={(v) => setMasterVolume(clamp(v, 0, 1))}
            startFader={startFader}
          />
        )}
        <PreviewScrub
          currentTime={currentTime}
          duration={duration}
          // 飛ばしたら、タイムライン側もその場所を見せる（連動）
          onSeek={seekAndReveal}
          onScrubStart={stopPlayback}
        />
        <TransportBar
          timecode={formatTimecode(currentTime, fps)}
          playing={playing}
          onSkip={skipSec}
          onStep={stepFrame}
          onTogglePlay={togglePlay}
          onScreenshot={() => void captureScreenshot()}
          onJumpMarker={jumpMarker}
          onAddMarker={addMarkerAtPlayhead}
          keyHint={{
            back: formatCombo(shortcuts.frameBack),
            play: formatCombo(shortcuts.playPause),
            fwd: formatCombo(shortcuts.frameFwd),
            marker: formatCombo(shortcuts.addMarker)
          }}
        />
      </section>
  )
}
