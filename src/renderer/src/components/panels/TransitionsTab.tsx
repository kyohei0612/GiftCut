// 右パネルの「トランジション」タブ。
//
// 上半分 … タイムラインで帯を選んでいるとき、その1つを編集・削除する
// 下半分 … 置ける物の一覧（タイムラインへドラッグして置く）
//
// 動画クリップとテロップで**同じ扱い**にしてある。どちらも
// 頭（始まり）・間（隣との切替）・尻（終わり）のどこにでも置けて、
// 置いた帯をクリックすれば長さと種類を変えられる。
// 片方だけ別の操作にすると、置き方を2つ覚えることになる。

import { useState, type JSX } from 'react'
import type { MotionPresetFile } from '../../../../shared/telopMotion'

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
  onType: (type: string) => void
  onDur: (dur: number) => void
  onDelete: () => void
  onDeselect: () => void
}

function BandEditor({ band }: { band: SelectedBand }): JSX.Element {
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
              onClick={() => band.onType(x.type)}
              title={x.label}
            >
              {x.ico}
            </button>
          ))}
        </div>
      </div>
      <div className="sp-row">
        <span className="sp-label">長さ</span>
        <input
          type="range"
          min={0.05}
          max={2}
          step={0.05}
          value={band.dur}
          onChange={(e) => band.onDur(Number(e.target.value))}
        />
        <span className="sp-val">{band.dur.toFixed(2)}s</span>
      </div>
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
  newDur,
  onNewDur,
  videoKinds,
  telopKinds,
  onDragStartVideo,
  onDragEndVideo,
  onDragStartTelop,
  onDragEndTelop,
  onToggleEmphasis,
  motionPresets,
  onApplyMotionPreset,
  onImportMotionPresets
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
  /** これから置く物の長さ */
  newDur: number
  onNewDur: (v: number) => void
  videoKinds: TransKind[]
  telopKinds: TransKind[]
  onDragStartVideo: (kind: TransKind, e: React.DragEvent) => void
  onDragEndVideo: () => void
  onDragStartTelop: (kind: TransKind, e: React.DragEvent) => void
  onDragEndTelop: () => void
  onToggleEmphasis: (kind: 'shake' | 'pulse') => void
  /**
   * 取り込んである動きの見本帳（Premiere の .prfpset から写し取った物）。
   * **付く相手はテロップだけ。** 中身はテロップの動き（横だけ拡大・3D回転・切り抜き…）で、
   * 映像クリップは拡大と位置しか焼けないため、当てても効かないか書き出せない値になる。
   * 押したときの相手選びは呼ぶ側（App の applyMotionPreset）が持っている。
   */
  motionPresets: MotionPresetFile[]
  onApplyMotionPreset: (p: MotionPresetFile) => void
  onImportMotionPresets: () => void
}): JSX.Element {
  // 実物で72個並ぶ。名前で絞れないと目で探すことになる
  const [q, setQ] = useState('')
  // **既定は「ちゃんと出る物」だけ。** 一部だけの物・動かない物が混ざっていると、
  // 選ぶたびに当たり外れを引くことになる。中身を見たいときだけ出す
  // （何が入っていたかを知りたい、という用途は残す）。
  const [showAll, setShowAll] = useState(false)
  const usable = (p: MotionPresetFile): boolean =>
    Object.keys(p.motion).length > 0 && !p.partial?.length
  const okCount = motionPresets.filter(usable).length
  const shownPresets = motionPresets.filter(
    (p) => (showAll || usable(p)) && (!q || p.name.includes(q))
  )
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
      {selectedVideoBand && <BandEditor band={selectedVideoBand} />}
      {selectedTelopBand && <BandEditor band={selectedTelopBand} />}
      {!selectedVideoBand && !selectedTelopBand && (
        <div className="tpl-hint">
          下のトランジションを<b>タイムラインへドラッグ</b>。落とす<b>マウス位置</b>で置き場所が決まります。
          置いた<b>帯をクリック</b>で長さ・種類の変更／削除、<b>帯の端をドラッグ</b>で長さ変更。
        </div>
      )}
      <div className="sp-row">
        <span className="sp-label">新規の長さ</span>
        <input
          type="range"
          min={0.05}
          max={2}
          step={0.05}
          value={newDur}
          onChange={(e) => onNewDur(Number(e.target.value))}
        />
        <span className="sp-val">{newDur.toFixed(2)}s</span>
      </div>
      {accSec('transition', 'video', '🎬 動画クリップ', null, (
        <>
          <div className="tpl-hint">
            どの種類も<b>頭・間・尻のどこにでも</b>置けます。
            <b>カットの境目＝間</b>／クリップ本体の<b>前半＝頭・後半＝尻</b>。
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
      {/* 写し取った動き。**強調と同じで「選んでいるテロップにクリックで付く」**。
          名前が 05.飛び出し のような演出名なので、置き場もここが合っている
          （左のモーションタブは、付けたあと数値を詰める所）。 */}
      {accSec('transition', 'motion', '💫 動き（取り込んだ演出）', okCount || motionPresets.length || null, (
        <>
          {/* **説明は1行に抑える。** パネルを細くすると、ここが伸びて一覧を
              画面の外へ押し出す（細い時に演出が1つも見えなくなっていた）。
              足りない物の中身は、名前ごとの吹き出しに書いてある。 */}
          <div className="tpl-hint">
            選択中のテロップに<b>クリックで適用</b>。微調整は左の「モーション」タブで。
          </div>
          <div className="mo-legend">
            <span>💫 使える</span>
            <span>🔼 重ね用（単体だと消える）</span>
            {showAll && <span>△ 一部だけ</span>}
            {showAll && <span>✕ 動きなし</span>}
          </div>
          {/* 取り込みボタンはここに置かない（一度きりの作業なので、常に場所を
              取らせるとその分だけ一覧が見えなくなる）。ファイルメニューにある。
              ただし**空のときだけ**は、ここから辿れないと詰むので出す。 */}
          {motionPresets.length > 0 && (
            <div className="mo-presets-bar">
              <input
                className="mo-find"
                placeholder="名前でしぼる"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {/* **隠した数は必ず見せる。** 黙って減らすと「取り込めていない」に見える */}
              <label
                className="mo-showall"
                title="こちらに無いエフェクトが混ざっている物・動きが取れなかった物も出します"
              >
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(e) => setShowAll(e.target.checked)}
                />
                まだ出ない物も（{motionPresets.length - okCount}）
              </label>
            </div>
          )}
          {motionPresets.length === 0 ? (
            <div className="tpl-hint">
              まだ何も入っていません。
              <button className="mo-mini" onClick={onImportMotionPresets}>
                Premiere の .prfpset を取り込む
              </button>
              <br />
              あとから入れ直すときは、ファイルメニューの「Premiere の動きを取り込む…」から。
            </div>
          ) : (
            <div className="fx-list mo-preset-list">
              {shownPresets.map((p) => {
                // 3通り: そのまま使える / 一部だけ / 動きが1つも取れなかった。
                // **取れなかった物も並べる**（何が入っていたかが見えないと、
                // どれを配布に載せるか決められない）。押したときは理由を言う。
                const none = Object.keys(p.motion).length === 0
                const part = !none && !!p.partial?.length
                const lack = p.partial?.length ? `（こちらに無い物: ${p.partial.join(' / ')}）` : ''
                // 2枚重ねの上側。単体だと最後に文字が消える（壊れているのではない）
                const pair = !none && p.endsHidden
                return (
                  <button
                    key={p.name}
                    className={`fx-item mo-preset ${none ? 'mo-preset-none' : part ? 'mo-preset-part' : ''}`}
                    title={
                      none
                        ? `動きを持ってこられませんでした${lack}`
                        : pair
                          ? '2枚重ねの上側用です。単体で当てると、終わりで文字が消えます' +
                            '（同じ名前の「_下」と重ねて使う物）' + lack
                          : part
                            ? `一部だけ再現できます${lack}`
                            : 'この動きを付ける'
                    }
                    onClick={() => onApplyMotionPreset(p)}
                  >
                    <span className="fx-ico">{none ? '✕' : pair ? '🔼' : part ? '△' : '💫'}</span>
                    <span className="fx-name">{p.name}</span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      ))}
      {accSec('transition', 'effect', '✨ エフェクト（テロップ強調）', null, (
        <>
          <div className="tpl-hint">
            選択中のテロップに<b>クリックでON/OFF</b>（クリップ全体にかかる動き）。
          </div>
          <div className="fx-list">
            <button className="fx-item" onClick={() => onToggleEmphasis('shake')}>
              <span className="fx-ico">〰️</span>
              <span className="fx-name">揺れ</span>
            </button>
            <button className="fx-item" onClick={() => onToggleEmphasis('pulse')}>
              <span className="fx-ico">❤️</span>
              <span className="fx-name">脈動</span>
            </button>
          </div>
        </>
      ))}
    </div>
  )
}
