// 右パネルの「トランジション」タブ。
//
// 上半分 … タイムラインで帯を選んでいるとき、その1つを編集・削除する
// 下半分 … 置ける物の一覧（タイムラインへドラッグして置く）
//
// 動画クリップとテロップで**同じ扱い**にしてある。どちらも
// 頭（始まり）・間（隣との切替）・尻（終わり）のどこにでも置けて、
// 置いた帯をクリックすれば長さと種類を変えられる。
// 片方だけ別の操作にすると、置き方を2つ覚えることになる。

import { TRANS_MAX_SEC } from '../../lib/transitions'
import type { JSX } from 'react'
import type { MotionPresetFile } from '../../../../shared/telopMotion'
import { MotionPresetList } from './MotionPresetList'

/**
 * 強調（クリップ全体にかかる動き）。**2種類だけなので、ここに直に持つ。**
 *
 * 出入りの演出（`telopKinds`）は数が多く増えるので外から渡しているが、
 * こちらは増える予定が無い。外へ出すと「どこを見れば一覧が分かるか」が
 * 1つ増えるだけになる。
 */
const EMPHASIS_KINDS: { type: 'shake' | 'pulse'; ico: string; label: string }[] = [
  { type: 'shake', ico: '〰️', label: '揺れ' },
  { type: 'pulse', ico: '❤️', label: '脈動' }
]

export interface TransKind {
  type: string
  label: string
  ico: string
}

/** 選んでいる帯（動画側／テロップ側で共通の形にして渡す） */
export interface SelectedBand {
  /** 見出しに出す場所の名前（頭・間・尻） */
  place: string
  /** 見出しの絵文字 */
  ico: string
  type: string
  dur: number
  kinds: TransKind[]
  /** `all`＝同じ種類の演出すべてに当てる（下の「まとめて」） */
  onType: (type: string, all: boolean) => void
  onDur: (dur: number, all: boolean) => void
  onDelete: () => void
  onDeselect: () => void
}

function BandEditor({
  band,
  all,
  onAll
}: {
  band: SelectedBand
  /** 同じ種類すべてに当てるか */
  all: boolean
  onAll: (v: boolean) => void
}): JSX.Element {
  return (
    <div className="sel-trans">
      <div className="sel-trans-head">
        <span className="sel-trans-title">
          {band.ico} {band.place}
        </span>
        <button
          className="btn small danger"
          onClick={band.onDelete}
          title="これを削除（Delete）"
        >
          削除
        </button>
      </div>
      <div className="sp-row">
        <span className="sp-label">種類</span>
        <div className="seg seg-wrap">
          {band.kinds.map((x) => (
            <button
              key={x.type}
              className={`seg-btn ${band.type === x.type ? 'seg-on' : ''}`}
              onClick={() => band.onType(x.type, all)}
              title={x.label}
            >
              {x.ico}
            </button>
          ))}
        </div>
      </div>
      <div className="sp-row">
        <span className="sp-label">長さ</span>
        {/* 上限は `lib/transitions` の `TRANS_MAX_SEC` 1つから引く
            （帯のドラッグも同じ物を見る。片方だけ動かすと表示が食い違う） */}
        <input
          type="range"
          min={0.05}
          max={TRANS_MAX_SEC}
          step={0.05}
          value={band.dur}
          onChange={(e) => band.onDur(Number(e.target.value), all)}
        />
        <span className="sp-val">{band.dur.toFixed(2)}s</span>
      </div>
      {/* **1つずつ選んで同じ数字を打ち直す作業をなくす。**
          揃える相手は「種類が同じ物」——画面で見分けられる単位がそれなので
          （置き場所は帯の位置で分かるが、置き場所ごとに揃えたい場面が無い）。
          ここで置いた長さは、**次に置く物の長さにもなる**（別のスライダーは持たない）。 */}
      <label className="sp-row sp-check" title="いま選んでいる物と同じ種類の演出を、まとめて同じ長さ・種類にします">
        <input type="checkbox" checked={all} onChange={(e) => onAll(e.target.checked)} />
        <span>同じ種類すべてに当てる</span>
      </label>
      <button className="btn small" onClick={band.onDeselect}>
        選択を解除
      </button>
      <div className="tpl-divider" />
    </div>
  )
}

