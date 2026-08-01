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
import type { Adjust, Crop } from './panels/PropertyRows'
import { MotionTab, type MotionRow } from './panels/MotionTab'
import { useLayout } from '../state/layoutContext'
import { useLeftPanel } from '../state/leftPanelContext'
import { useSel } from '../state/selectionContext'
import { useDoc } from '../state/contentContext'
import { useViewCtx } from '../state/viewContext'
import { useIconsCtx } from '../state/iconsContext'
import { useToastCtx } from '../state/toastContext'
import { useEdit } from '../state/useEdit'
import type { Cue } from '../lib/srt'
import type { ReframeTarget, VClip } from '../lib/projectTypes'
import type { ClipMotion } from '../../../shared/clipMotion'
import { putKey, removeKey, valueAt, hasKeys, type Keys } from '../../../shared/keyframes'
import { hasClipMotion, zoomAt, MIN_MOTION_SCALE } from '../../../shared/clipMotion'
import { segSpeed, segTLen } from '../../../shared/timeline'
import { formatTime } from '../lib/srt'
import { hasMotion } from '../lib/telopStyle'
import {
  DEFAULT_ADJUST,
  DEFAULT_CROP,
  DEFAULT_ZOOM,
  isNeutralAdjust,
  isNeutralCrop
} from '../lib/clipLook'
import { clamp } from '../../../shared/timeline'
import type { MotionKeyName } from '../../../shared/telopMotion'
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
  /** いまの再生位置と全体の長さ（秒） */
  currentTime: number
  duration: number
  /** モーションで選んでいる項目（描き直しを待たずに読むので ref） */
  motionSelRef: React.MutableRefObject<string[]>
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
  saveMyMotion: () => void
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
  /** その映像クリップの長さ（秒） */
  vcLen: (c: VClip) => number
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
    clearClipMotions,
    currentTime,    motionSelRef,
    nudgeClips,
    pairedAudioOf,
    panelStyleFor,
    reframeTarget,
    resetClipChannel,
    resetCount,
    saveMyMotion,
    savePreset,
    seekTo,
    setBoxAnchor,
    setPersonIconForSelected,
    setSelectedSegSpeed,
    toggleKeys,
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
  const { } = useViewCtx()
  const { showToast } = useToastCtx()
  const { iconSide, setIconSide, iconOffset, setIconOffset, iconScale, setIconScale, iconAuto, setIconSettingsOpen } = useIconsCtx()
  const { updateSelectedImg, updateSelectedSE, updateSelectedVClip, patchCuePos, patchCueScale, patchMotion, patchClipMotion, clearTelopMotions, setSelectedAdjust, setSelectedCrop, setSegZoom, setImgZoom, setVClipZoom, rotateSelectedSeg, flipSelectedSeg, toggleMuteSelectedSegments, resetTelopChannel, nudgeOthers, setSelectedAudio, clearBox, selected } = useEdit()

  return (
    <section className="panel" style={{ width: leftW, flex: '0 0 auto' }}>
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
        selected ? (
          (() => {
            const clipT = clamp(currentTime - selected.start, 0, selected.end - selected.start)
            const m = selected.motion
            const put = (k: MotionKeyName, v: number): void =>
              patchMotion(selected.id, k, (keys) => putKey(keys, clipT, v))
            const row = (
              key: MotionKeyName,
              label: string,
              opt: {
                value: number
                unit?: string
                step: number
                min: number
                max: number
                /** ⏱ が消えている状態での書き込み先（位置と拡大は元の値がある） */
                base?: (v: number) => void
                /** 表示値 → キーに入れる値（位置は元の値との差、拡大は倍率） */
                toKey: (v: number) => number
                /** ⏱ を付けた瞬間に置く値 */
                initial: number
              }
            ): MotionRow => ({
              key,
              label,
              value: opt.value,
              unit: opt.unit,
              step: opt.step,
              min: opt.min,
              max: opt.max,
              keys: m?.[key],
              // **どの行も触れる。**
              // 「元の値」を持っているのは位置と拡大だけで、横だけ拡大・歪曲・
              // 明るさなどは ⏱ を押すまで触れなかった。値を見ながら決めたいのに、
              // 先に印を打たせるのは順番が逆（実際に「触れない」と言われた）。
              // 元の値が無い行は、**印を1つだけ置く**＝クリップ全体で一定の値になる。
              editableWithoutKeys: true,
              onValue: (v) => {
                if (hasKeys(m?.[key])) put(key, opt.toKey(v))
                else if (opt.base) opt.base(v)
                else put(key, opt.toKey(v)) // 印1つ＝ずっとその値
                // **選んである物には、同じだけ配る。**
                // 出ている値は選択の先頭の物なので、**その差分**を他へ足す
                // （同じ値を配ると、ばらばらに置いた物が1か所に揃ってしまう）。
                if (selectedIds.length > 1) nudgeOthers(key, v - opt.value, clipT)
              },
              onToggleKeys: () =>
                toggleKeys(label, m?.[key], opt.initial, clipT, (fn) =>
                  patchMotion(selected.id, key, fn)
                ),
              onPutKey: () => put(key, opt.toKey(opt.value)),
              onRemoveKey: () =>
                patchMotion(selected.id, key, (keys) => removeKey(keys, clipT)),
              // 元の値（位置・拡大など）は触らない。**そこは配置であって動きではない**
              // ＝画面のリセットの担当。ここは打った印だけを捨てる
              onReset: () => resetTelopChannel(key)
            })
            // 位置は「フレームの中の場所」で見せる（0..1 を 1080基準px に直す）
            const px = (frac: number): number => Math.round(frac * 1920)
            const py = (frac: number): number => Math.round(frac * 1080)
            return (
              <MotionTab
                title={selected.text.slice(0, 16) || 'テロップ'}
                hint="⏱ を押すと動きが付きます。再生ヘッドを動かして値を変えると、その位置に印（◆）が置かれます。"
                clipTime={clipT}
                onSeekClipTime={(t) => seekTo(selected.start + t)}
                rows={[
                  row('tx', '位置 X', {
                    value: px(selected.pos.x) + valueAt(m?.tx, clipT, 0),
                    unit: 'px',
                    step: 1,
                    min: -4000,
                    max: 4000,
                    base: (v) => patchCuePos(selected.id, { x: v / 1920 }),
                    toKey: (v) => v - px(selected.pos.x),
                    initial: 0
                  }),
                  row('ty', '位置 Y', {
                    value: py(selected.pos.y) + valueAt(m?.ty, clipT, 0),
                    unit: 'px',
                    step: 1,
                    min: -4000,
                    max: 4000,
                    base: (v) => patchCuePos(selected.id, { y: v / 1080 }),
                    toKey: (v) => v - py(selected.pos.y),
                    initial: 0
                  }),
                  row('sc', '拡大', {
                    value: Math.round((selected.scale ?? 1) * valueAt(m?.sc, clipT, 1) * 100),
                    unit: '%',
                    step: 1,
                    min: 5,
                    max: 800,
                    base: (v) => patchCueScale(selected.id, v / 100),
                    toKey: (v) => v / 100 / (selected.scale ?? 1),
                    initial: 1
                  }),
                  row('rot', '回転', {
                    value: valueAt(m?.rot, clipT, 0),
                    unit: '°',
                    step: 1,
                    min: -360,
                    max: 360,
                    toKey: (v) => v,
                    initial: 0
                  }),
                  row('op', '不透明度', {
                    value: Math.round(valueAt(m?.op, clipT, 1) * 100),
                    unit: '%',
                    step: 1,
                    min: 0,
                    max: 100,
                    toKey: (v) => v / 100,
                    initial: 1
                  })
                ]}
                /* ここから下は、取り込んだ演出で使う物。
                   テロップは HTML を PNG に焼く経路なので、3D回転も明るさも
                   ぼかしも切り抜きも、そのまま出せる（ffmpeg の制約を受けない）。 */
                moreRows={[
                  row('scx', '横だけ拡大', {
                    value: Math.round(valueAt(m?.scx, clipT, 1) * 100),
                    unit: '%',
                    step: 1,
                    min: 0,
                    max: 800,
                    toKey: (v) => v / 100,
                    initial: 1
                  }),
                  row('scy', '縦だけ拡大', {
                    value: Math.round(valueAt(m?.scy, clipT, 1) * 100),
                    unit: '%',
                    step: 1,
                    min: 0,
                    max: 800,
                    toKey: (v) => v / 100,
                    initial: 1
                  }),
                  row('skew', '歪曲', {
                    value: valueAt(m?.skew, clipT, 0),
                    unit: '°',
                    step: 1,
                    min: -89,
                    max: 89,
                    toKey: (v) => v,
                    initial: 0
                  }),
                  row('roty', '横回転', {
                    value: valueAt(m?.roty, clipT, 0),
                    unit: '°',
                    step: 1,
                    min: -360,
                    max: 360,
                    toKey: (v) => v,
                    initial: 0
                  }),
                  row('rotx', '縦回転', {
                    value: valueAt(m?.rotx, clipT, 0),
                    unit: '°',
                    step: 1,
                    min: -360,
                    max: 360,
                    toKey: (v) => v,
                    initial: 0
                  }),
                  row('bright', '明るさ', {
                    value: Math.round(valueAt(m?.bright, clipT, 1) * 100),
                    unit: '%',
                    step: 1,
                    min: 0,
                    max: 500,
                    toKey: (v) => v / 100,
                    initial: 1
                  }),
                  row('blur', 'ぼかし', {
                    value: valueAt(m?.blur, clipT, 0),
                    unit: 'px',
                    step: 1,
                    min: 0,
                    max: 200,
                    toKey: (v) => v,
                    initial: 0
                  }),
                  row('hue', '色相', {
                    value: valueAt(m?.hue, clipT, 0),
                    unit: '°',
                    step: 1,
                    min: -360,
                    max: 360,
                    toKey: (v) => v,
                    initial: 0
                  }),
                  row('inv', '色の反転', {
                    value: Math.round(valueAt(m?.inv, clipT, 0) * 100),
                    unit: '%',
                    step: 1,
                    min: 0,
                    max: 100,
                    toKey: (v) => v / 100,
                    initial: 1
                  }),
                  row('blind', 'ブラインド', {
                    value: Math.round(valueAt(m?.blind, clipT, 0) * 100),
                    unit: '%',
                    step: 1,
                    min: 0,
                    max: 100,
                    toKey: (v) => v / 100,
                    initial: 1
                  }),
                  // 切り抜きは各辺を「何％削るか」。タイプライターは右を刻んで動かすだけ
                  row('cl', '切抜 左', {
                    value: Math.round(valueAt(m?.cl, clipT, 0) * 100),
                    unit: '%',
                    step: 1,
                    min: 0,
                    max: 100,
                    toKey: (v) => v / 100,
                    initial: 0
                  }),
                  row('ct', '切抜 上', {
                    value: Math.round(valueAt(m?.ct, clipT, 0) * 100),
                    unit: '%',
                    step: 1,
                    min: 0,
                    max: 100,
                    toKey: (v) => v / 100,
                    initial: 0
                  }),
                  row('cr', '切抜 右', {
                    value: Math.round(valueAt(m?.cr, clipT, 0) * 100),
                    unit: '%',
                    step: 1,
                    min: 0,
                    max: 100,
                    toKey: (v) => v / 100,
                    initial: 0
                  }),
                  row('cb', '切抜 下', {
                    value: Math.round(valueAt(m?.cb, clipT, 0) * 100),
                    unit: '%',
                    step: 1,
                    min: 0,
                    max: 100,
                    toKey: (v) => v / 100,
                    initial: 0
                  })
                ]}
                /* 見本帳（演出を選ぶ所）は右パネルのトランジションタブにある。
                   名前が 05.飛び出し のような演出名なので、置き場は他の見本帳と
                   並んでいる方が探せる。ここは**選んだあと数値を詰める**所。 */
                onSaveMotion={hasMotion(m) ? saveMyMotion : undefined}
                /* 選んでいる分すべてから消す（付ける時と同じ範囲） */
                onClearMotion={hasMotion(m) ? clearTelopMotions : undefined}
                clearCount={selectedIds.length}
                onSelectRows={(k) => (motionSelRef.current = k)}
                clipLen={selected.end - selected.start}
                targetKey={`telop:${selected.id}`}
              />
            )
          })()
        ) : reframeTarget ? (
          /* テロップを選んでいなければ、いま触っている映像の物（動画切片・画像・
             映像レイヤー）に動きを付ける。**対象の決め方はリフレーム枠と同じ**
             ＝プレビューで枠が出ている物が、そのままモーションの相手になる。

             項目が3つしか無いのは、書き出しで時間ごとに変えられるのが
             拡大・位置だけだから（回転と不透明度は ffmpeg 側に手が無い）。 */
          (() => {
            const tgt = reframeTarget
            const clipT = clamp(currentTime - tgt.tStart, 0, Math.max(0, tgt.len))
            const m = tgt.motion
            const z = zoomAt(tgt.zoom, m, clipT)
            const put = (k: keyof ClipMotion, v: number): void =>
              patchClipMotion(tgt.kind, tgt.id, k, (keys) => putKey(keys, clipT, v))
            const setFixed = (patch: Partial<typeof tgt.zoom>): void => {
              const next = { ...tgt.zoom, ...patch }
              if (tgt.kind === 'video') setSegZoom(tgt.id, next)
              else if (tgt.kind === 'vclip') setVClipZoom(tgt.id, next)
              else setImgZoom(tgt.id, next)
            }
            const row = (
              key: keyof ClipMotion,
              label: string,
              opt: {
                /** 画面に出す値（印があればその瞬間の値） */
                value: number
                unit: string
                min: number
                max: number
                /** 画面の値 → 中に入れる値（％→倍率、px→フレーム比） */
                toKey: (v: number) => number
                /** ⏱ を消している間の書き込み先（固定値） */
                base: (v: number) => void
                /** ⏱ を付けた瞬間に置く値（既定はいまの値） */
                initial?: number
                /** ⏱ を付けた瞬間に、値が動いてしまうときの断り */
                turnOnNote?: string
              }
            ): MotionRow => ({
              key,
              label,
              value: opt.value,
              unit: opt.unit,
              step: 1,
              min: opt.min,
              max: opt.max,
              keys: m?.[key],
              // 拡大も位置も、印が無くても固定値として変えられる（今までどおり）
              editableWithoutKeys: true,
              onValue: (v) => {
                const shown = clamp(v, opt.min, opt.max)
                const val = opt.toKey(shown)
                if (hasKeys(m?.[key])) put(key, val)
                else opt.base(val)
                // **選んである動画・画像・映像レイヤーにも同じだけ配る。**
                // プレミアと同じで、再生ヘッドがどこにあっても
                // 「いま選んでいる物」が変わる。配るのは差分（値そのものではない）
                nudgeClips(tgt, key, opt.toKey(shown) - opt.toKey(opt.value))
              },
              onToggleKeys: () => {
                if (opt.turnOnNote && !hasKeys(m?.[key])) showToast(opt.turnOnNote)
                toggleKeys(
                  label,
                  m?.[key],
                  opt.initial ?? opt.toKey(opt.value),
                  clipT,
                  (fn) => patchClipMotion(tgt.kind, tgt.id, key, fn)
                )
              },
              onPutKey: () => put(key, opt.toKey(opt.value)),
              onRemoveKey: () =>
                patchClipMotion(tgt.kind, tgt.id, key, (keys) => removeKey(keys, clipT)),
              // 映像は固定値も同じ項目（拡大・位置）なので、そちらも既定へ戻す。
              // 印だけ消しても、固定値で寄ったままだと「戻らない」に見える
              onReset: () => resetClipChannel(key)
            })
            // 動きが1つでも付いていれば、拡大は1倍以上しか焼けない（zoomAt と同じ規則）。
            // 位置だけ動かしている時も同じなので、印の有無ではなく「動きがあるか」で見る
            const zoomKeyed = hasClipMotion(m)
            // **見本帳（presets）はここには渡さない。** 写し取った演出は
            // テロップ用に作られていて、持っている項目もテロップの Motion
            // （横だけ拡大・3D回転・切り抜き…）。映像側の動きは ffmpeg で焼くので
            // 拡大と位置しか手が無く、当てても効かないか、拡大が1倍未満になって
            // **書き出しが通らない状態**になる。相手を選ばせない＝事故を作らない。
            return (
              <MotionTab
                title={`${tgt.kind === 'img' ? '🖼' : '🎬'} ${tgt.name}`}
                hint={
                  zoomKeyed
                    ? '拡大は1倍以上だけ動かせます（引く動きは書き出せないため）。'
                    : '⏱ を押すと動きが付きます。再生ヘッドを動かして値を変えると、その位置に印（◆）が置かれます。'
                }
                clipTime={clipT}
                onSeekClipTime={(t) => seekTo(tgt.tStart + t)}
                rows={[
                  row('sc', '拡大', {
                    value: Math.round(z.scale * 100),
                    unit: '%',
                    // 印を打つと1倍未満へは行けない（zoompan が寄る方しか焼けない）。
                    // 打っていなければ今までどおり引ける
                    min: zoomKeyed ? 100 : 20,
                    max: 800,
                    toKey: (v) => v / 100,
                    base: (v) => setFixed({ scale: v }),
                    // 引いた状態（1倍未満）から動きを付けると、100% に上がる。
                    // 黙って絵が変わるのが一番困るので、そのことを言う
                    initial: Math.max(MIN_MOTION_SCALE, z.scale),
                    turnOnNote:
                      z.scale < MIN_MOTION_SCALE
                        ? '拡大の動きは1倍以上だけです（引く動きは書き出せません）。100% から始めます。'
                        : undefined
                  }),
                  row('x', '位置 X', {
                    value: Math.round(z.x * 1920),
                    unit: 'px',
                    min: -1920,
                    max: 1920,
                    toKey: (v) => v / 1920,
                    base: (v) => setFixed({ x: v })
                  }),
                  row('y', '位置 Y', {
                    value: Math.round(z.y * 1080),
                    unit: 'px',
                    min: -1080,
                    max: 1080,
                    toKey: (v) => v / 1080,
                    base: (v) => setFixed({ y: v })
                  })
                ]}
                /* 映像側にも「動きを消す」を出す。テロップにだけあって
                   こちらに無いと、消し方が無いように見える（プレビューの
                   リセットは拡大も戻すので、動きだけ外したい時に使えない）。 */
                onClearMotion={hasClipMotion(m) ? clearClipMotions : undefined}
                clearCount={resetCount()}
                onSelectRows={(k) => (motionSelRef.current = k)}
                clipLen={tgt.len}
                targetKey={`${tgt.kind}:${tgt.id}`}
              />
            )
          })()
        ) : (
          <div className="panel-body">
            <div className="empty">
              タイムラインで物を選ぶと
              <br />
              動きを付けられます
            </div>
          </div>
        )
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
        const vcLen = vc ? Math.max(0.05, vc.srcEnd - vc.srcStart) : 0
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
                    lengthLabel: formatTime(vcLen),
                    length: vcLen,
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
