// タイムライン左端の段（トラック）の見出し列。
//
// 段の番号は絶対に見せる。名前は入るぶんだけ。
// 以前は「V…」「A1 音…」と切れて、**どれが V2 でどれが V3 かも分からなかった**。
// 番号と名前を分け、番号は縮まないようにしてある。
//
// クリック＝その段を選ぶ、ダブルクリック＝名前を変える。
// （以前ここは「ターゲット切替」だったが、その印はどこからも参照されない
//   死んだ設定で、名前クリックがそれに占領されて名前を変えられなかった）

import type { JSX } from 'react'

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
      <div className="track-pad" style={{ height: padTop }} />
      {tracks.map((tr) => {
        const st = stateOf(tr.id)
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
          </div>
        )
      })}
      <button className="th-add th-add-audio" title="音声トラックを追加" onClick={onAddAudioTrack}>
        ＋
      </button>
      <div className="track-pad" style={{ height: padBottom }} />
    </div>
  )
}
