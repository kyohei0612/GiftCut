// タイムラインの区画。道具立て・段の見出し・目盛り・帯を並べる。
//
// ## 3層でできている
//
//   道具立て（TimelineToolbar）… 選ぶ・切る・磁石・拡大
//   段の見出し（TrackHeaders）  … 名前・鍵・目/耳・高さの掴み
//   本体（track-inner）         … 目盛り・再生ヘッド・帯
//
// **横位置は「秒 × 拡大率」だけで決まる。** 当たり判定も同じ基準（track-inner）で測る。
//
// ## 縦に送るときは、ついてくる側が3つある
//
// 見出し・掴み手・目盛りは本体と一緒に動かす。基準を変えると掴む位置がずれる。
//
// ## マウスを動かすだけで作り直さない
//
// 止めている間も毎秒80〜194回来る（ゲーミングマウスは秒に何百回も送る）。
// 目盛りの印は秒60回で足りるので、そこで頭打ちにする。
//
// ## 渡す物が少ないのは心臓に載せてあるから
//
// 掴む操作は state/timelineOpsContext、見え方は state/timelineViewContext。
// **props で配ると約130個になる**ので、そちらを見に行く形にしてある。

import type { JSX } from 'react'
import { TimelineToolbar } from './TimelineToolbar'
import { ZoomBar } from './ZoomBar'
import { TrackHeaders } from './TrackHeaders'
import { TimeRuler, Marquee, MarkerFlags, Playhead } from './Ruler'
import { TelopBands, TelopDropGhost } from './TelopBands'
import { MainAudioBands, MainVideoBands } from './MainClipBands'
import { SeBands } from './SeBands'
import { TransitionBands } from './TransitionBands'
import { ImageBand, VideoLayerAudioBand, VideoLayerBand } from './OverlayClipBands'
import {
  ImageGhost,
  SeGhost,
  TransDropGhost,
  VideoAudioGhost,
  VideoGhost
} from './DropGhosts'
import { formatTime } from '../../lib/srt'
import { formatTimecode } from '../../../../shared/timeline'
import { formatCombo } from '../../../../shared/shortcuts'
import { EXTRA_AUDIO_TRACK, newTrackState } from '../../lib/trackState'
import { useDoc } from '../../state/contentContext'
import { useSel } from '../../state/selectionContext'
import { useTracksCtx } from '../../state/tracksContext'
import { useViewCtx } from '../../state/viewContext'
import { ZOOM_MAX, ZOOM_MIN } from '../../state/useView'
import { usePlaybackCtx } from '../../state/playbackContext'
import { useMediaCtx } from '../../state/mediaContext'
import { useLayout } from '../../state/layoutContext'
import { useDragPreviewCtx } from '../../state/dragPreviewContext'
import { useTimelineOps } from '../../state/timelineOpsContext'
import { useTimelineView } from '../../state/timelineViewContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface TimelineAreaProps {
  [k: string]: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function TimelineArea(): JSX.Element {
  const {
    onClipPointerDown, onClipContextMenu, onTrimStart, onSegPointerDown, onSegTrimStart,
    onSePointerDown, onImgPointerDown, onVClipPointerDown, onMarkerPointerDown,
    onTrackAreaPointerDown, startScrub, startGroupResize, startTransResize, openClipMenu,
    updateDropGhost, clearDropGhosts, placeDropped,
    snapClipStart, draggingMediaRef, draggingTransRef,
    draggingTelopAnimRef, dragSeDurRef, resolveTransDrop, applyTransDrop, selectTransition,
    setVideoTransDur, resolveTelopTransDrop, applyTelopTransDrop, selectTelopTrans,
    patchCueAnim, undo, redo, undoStackRef, redoStackRef, isDirty, cutAtPlayhead,
    findSilences, setSilenceOpen, toggleSnap, selectTrack, toggleTrack, addVideoTrack,
    addAudioTrack, addBgm, resetLaneH, setTracks, askText, stopPlayback, seekTo
  } = useTimelineOps()
  const {
    cueTrack, vcLen, mediaMeta, srcOfSeg, pairedAudioOf, trackNum, motionLabel,
    silenceCut, shortcuts, duration,
    tool, setTool, snap, hoverX, setHoverX, lastHoverPaintRef, telopDrop, setTelopDrop,
    transDrop, setTransDrop, segLayout, rulerTicks, padTop, padBottom, trackHOf, inView,
    scrollRef, trackInnerRef, thBodyRef, syncTimelineVScroll,
    fitTimelineZoom
  } = useTimelineView()
  const { markers, setMarkers, vClips, imgClips } = useDoc()
  const {
    selectedTrans, selectedTrackId, selectedMarkerId, setSelectedMarkerId,
     editingMarkerId, setEditingMarkerId
  } = useSel()
  const { tracks, trackStates } = useTracksCtx()
  const { zoom, setZoom, zoomRef } = useViewCtx()
  // **currentTime は受け取らない。** 受けると、再生ヘッドが動くたびに
  // タイムライン全体（帯277個）が描き直される。時刻が要るのは再生ヘッドだけなので、
  // あちらが自分で見に行く（components/timeline/Ruler の Playhead）
  const { fps } = usePlaybackCtx()
  const { videoSrc, mediaItems } = useMediaCtx()
  const { timelineH } = useLayout()
  const { videoGhost, seGhost, imgGhost, marquee, snapLineX, overwriteIds } = useDragPreviewCtx()
  return (
    <section
      className="timeline"
      style={{ height: timelineH, flex: '0 0 auto' }}
    >
      {/* 道具立ては components/timeline/TimelineToolbar.tsx */}
      <TimelineToolbar
        tool={tool}
        onTool={setTool}
        snap={snap}
        onToggleSnap={toggleSnap}
        canUndo={undoStackRef.current.length > 0 || isDirty()}
        canRedo={redoStackRef.current.length > 0}
        onUndo={undo}
        onRedo={redo}
        onSplit={cutAtPlayhead}
        onSilenceCut={() => {
          setSilenceOpen(true)
          if (!silenceCut.found && !silenceCut.busy) void findSilences()
        }}
        onFit={fitTimelineZoom}
        hint={
          tool === 'razor'
            ? 'クリップをクリックで分割'
            : videoGhost?.moving
              ? 'ドラッグで移動 / Alt=複製 / Ctrl=割り込み（後続が後ろへずれる）'
              : videoGhost
                ? 'ドロップで上書き配置 / Ctrl押しながらで挿入（後続がシフト）'
                : `${formatCombo(shortcuts.undo)} 元に戻す / ${formatCombo(shortcuts.copy)}・${formatCombo(shortcuts.paste)} コピー貼付 / ${formatCombo(shortcuts.duplicate)} 複製 / ${formatCombo(shortcuts.split)} 分割 / ${formatCombo(shortcuts.addMarker)} マーカー / ホイール 横・Shift+ホイール 縦`
        }
        keyHint={{
          select: formatCombo(shortcuts.toolSelect),
          razor: formatCombo(shortcuts.toolRazor),
          snap: formatCombo(shortcuts.toggleSnap),
          undo: formatCombo(shortcuts.undo),
          redo: formatCombo(shortcuts.redo),
          split: formatCombo(shortcuts.split)
        }}
      />

      <div className="tl-body">
        {/* 左端のトラック高さ調整バー（丸グリップ2個：映像グループ／音声グループ）*/}
        {/* ※ここに「高さ調整の丸」の列を置いていたが廃止した。
            縦に送ると枠の外へ出て消え、掴んだ丸と実際の境目が離れることもあった。
            いまは段見出しの境目そのものを掴む（プレミアと同じ）。
            境目は見出しと一緒に動くので、見えている段の境目は必ず掴める。 */}

        {/* 段の見出し列は components/timeline/TrackHeaders.tsx */}
        <TrackHeaders
          tracks={tracks}
          stateOf={(id) => trackStates[id] ?? newTrackState(id)}
          selectedId={selectedTrackId}
          heightOf={trackHOf}
          padTop={padTop}
          padBottom={padBottom}
          bgmTrackId={EXTRA_AUDIO_TRACK}
          bodyRef={thBodyRef}
          onResizeStart={startGroupResize}
          onSelect={selectTrack}
          onRename={(id, current) =>
            askText('トラック名を変更', current, (v: string) => {
              const name = v.trim()
              if (!name) return
              // 型は書かない。**手で書いた注釈が実体とズレていた**（`kind` が抜けていて、
              // `{ id, name }` と書き直した瞬間に段の種類が黙って消える形だった）
              setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, name } : t)))
            })
          }
          onToggle={toggleTrack}
          onAddVideoTrack={addVideoTrack}
          onAddAudioTrack={addAudioTrack}
          onAddBgm={() => void addBgm()}
          onResetLaneH={resetLaneH}
        />

        {/* トラック領域 */}
        <div
          className="track-scroll"
          ref={scrollRef}
          // 縦に送ったら、見出し列・グリップ・目盛りに貼り付く物を追従させる。
          // 横に送ったときも呼ばれるが、やることは変わらないので分けない。
          onScroll={syncTimelineVScroll}
          // 範囲選択（マーキー）はレーンの中だけでなく、レーンの外——上下の余白、
          // 最後のレーンより下、素材の終わりより右——からでも始められる。
          // 掴む物の無い所で始めた投げ縄が「ここは対象外です」と無反応になるのは、
          // 使う側からは区別のつかない当たり判定を覚えろと言っているのと同じなので。
          // クリップ・マーカー・ルーラー・再生ヘッドは自分で伝播を止めるため、
          // ここまで上がってくるのは「何も無い所」だけになる。
          onPointerDown={onTrackAreaPointerDown}
          onDragEnter={(e) => {
            // ターゲット要素が切り替わる瞬間も許可し続ける（カット上で駐禁がチラつくのを防ぐ）。
            // 素材のドラッグもここで許可しないと、行と行の境目や余白に入った瞬間に
            // 駐禁マークが出て置けなくなる。
            if (
              draggingTransRef.current ||
              draggingTelopAnimRef.current ||
              draggingMediaRef.current
            ) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDragOver={(e) => {
            if (draggingTransRef.current) {
              e.preventDefault() // 駐禁は出さない（どこでも受け付ける）
              e.dataTransfer.dropEffect = 'copy'
              const r = resolveTransDrop(e.clientX)
              setTransDrop(
                r
                  ? { segId: r.segId, left: r.left, width: r.width, label: r.label, kind: r.kind }
                  : null
              )
              return
            }
            // テロップ用トランジションもタイムライン全体で受け付ける（駐禁チラつき防止）。
            // 実際の頭/間/尻はテロップクリップ側 onDragOver がゴースト表示・確定する。
            if (draggingTelopAnimRef.current) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              return
            }
            const m = draggingMediaRef.current
            if (m?.kind !== 'video' && m?.kind !== 'audio' && m?.kind !== 'image') return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            // 置き先の判定と影づくりはアプリ全体で同じ関数を通す
            // （ここだけ別実装にすると、外へ出た瞬間に行き先が変わって見える）
            updateDropGhost(m, e.clientX, e.clientY, e.ctrlKey, e.target)
          }}
          onDragLeave={(e) => {
            // 素材の影はここでは消さない。外へ出ても「一番近い場所」を
            // 指し続けるほうが、行き先が分からなくならない。
            // 消すのは離した時か、途中でやめた時（onDragEnd）。
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setTransDrop(null)
              setTelopDrop(null)
            }
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (draggingTransRef.current) {
              applyTransDrop(e.clientX)
              setTransDrop(null)
              return
            }
            const m = draggingMediaRef.current
            clearDropGhosts()
            if (!m) return
            const rect = trackInnerRef.current?.getBoundingClientRect()
            const raw = rect ? Math.max(0, (e.clientX - rect.left) / zoomRef.current) : 0
            const yRel = rect ? e.clientY - rect.top : 0
            const t = snapClipStart(raw, dragSeDurRef.current)
            // 置き方は state/useMediaDrop の placeDropped に1つ。
            // **まとめて選んでいれば、その順に続けて並べる**（1つだけなら今までと同じ）。
            // V1 は本編のカット列（通常=上書き / Ctrl=挿入）、V2以降は映像レイヤー、
            // 音は空いている段、画像は埋まっていない段——という振り分けもあちら側。
            void placeDropped(m, t, yRel, { target: e.target, ctrlKey: e.ctrlKey })
          }}
        >
          <div
            className={`track-inner ${tool === 'trackFwd' ? 'cur-track-fwd' : tool === 'trackBack' ? 'cur-track-back' : ''}`}
            ref={trackInnerRef}
            style={{ width: duration * zoom }}
            onPointerMove={(e) => {
              // **マウスを動かすだけで作り直していた。**
              // 実測で、止めている間も毎秒80〜194回。ゲーミングマウスは
              // 秒に何百回も動きを送ってくるので、素で受けると再生していなくても重い。
              // 目盛りの印は秒60回も動けば十分なので、そこで頭打ちにする。
              const now = performance.now()
              if (now - lastHoverPaintRef.current < 16) return
              lastHoverPaintRef.current = now
              const rect = trackInnerRef.current?.getBoundingClientRect()
              if (rect) setHoverX(e.clientX - rect.left)
            }}
            onPointerLeave={() => setHoverX(null)}
          >
            {/* 物差しまわり（目盛り・ホバー線・投げ縄・めじるし・再生ヘッド）は
                components/timeline/Ruler.tsx。どれも「時間×拡大率＝横位置」で置くだけ。 */}
            <TimeRuler
              ticks={rulerTicks}
              hover={hoverX != null ? { x: hoverX, label: formatTime(hoverX / zoom) } : null}
              onScrub={startScrub}
            />
            {/* 磁石が吸い付いた所。**点線**にしてある。
                前は実線のピンクで出していて再生ヘッドと見分けが付かず、
                邪魔なので消していた。ただ消すと今度は「効いているのか
                分からない」になる。掴んでいる間だけ・点線・別の色、で出す。 */}
            {snapLineX != null && <div className="snap-line" style={{ left: snapLineX }} />}
            {marquee && (
              <Marquee x0={marquee.x0} y0={marquee.y0} x1={marquee.x1} y1={marquee.y1} />
            )}
            <MarkerFlags
              markers={markers.filter((mk) => inView(mk.t, mk.t))}
              zoom={zoom}
              selectedId={selectedMarkerId}
              editingId={editingMarkerId}
              timeLabel={(t) => formatTimecode(t, fps)}
              onPointerDown={onMarkerPointerDown}
              onStartRename={(id) => {
                setSelectedMarkerId(id)
                setEditingMarkerId(id)
              }}
              onRename={(id, label) => {
                setMarkers((prev) => prev.map((m) => (m.id === id ? { ...m, label } : m)))
                setEditingMarkerId(null)
              }}
              onCancelRename={() => setEditingMarkerId(null)}
            />

            {/* **時刻はこの部品が自分で見に行く。** ここで受け取ると、
                再生ヘッドが1px動くたびにタイムライン全体が描き直される */}
            <Playhead zoom={zoom} onScrub={startScrub} />

            {/* 上の余白。端に貼り付いていると足す余地が見えず窮屈に感じる */}
            <div className="track-pad" style={{ height: padTop }} />
            {/* 各トラック */}
            {tracks.map((tr) => (
              <div
                key={tr.id}
                data-tid={tr.id}
                className={`track track-${tr.kind}`}
                style={{
                  height: trackHOf(tr.id),
                  cursor:
                    tool === 'razor'
                      ? 'crosshair'
                      : tool === 'trackFwd'
                        ? 'e-resize'
                        : tool === 'trackBack'
                          ? 'w-resize'
                          : 'default'
                }}
              >
                {/* テロップの帯は components/timeline/TelopBands.tsx。
                    本体・打った印・出入りの動きの3つが1本に乗っている */}
                {tr.kind === 'video' && tr.id !== 'V1' && (
                  <TelopBands
                    trackId={tr.id}
                    zoom={zoom}
                    inView={inView}
                    cueTrack={cueTrack}
                    onPointerDown={onClipPointerDown}
                    onContextMenu={onClipContextMenu}
                    onTrimStart={onTrimStart}
                    draggingTelopAnimRef={draggingTelopAnimRef}
                    resolveTelopTransDrop={resolveTelopTransDrop}
                    applyTelopTransDrop={applyTelopTransDrop}
                    setTelopDrop={setTelopDrop}
                    stopPlayback={stopPlayback}
                    seekTo={seekTo}
                    motionLabel={motionLabel}
                    selectTelopTrans={selectTelopTrans}
                    startTransResize={startTransResize}
                    patchCueAnim={patchCueAnim}
                  />
                )}
                {/* 本編以外の段に並ぶ帯は components/timeline/OverlayClipBands.tsx。
                    重ねた動画は映像と音を別の段に描くが中身は1つ（どちらを掴んでも動く） */}
                {tr.kind === 'video' && tr.id !== 'V1' && (
                  <VideoLayerBand
                    clips={vClips.filter((c) => c.track === tr.id)}
                    zoom={zoom}
                    vcLen={vcLen}
                    pairedAudioOf={pairedAudioOf}
                    mediaItems={mediaItems}
                    onPointerDown={onVClipPointerDown}
                    openClipMenu={openClipMenu}
                  />
                )}
                {tr.kind === 'audio' && (
                  <VideoLayerAudioBand
                    clips={vClips.filter((c) => 'A' + trackNum(c.track) === tr.id)}
                    zoom={zoom}
                    vcLen={vcLen}
                    mediaMeta={mediaMeta}
                    trackH={trackHOf('audio')}
                    onPointerDown={onVClipPointerDown}
                    openClipMenu={openClipMenu}
                  />
                )}
                {tr.kind === 'video' && tr.id !== 'V1' && (
                  <ImageBand
                    clips={imgClips.filter(
                      (c) => c.track === tr.id && inView(c.tStart, c.tStart + c.duration)
                    )}
                    zoom={zoom}
                    onPointerDown={onImgPointerDown}
                    openClipMenu={openClipMenu}
                  />
                )}
                {imgGhost && imgGhost.track === tr.id && (
                  <ImageGhost ghost={imgGhost} zoom={zoom} />
                )}
                {/* 出入りの動きを落とす先の予告（components/timeline/TelopBands.tsx）。
                    段に描く＝「間」は2テロップに跨って出せる */}
                {tr.kind === 'video' && tr.id !== 'V1' && telopDrop && (
                  <TelopDropGhost trackId={tr.id} drop={telopDrop} cueTrack={cueTrack} />
                )}
                {/* 本編の映像の帯は components/timeline/MainClipBands.tsx */}
                {tr.id === 'V1' && videoSrc && (
                  <MainVideoBands
                    segLayout={segLayout}
                    zoom={zoom}
                    inView={inView}
                    srcOfSeg={srcOfSeg}
                    overwriteIds={overwriteIds}
                    onPointerDown={onSegPointerDown}
                    onTrimStart={onSegTrimStart}
                    openClipMenu={openClipMenu}
                  />
                )}
                {/* 映像と音はセットなので、対の音声段にも同じ位置・長さで出す */}
                {tr.id === videoGhost?.track && videoGhost && (
                  <VideoGhost ghost={videoGhost} zoom={zoom} />
                )}
                {videoGhost && tr.id === 'A' + trackNum(videoGhost.track) && (
                  <VideoAudioGhost ghost={videoGhost} zoom={zoom}
                    meta={mediaMeta[videoGhost.path]} trackH={trackHOf('audio')} />
                )}
                {/* トランジションの帯は components/timeline/TransitionBands.tsx。
                    帯は「実際に効いている区間」に描く（カットの手前 d 秒） */}
                {tr.id === 'V1' && videoSrc && (
                  <TransitionBands
                    segLayout={segLayout}
                    zoom={zoom}
                    selectedTrans={selectedTrans}
                    onSelect={selectTransition}
                    onResizeStart={startTransResize}
                    onSetDur={setVideoTransDur}
                  />
                )}
                {tr.id === 'V1' && transDrop && (
                  <TransDropGhost drop={transDrop} segLayout={segLayout} zoom={zoom} />
                )}
                {/* 本編の音の帯（同上）。V1 と同じ切片を波形で描く */}
                {tr.id === 'A1' && videoSrc && (
                  <MainAudioBands
                    segLayout={segLayout}
                    zoom={zoom}
                    inView={inView}
                    srcOfSeg={srcOfSeg}
                    trackH={trackHOf('audio')}
                    onPointerDown={onSegPointerDown}
                  />
                )}
                {/* 効果音・BGM の帯は components/timeline/SeBands.tsx */}
                {tr.kind === 'audio' && (
                  <SeBands
                    trackId={tr.id}
                    zoom={zoom}
                    inView={inView}
                    onPointerDown={onSePointerDown}
                    openClipMenu={openClipMenu}
                  />
                )}
                {/* 掴んで運んでいる最中の置き場所プレビューは
                    components/timeline/DropGhosts.tsx */}
                {seGhost && seGhost.track === tr.id && (
                  <SeGhost ghost={seGhost} zoom={zoom} meta={mediaMeta[seGhost.path]}
                    trackH={trackHOf('audio')} />
                )}
              </div>
            ))}
            {/* 下の余白。位置の計算には効かないので、上と同じ高さでなくてよい */}
            <div className="track-pad" style={{ height: padBottom }} />
          </div>
        </div>
      </div>
      {/* 下の拡大バー（components/timeline/ZoomBar.tsx）。
          真ん中を掴めば移動、左右の●で拡大・縮小——**1本で両方**やる。
          前は「拡大のつまみ」と「横スクロール」が別々にあった。 */}
      <ZoomBar
        totalSec={Math.max(1, duration)}
        zoom={zoom}
        limits={{ min: ZOOM_MIN, max: ZOOM_MAX }}
        scrollRef={scrollRef}
        onApply={(z, left) => {
          setZoom(z)
          // **幅が新しい拡大率で決まってから位置を当てる。**
          // 先に当てると、まだ古い（狭い）中身の幅で切り詰められて、
          // 掴んでいない側の端まで動く。Ctrl+ホイール側も同じ理由で1コマ待っている
          requestAnimationFrame(() => {
            const el = scrollRef.current
            if (el) el.scrollLeft = left
          })
        }}
      />
    </section>
  )
}
