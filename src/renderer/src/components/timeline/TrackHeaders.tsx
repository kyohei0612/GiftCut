// タイムライン左端の段（トラック）の見出し列。
//
// 段の番号は絶対に見せる。名前は入るぶんだけ。
// 以前は「V…」「A1 音…」と切れて、**どれが V2 でどれが V3 かも分からなかった**。
// 番号と名前を分け、番号は縮まないようにしてある。
//
// クリック＝その段を選ぶ、ダブルクリック＝名前を変える。
// （以前ここは「ターゲット切替」だったが、その印はどこからも参照されない
//   死んだ設定で、名前クリックがそれに占領されて名前を変えられなかった）
//
// 縦スクロールへの追従について。
// 段の並びは `th-body` にまとめてある。タイムラインを縦に送ったとき、
// 呼ぶ側がこの入れ物を同じ量だけ上へずらす（transform）。
// **上の `th-spacer` は動かさない**。目盛り（ruler）が貼り付いて残るので、
// その相手として同じ高さのまま居座らせる。
// ここを分けずに列ごと動かすと、目盛りの高さぶん見出しがずれる。

import type { JSX, Ref } from 'react'

export interface HeaderTrack {
  id: string
  name: string
  kind: 'video' | 'audio'
}

export interface HeaderState {
  locked?: boolean
  hidden?: boolean
  muted?: boolean
  solo?: boolean
}

