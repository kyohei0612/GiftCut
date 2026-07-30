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
  onAddBgm
}: {
  tracks: HeaderTrack[]
  stateOf: (id: string) => HeaderState
  selectedId: string | null
  heightOf: (kind: 'video' | 'audio') => number
  /** 段の上下に置く余白。トラック側と必ず同じ値にする
   *  （ずれると、押した段と実際の段が食い違う） */
  padTop: number
  padBottom: number
  /** 「♪＋」を出す段（BGM を足す入口） */
  bgmTrackId: string
  /** 縦スクロールに追従させるための入れ物への参照（呼ぶ側が transform で動かす） */
  bodyRef?: Ref<HTMLDivElement>
  /**
   * 段の下の境目を掴んで高さを変える（プレミアと同じ操作）。
   *
   * @param kind その境目より上の段の種類。映像なら映像レーン全体、
   *             音声なら音声レーン全体がまとめて変わる（プレミアの挙動）
   * @param above その境目より上に、同じ種類の段がいくつあるか（1から数える）。
   *              掴んだ線をカーソルに追従させるのに要る。渡し忘れると、
   *              掴んだ場所と線が離れていく
   */
  onResizeStart?: (kind: 'video' | 'audio', above: number, e: React.PointerEvent) => void
  onSelect: (id: string) => void
  onRename: (id: string, current: string) => void
  onToggle: (id: string, key: 'locked' | 'hidden' | 'muted' | 'solo') => void
  onAddVideoTrack: () => void
  onAddAudioTrack: () => void
  onAddBgm: () => void
}): JSX.Element {
  return (
    <div className="track-headers">
      <div className="th-spacer">
        <button className="th-add" title="映像トラックを追加" onClick={onAddVideoTrack}>
          ＋
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
              style={{ height: heightOf(tr.kind) }}
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
                {tr.kind === 'video' ? (
                  <>
                    <button
                      className={`th-btn ${st.hidden ? 'th-off' : ''}`}
                      title="表示/非表示"
                      onClick={() => onToggle(tr.id, 'hidden')}
                    >
                      {st.hidden ? '🙈' : '👁'}
                    </button>
                    {/* 映像には M/S が無いが、空きを置いて列を揃える。
                      揃っていないと、段によってボタンの位置がずれて毎回探すことになる。 */}
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
                    {tr.id === bgmTrackId && (
                      <button
                        className="th-ms th-bgm-add"
                        title="このトラックに音声ファイル（BGM等）を追加"
                        onClick={onAddBgm}
                      >
                        ♪＋
                      </button>
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
                  title={
                    tr.kind === 'video'
                      ? '上下にドラッグで映像レーンの高さを変える'
                      : '上下にドラッグで音声レーンの高さを変える'
                  }
                  onPointerDown={(e) => {
                    e.stopPropagation() // 段を選ぶ動作にしない
                    onResizeStart(tr.kind, above, e)
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
