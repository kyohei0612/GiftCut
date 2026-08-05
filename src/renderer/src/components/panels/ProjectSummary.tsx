// 左パネルで**何も選んでいない時**に出す中身。
//
// ## なぜ作ったか
//
// ここは前まで「タイムラインでクリップを選択してください」の一行だけで、
// **幅250 × 高さ450 が常時死んでいた**（UI-UX-見直し.md 2-6）。
// プレビューの次に目に入る場所が、何も言わないまま画面の1/5を占めていた。
//
// ## 何を出すかの決め方（ここを間違えると重複が増える）
//
// **「他所に出ていない事」だけを出す。** 08-05 に下の帯から比率と再生ヘッドを
// 外したばかりなので、ここへ同じ物を並べたら**その日のうちに元へ戻す**ことになる。
//
//   比率        → 上の帯（16:9 / 9:16 / 1:1 のボタンがそのまま今の値）。出さない
//   再生ヘッド  → モニタ下のタイムコード。出さない
//   テロップ数  → 下の帯。出さない
//   **書き出しの中身** → **書き出しの窓を開くまで見えない。ここで出す**
//
// 書き出しの設定は「素材から自動で決まる」形にしてある（`ProjectDialogs` の頭）。
// 決められないぶん、**何が出るのかは常に見えているべき**で、いまは窓を開くまで
// 分からない。4K を読んだつもりが 1080p だった、は出来上がってから気づく類の事故。
//
// ## 配線は増やさない
//
// 受け取らず、囲いから自分で見に行く（CLAUDE.md「フックを1本足すとき、
// `useAppWiring` には書かない」）。この区画が要るのは書き出しの設定だけ。

import type { JSX } from 'react'
import { useExportCtx } from '../../state/exportContext'

const QUALITY_LABEL: Record<string, string> = {
  high: '高画質',
  med: '標準',
  low: '軽量'
}

export function ProjectSummary(): JSX.Element {
  const { exportOpts, fpsLabel, srcFpsForExport, resolveExportFps, setShowExportDialog } =
    useExportCtx()
  return (
    <div className="proj-sum">
      {/* **一行の案内は残す。** ここが空に見えるのは「壊れている？」に見えるため。
          ただし主役ではないので、下の書き出し要約より静かに置く */}
      <div className="proj-sum-lead">
        クリップを選ぶと、ここに設定（位置・大きさ・色・速さ）が出ます。
      </div>

      <div className="proj-sum-title">このまま書き出すと</div>
      <dl className="proj-sum-rows">
        <dt>解像度</dt>
        <dd>{exportOpts.resP}p</dd>
        <dt>フレームレート</dt>
        <dd>
          {exportOpts.fps === 'source'
            ? `素材と同じ（${fpsLabel(srcFpsForExport())}）`
            : `${fpsLabel(resolveExportFps())}`}
        </dd>
        <dt>画質</dt>
        <dd>{QUALITY_LABEL[exportOpts.quality] ?? exportOpts.quality}</dd>
      </dl>
      {/* **素材から自動で決まる**ことを言っておく。書けない欄を見せると
          「なぜ変えられないのか」を探して時間を落とす */}
      <div className="proj-sum-note">読み込んだ素材から自動で決まります。</div>
      <button className="btn small" onClick={() => setShowExportDialog(true)}>
        書き出しの設定を開く
      </button>
    </div>
  )
}