export function TrackHeaders({
  tracks,
  stateOf,
  selectedId,
  heightOf,
  padTop,
  padBottom,
  bgmTrackId,
  bodyRef,
  onResizeStart,
  onSelect,
  onRename,
  onToggle,
  onAddVideoTrack,
  onAddAudioTrack,
  onAddBgm,
  onResetLaneH
}: {
  tracks: HeaderTrack[]
  stateOf: (id: string) => HeaderState
  selectedId: string | null
  /** 段の高さ。段の id を渡す（段ごとに変えられる） */
  heightOf: (trackId: string) => number
  /** 段の上下に置く余白。トラック側と必ず同じ値にする
   *  （ずれると、押した段と実際の段が食い違う） */
  padTop: number
  padBottom: number
  /** 「♪＋」を出す段（BGM を足す入口） */
  bgmTrackId: string
  /** 縦スクロールに追従させるための入れ物への参照（呼ぶ側が transform で動かす） */
  bodyRef?: Ref<HTMLDivElement>
  /**
   * 段の下の境目を掴んで高さを変える。
   *
   * **既定は「掴んだ段だけ」**（trackId を渡す）。波形を1本だけ大きく見たい、が
   * ほとんどで、まとめて太ると画面が足りなくなる。
   * Shift を押しながらなら trackId を渡さず、同じ種類をまとめて変える（従来の動き）。
   *
   * @param above その境目より上に、同じ種類の段がいくつあるか（1から数える）。
   *              まとめて変えるとき、掴んだ線をカーソルに追従させるのに要る。
   */
  onResizeStart?: (
    kind: 'video' | 'audio',
    above: number,
    e: React.PointerEvent,
    trackId?: string
  ) => void
  onSelect: (id: string) => void
  onRename: (id: string, current: string) => void
  onToggle: (id: string, key: 'locked' | 'hidden' | 'muted' | 'solo') => void
  onAddVideoTrack: () => void
  onAddAudioTrack: () => void
  onAddBgm: () => void
  /** 段の高さを既定へ戻す（保存してある物を捨てる） */
  onResetLaneH: () => void
}): JSX.Element {
  return (
    <div className="track-headers">
      <div className="th-spacer">
        <button className="th-add" title="映像トラックを追加" onClick={onAddVideoTrack}>
          ＋
        </button>
        {/* **高さを既定へ戻す口。**
            段の高さは1つずつ覚えているので、既定を変えても
            **前に触ったことのある人の画面は前のまま**になる。
            黙って書き換えると、その太さに慣れた人の画面が理由もなく変わるので、
            戻すかどうかは本人に決めてもらう（`やること.md` の「段」で決めた形）。 */}
        <button className="th-add" title="段の高さを既定へ戻す" onClick={onResetLaneH}>
          ⤒
        </button>
      </div>
      <div className="th-body" ref={bodyRef}>
        <div className="track-pad" style={{ height: padTop }} />
        {tracks.map((tr, i) => {
          const st = stateOf(tr.id)
          // その段の下の境目より上に、同じ種類の段がいくつあるか（1から数える）。
          // 掴んだ線をカーソルに追従させるのに要る。
          const above = tracks.slice(0, i + 1).filter((t) => t.kind === tr.kind).length
          return (
            <div
              key={tr.id}
              className={`th th-${tr.kind} ${selectedId === tr.id ? 'th-selected' : ''}`}
              style={{ height: heightOf(tr.id) }}
              onClick={() => onSelect(tr.id)}
              title="クリックでトラック選択（Deleteで削除）"
            >
              <span
                className="th-name"
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect(tr.id)
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  onRename(tr.id, tr.name)
                }}
                title={`${tr.name}（クリックでトラック選択 / ダブルクリックで名前を変更）`}
              >
                <b className="th-id">{tr.id}</b>
                {tr.name !== tr.id && (
                  <span className="th-label">
                    {tr.name.replace(new RegExp(`^${tr.id}\\s*`), '')}
                  </span>
                )}
              </span>
              <span className="th-icons" onClick={(e) => e.stopPropagation()}>
                <button
                  className={`th-btn ${st.locked ? 'th-on' : ''}`}
                  title="ロック"
                  onClick={() => onToggle(tr.id, 'locked')}
                >
                  {st.locked ? '🔒' : '🔓'}
                </button>
                {/* ---- ここから先は**列（役割）が固定。どの段も必ず4枠** ----
                  *
                  *   映像  1:🔒  2:👁      3:空き  4:空き
                  *   音声  1:🔒  2:M       3:S     4:♪＋（BGMの段）／空き
                  *
                  * **枠の数が違うと、右揃えのぶんだけ位置がずれる。**
                  * 2026-08-05 に画面を4倍にして測ったら、V は4枠・A1/A2 は3枠・
                  * A3（♪＋あり）は4枠で、**A1/A2 だけ 20px 右へずれ、A3 だけ
                  * 偶然 V と揃っていた**。揃える意図は前から書いてあったのに、
                  * **映像側にだけ空きを置いて音声側に置いていなかった**——片方だけ直した型。
                  *
                  * ## 空きは**後ろ**へ寄せる（2026-08-06・本人の指定）
                  *
                  * 前は 2列目を「👁／♪＋／空き」で分け合わせていた。数は揃ったが、
                  * **A1・A2 は 2列目が空きなので、🔒 と M の間に穴が開く**。
                  * 映像は 🔒👁 が隣り合っているのに、音声だけ離れて見えた
                  * ——「オーディオのUIが違う」。
                  *
                  * 押す物を前から詰めて、空きを後ろへ回すと、
                  * **どの段も左端から隙間なく並ぶ**。よく押す 🔒 / M / S が
                  * 全段で揃うことは、そのまま保たれる（1・2・3列目）。
                  *
                  * ♪＋ を最後に置けるのは、**押す頻度がいちばん低い**から
                  * （BGM を足すのは編集の最初に一度）。 */}
                {tr.kind === 'video' ? (
                  <>
                    <button
                      className={`th-btn ${st.hidden ? 'th-off' : ''}`}
                      title="表示/非表示"
                      onClick={() => onToggle(tr.id, 'hidden')}
                    >
                      {st.hidden ? '🙈' : '👁'}
                    </button>
                    <span className="th-ms th-ms-blank" aria-hidden="true" />
                    <span className="th-ms th-ms-blank" aria-hidden="true" />
                  </>
                ) : (
                  <>
                    <button
                      className={`th-ms ${st.muted ? 'th-mute' : ''}`}
                      title="ミュート"
                      onClick={() => onToggle(tr.id, 'muted')}
                    >
                      M
                    </button>
                    <button
                      className={`th-ms ${st.solo ? 'th-solo' : ''}`}
                      title="ソロ"
                      onClick={() => onToggle(tr.id, 'solo')}
                    >
                      S
                    </button>
                    {tr.id === bgmTrackId ? (
                      <button
                        className="th-btn th-bgm-add"
                        title="このトラックに音声ファイル（BGM等）を追加"
                        onClick={onAddBgm}
                      >
                        ♪＋
                      </button>
                    ) : (
                      <span className="th-btn th-ms-blank" aria-hidden="true" />
                    )}
                  </>
                )}
              </span>
              {/* 段の下の境目。**ここを掴んで高さを変える**（プレミアと同じ）。
                  以前は左端に丸の列を置いていたが、縦に送ると枠の外へ出て消え、
                  掴んだ丸と実際の境目が離れることもあった。
                  境目は見出しと一緒に動くので、**見えている段の境目は必ず掴める**。 */}
              {onResizeStart && (
                <div
                  className="th-divider"
                  title="上下にドラッグでこの段の高さを変える（Shiftで同じ種類をまとめて）"
                  onPointerDown={(e) => {
                    e.stopPropagation() // 段を選ぶ動作にしない
                    // **既定は掴んだ段だけ。** まとめて変えたい時だけ Shift。
                    // 波形を1本だけ見たいことの方が多く、巻き添えで太ると画面が足りない
                    onResizeStart(tr.kind, above, e, e.shiftKey ? undefined : tr.id)
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
            </div>
          )
        })}
        <button
          className="th-add th-add-audio"
          title="音声トラックを追加"
          onClick={onAddAudioTrack}
        >
          ＋
        </button>
        <div className="track-pad" style={{ height: padBottom }} />
      </div>
    </div>
  )
}
