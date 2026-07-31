// 一番下の帯。**いま何を選んでいて、どの道具で、どこを見ているか**を出す。
//
// 選んでいる物は「0個の種類は出さない」。全種類を並べて 0 を書くと、
// 実際に選んでいる物が数字の海に埋もれて、一目で分からなくなる。
//
// 別ウィンドウへ出したパネルもここに出す。出すと本体からは消えるので、
// どこへ行ったのか分からなくなる（真ん中のプレビュー以外はその場に案内も残らない）。
// 押せばそのまま本体へ戻せる。

import type { JSX } from 'react'

export interface SelectionCounts {
  telop: number
  video: number
  audio: number
  se: number
  image: number
  vclip: number
  trans: boolean
  telopTrans: boolean
  marker: boolean
  track: string | null
}

const TOOL_LABEL: Record<string, string> = {
  select: '選択',
  razor: 'レザー',
  trackFwd: 'トラック選択(右)',
  trackBack: 'トラック選択(左)'
}

/** 選んでいる物を「テロップ2 / 画像1個」のような一行にする（0の種類は出さない） */
export function selectionSummary(s: SelectionCounts): string {
  return (
    [
      s.telop ? `テロップ${s.telop}` : '',
      s.video ? `動画${s.video}` : '',
      s.audio ? `音声${s.audio}` : '',
      s.se ? `SE/BGM${s.se}` : '',
      s.image ? `画像${s.image}個` : '',
      s.vclip ? `映像レイヤー${s.vclip}個` : '',
      s.trans ? 'トランジション' : '',
      s.telopTrans ? 'テロップアニメ' : '',
      s.marker ? 'マーカー1個' : '',
      s.track ? `トラック(${s.track})` : ''
    ]
      .filter(Boolean)
      .join(' / ') || 'なし'
  )
}

export function StatusBar({
  telopCount,
  selection,
  tool,
  ratio,
  playhead,
  shuttleRate,
  poppedPanes,
  autosaveNg,
  appVersion,
  onDock
}: {
  telopCount: number
  selection: SelectionCounts
  tool: string
  ratio: string
  /** 再生ヘッドの時刻（表示用の文字） */
  playhead: string
  /** 早送り・巻き戻しの倍率（0＝ふつう） */
  shuttleRate: number
  /** 別ウィンドウへ出しているパネル */
  poppedPanes: { id: string; label: string }[]
  /** 下書き（自動保存）が書けていない。**消える通知だけにしない**ための常時表示 */
  autosaveNg?: boolean
  /** いま動いている本体の版。名前の横に出す（新旧の取り違えを一目で分かるように） */
  appVersion?: string
  onDock: (id: string) => void
}): JSX.Element {
  return (
    <footer className="statusbar">
      {/* 落ちたときの備えが効いていない、というのは一番先に知りたいこと。
          一番左に、消えない形で出す */}
      {autosaveNg && (
        <span
          className="status-ng"
          title={
            '落ちたときに戻すための下書きが書けていません。\n' +
            'ディスクの空き・書き込みの許可（ウイルス対策ソフト）を確かめてください。\n' +
            'いまの内容は Ctrl+S で保存してください。'
          }
        >
          ⚠ 自動保存できていません
        </span>
      )}
      <span>{telopCount ? `${telopCount} テロップ` : 'テロップなし'}</span>
      <span>選択: {selectionSummary(selection)}</span>
      <span>ツール: {TOOL_LABEL[tool] ?? tool}</span>
      <span>比率 {ratio}</span>
      <span>再生ヘッド {playhead}</span>
      {shuttleRate !== 0 && <span>シャトル {shuttleRate}x</span>}
      <span className="grow" />
      {poppedPanes.map((p) => (
        <button
          key={p.id}
          className="status-pop"
          title={`${p.label} を本体へ戻す`}
          onClick={() => onDock(p.id)}
        >
          ⧉ {p.label}
        </button>
      ))}
      {/* **いま動いている版。** 自動更新は黙って入れ替わるので、
          「直したはずが直っていない」と言われたときに、まずここを見れば
          新旧の取り違えかどうかが分かる。名前と並べて常に見える所に置く。 */}
      <span title={appVersion ? `GiftCut ${appVersion}` : 'GiftCut'}>
        GiftCut{appVersion ? ` v${appVersion}` : ''}
      </span>
    </footer>
  )
}