export function TransitionsTab({
  bodyRef,
  accSec,
  selectedVideoBand,
  selectedTelopBand,
  applyAll,
  onApplyAll,
  videoKinds,
  telopKinds,
  onDragStartVideo,
  onDragEndVideo,
  onDragStartTelop,
  onDragEndTelop,
  onToggleEmphasis,
  onDragStartEmphasis,
  onDragEndEmphasis,
  builtinMotions,
  myMotions,
  motionPresets,
  onApplyMotionPreset,
  onDeleteMyMotion
}: {
  bodyRef: React.Ref<HTMLDivElement>
  accSec: (
    tab: string,
    key: string,
    label: string,
    count: number | null,
    body: JSX.Element
  ) => JSX.Element
  /** 動画クリップ側で選んでいる帯（無ければ null） */
  selectedVideoBand: SelectedBand | null
  /** テロップ側で選んでいる帯（無ければ null） */
  selectedTelopBand: SelectedBand | null
  /**
   * 同じ種類すべてに当てるか。
   *
   * **「新規の長さ」のスライダーは消した**（2026-08-16・本人の指定:
   * 「新規で長さ変える奴意味わからんから消して欲しい。基本上の長さ設定で十分だ」）。
   * 長さの入口が2つあると、選んでいる帯を変えたつもりで**これから置く物の方を
   * 変えていた**、が起きる。いまは上の「長さ」1つで、そこで置いた値が
   * そのまま次に置く物の長さになる。
   */
  applyAll: boolean
  onApplyAll: (v: boolean) => void
  videoKinds: TransKind[]
  telopKinds: TransKind[]
  onDragStartVideo: (kind: TransKind, e: React.DragEvent) => void
  onDragEndVideo: () => void
  onDragStartTelop: (kind: TransKind, e: React.DragEvent) => void
  onDragEndTelop: () => void
  onToggleEmphasis: (kind: 'shake' | 'pulse') => void
  /** 強調を掴んだ／離した（落とし先はタイムラインの帯とプレビューの文字） */
  onDragStartEmphasis: (kind: 'shake' | 'pulse', e: React.DragEvent) => void
  onDragEndEmphasis: () => void
  /**
   * 動きの一覧。3つに分けて並べる。
   *
   *   builtinMotions … 最初から入っている20種。**配布物に入る**（こちらで打った値）
   *   myMotions      … 自分で作って名前を付けて保存した物
   *   motionPresets  … Premiere の .prfpset から取り込んだ物。**配布物には入らない**
   *
   * **付く相手はテロップだけ。** 中身はテロップの動き（横だけ拡大・3D回転・切り抜き…）で、
   * 映像クリップは拡大と位置しか焼けないため、当てても効かないか書き出せない値になる。
   * 押したときの相手選びは呼ぶ側（App の applyMotionPreset）が持っている。
   */
  builtinMotions: MotionPresetFile[]
  myMotions: MotionPresetFile[]
  motionPresets: MotionPresetFile[]
  onApplyMotionPreset: (p: MotionPresetFile) => void
  onDeleteMyMotion: (name: string) => void
}): JSX.Element {
  const list = (
    kinds: TransKind[],
    onStart: (k: TransKind, e: React.DragEvent) => void,
    onEnd: () => void,
    hint: string
  ): JSX.Element => (
    <div className="fx-list">
      {kinds.map((x) => (
        <button
          key={x.type}
          className="fx-item fx-draggable"
          draggable
          onDragStart={(e) => onStart(x, e)}
          onDragEnd={onEnd}
          title={`${x.label}。${hint}`}
        >
          <span className="fx-ico">{x.ico}</span>
          <span className="fx-name">{x.label}</span>
          <span className="fx-drag-hint">⠿</span>
        </button>
      ))}
    </div>
  )
  return (
    <div className="panel-body" ref={bodyRef}>
      {selectedVideoBand && <BandEditor band={selectedVideoBand} all={applyAll} onAll={onApplyAll} />}
      {selectedTelopBand && <BandEditor band={selectedTelopBand} all={applyAll} onAll={onApplyAll} />}
      {!selectedVideoBand && !selectedTelopBand && (
        // **見えていない物を指して案内しない。**
        // 節は畳んで始まる（1つ開くと他が押し出されるため）ので、
        // 開く前は「下のトランジションをドラッグ」と言われても、下には何も無い。
        // まず開くところから案内する。
        <div className="tpl-hint">
          下の<b>▶ を押して開く</b>と一覧が出ます。そこから<b>タイムラインへドラッグ</b>。
          落とす<b>マウス位置</b>で置き場所（頭・間・尻）が決まります。
          置いた<b>帯をクリック</b>で長さ・種類の変更／削除、<b>帯の端をドラッグ</b>で長さ変更。
        </div>
      )}
      {accSec('transition', 'video', '🎬 動画クリップ', null, (
        <>
          {/* **開いた直後に読ませる量は1行まで。**
              置き場所の決まり（どこへ落とすと頭・間・尻になるか）は
              落とす時に予告の帯が出るので、文章で先に覚えさせない。
              詳しくは吹き出しに残す（読みたい人だけが読める）。 */}
          <div
            className="tpl-hint"
            title={
              'どの種類も頭・間・尻のどこにでも置けます。\n' +
              'カットの境目へ落とすと「間」、クリップ本体の前半なら「頭」、後半なら「尻」になります。'
            }
          >
            落とす<b>場所</b>で決まります（境目＝間／前半＝頭／後半＝尻）
          </div>
          {list(videoKinds, onDragStartVideo, onDragEndVideo, 'クリップの頭/間/尻へドラッグ')}
        </>
      ))}
      {accSec('transition', 'telop', '💬 テロップ', null, (
        <>
          <div className="tpl-hint">
            テロップの<b>頭＝出現 / 尻＝消失 / 間＝隣のテロップとの切替</b>。
          </div>
          {list(telopKinds, onDragStartTelop, onDragEndTelop, 'テロップの頭/尻/間へドラッグ')}
        </>
      ))}
      {/* 「動き」の節は components/panels/MotionPresetList。
          このタブの頭のコメントが説明しているのは「頭・間・尻に置く帯」だけで、
          動きはそこに1行も書かれていなかった（置き方も違う。帯はドラッグ、動きはクリック）。
          節ごと持っていったので、しぼり込みの状態（q・showAll）もあちらが持つ。 */}
      <MotionPresetList
        accSec={accSec}
        builtinMotions={builtinMotions}
        myMotions={myMotions}
        motionPresets={motionPresets}
        onApplyMotionPreset={onApplyMotionPreset}
        onDeleteMyMotion={onDeleteMyMotion}
      />
      {accSec('transition', 'effect', '✨ エフェクト（テロップ強調）', null, (
        <>
          <div className="tpl-hint">
            選択中のテロップに<b>クリックでON/OFF</b>。
            <b>テロップへドラッグ</b>でも付きます（クリップ全体にかかる動き）。
          </div>
          {/* **クリックは据え置きで、掴んでも置けるようにする**（本人の方針＝
              「クリックが多い。D&D でも持ってこられるように」）。
              見本帳・アイコン・出入りの演出は先にそうしてあり、ここだけ
              クリック専用で取り残されていた。落とし先は
              components/timeline/TelopBands と panels/PreviewLayers の両方。 */}
          <div className="fx-list">
            {EMPHASIS_KINDS.map((em) => (
              <button
                key={em.type}
                className="fx-item fx-draggable"
                draggable
                onDragStart={(e) => onDragStartEmphasis(em.type, e)}
                onDragEnd={onDragEndEmphasis}
                onClick={() => onToggleEmphasis(em.type)}
                title={`${em.label} — クリックで選択中のテロップにON/OFF / テロップへドラッグで付ける`}
              >
                <span className="fx-ico">{em.ico}</span>
                <span className="fx-name">{em.label}</span>
              </button>
            ))}
          </div>
        </>
      ))}
    </div>
  )
}
