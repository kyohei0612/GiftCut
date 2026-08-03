// 右パネルの「動き」の節（トランジションタブの中に出る）。
//
// ## なぜトランジションタブから出したか
//
// 同居していたが、**タブの頭のコメントは「頭・間・尻に置く帯」の話しかしておらず、
// 動きの話が1行も書かれていなかった**。中身も別の決まりごとで動いている:
//
//   ・付く相手はテロップだけ（映像クリップは拡大と位置しか焼けない）
//   ・置き方が違う。帯は**ドラッグして置く**が、動きは**クリックで付く**
//   ・Premiere から取り込んだ物に印が要る（💫 使える / 🔼 重ね用 / △ 一部 / ✕ 動きなし）
//
// 帯側が使う `list()` ヘルパは動き側では使わず、こちらのしぼり込み（q・showAll）は
// 帯側では使わない。共有している物が無かったので、節ごと持ってきた
// （2026-08-03。中身は変えていない。クラス名も1つも変えていない
//   ＝新しいクラス名を作ると e2e の数え上げが壊れる。過去に2回やらかしている）。
//
// ## 隠した数は必ず見せる
//
// 既定では「ちゃんと出る物」だけを並べる。当たり外れを引かせないため。
// ただし黙って減らすと「取り込めていない」に見えるので、隠した件数は常に出す。

import { useState, type JSX } from 'react'
import type { MotionPresetFile } from '../../../../shared/telopMotion'

export function MotionPresetList({
  accSec,
  builtinMotions,
  myMotions,
  motionPresets,
  onApplyMotionPreset,
  onDeleteMyMotion
}: {
  accSec: (
    tab: string,
    key: string,
    label: string,
    count: number | null,
    body: JSX.Element
  ) => JSX.Element
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
  // 実物で72個並ぶ。名前で絞れないと目で探すことになる
  const [q, setQ] = useState('')
  // **既定は「ちゃんと出る物」だけ。** 一部だけの物・動かない物が混ざっていると、
  // 選ぶたびに当たり外れを引くことになる。中身を見たいときだけ出す
  // （何が入っていたかを知りたい、という用途は残す）。
  const [showAll, setShowAll] = useState(false)
  const usable = (p: MotionPresetFile): boolean =>
    Object.keys(p.motion).length > 0 && !p.partial?.length
  const okCount = motionPresets.filter(usable).length
  const hit = (p: MotionPresetFile): boolean => !q || p.name.includes(q)
  // 標準と自分の物は、そもそも「一部だけ」が起きない（こちらで打った物なので）。
  // しぼり込みだけ効かせる
  const shownBuiltin = builtinMotions.filter(hit)
  const shownMine = myMotions.filter(hit)
  const shownImported = motionPresets.filter((p) => (showAll || usable(p)) && hit(p))
  // 写し取った動き。**強調と同じで「選んでいるテロップにクリックで付く」**。
  // 名前が 05.飛び出し のような演出名なので、置き場もここが合っている
  // （左のモーションタブは、付けたあと数値を詰める所）。
  return accSec('transition', 'motion', '💫 動き', shownBuiltin.length + shownMine.length + shownImported.length || null, (
    <>
      {/* **説明は1行に抑える。** パネルを細くすると、ここが伸びて一覧を
          画面の外へ押し出す（細い時に演出が1つも見えなくなっていた）。 */}
      <div className="tpl-hint">
        選択中のテロップに<b>クリックで適用</b>。量を変えたいときは左の「モーション」タブで。
      </div>
      <div className="mo-presets-bar">
        <input
          className="mo-find"
          placeholder="名前でしぼる"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {/* 取り込んだ物があるときだけ。**隠した数は必ず見せる**
            （黙って減らすと「取り込めていない」に見える） */}
        {motionPresets.length > 0 && (
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
        )}
      </div>

      {/* 最初から入っている物。**ここだけは必ず出る**（空の一覧を見せない） */}
      <div className="mo-group">標準</div>
      <div className="fx-list mo-preset-list">
        {shownBuiltin.map((p) => (
          <button
            key={p.name}
            className="fx-item mo-preset"
            title="この動きを付ける"
            onClick={() => onApplyMotionPreset(p)}
          >
            <span className="fx-ico">💫</span>
            <span className="fx-name">{p.name}</span>
          </button>
        ))}
      </div>

      {/* 自分で作って保存した物。**作り方の入口をここに書いておく**
          （保存する場所と使う場所が離れていると、あることに気づけない） */}
      <div className="mo-group">
        自分の動き
        <span className="mo-group-hint">
          テロップを選んで「モーション」タブで作り、そこで保存
        </span>
      </div>
      {shownMine.length === 0 ? (
        <div className="tpl-hint">まだありません。</div>
      ) : (
        <div className="fx-list mo-preset-list">
          {shownMine.map((p) => (
            <button
              key={p.name}
              className="fx-item mo-preset"
              title="この動きを付ける"
              onClick={() => onApplyMotionPreset(p)}
            >
              <span className="fx-ico">⭐</span>
              <span className="fx-name">{p.name}</span>
              <span
                className="mo-del"
                title="この動きを消す"
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteMyMotion(p.name)
                }}
              >
                ✕
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 取り込んだ物。**入っているときだけ出す。**
          取り込みは一度きりの作業で、しかも配布物には入らない物なので、
          入口を常に置くと、その分だけ標準の一覧が見えなくなる
          （入れ直すときはファイルメニューから）。 */}
      {motionPresets.length > 0 && (
        <>
          <div className="mo-group">
            取り込んだ動き
            <span className="mo-group-hint">配布物には入りません</span>
          </div>
          <div className="mo-legend">
            <span>💫 使える</span>
            <span>🔼 重ね用（単体だと消える）</span>
            {showAll && <span>△ 一部だけ</span>}
            {showAll && <span>✕ 動きなし</span>}
          </div>
          <div className="fx-list mo-preset-list">
            {shownImported.map((p) => {
              // 3通り: そのまま使える / 一部だけ / 動きが1つも取れなかった
              const none = Object.keys(p.motion).length === 0
              const part = !none && !!p.partial?.length
              const lack = p.partial?.length
                ? `（こちらに無い物: ${p.partial.join(' / ')}）`
                : ''
              // 2枚重ねの上側。単体だと最後に文字が消える（壊れているのではない）
              const pair = !none && p.endsHidden
              return (
                <button
                  key={p.name}
                  /* 取り込んだ物だと分かる印を付けておく（標準と同じ見た目だが、
                     数えるときに区別が要る＝自動チェックが「取り込みが効いたか」を
                     見られなくなる） */
                  className={`fx-item mo-preset mo-preset-imported ${none ? 'mo-preset-none' : part ? 'mo-preset-part' : ''}`}
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
        </>
      )}
    </>
  ))
}
