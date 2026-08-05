// 一番下の帯。**いま何を選んでいて、どの道具で、どこを見ているか**を出す。
//
// 選んでいる物は「0個の種類は出さない」。全種類を並べて 0 を書くと、
// 実際に選んでいる物が数字の海に埋もれて、一目で分からなくなる。
//
// 別ウィンドウへ出したパネルもここに出す。出すと本体からは消えるので、
// どこへ行ったのか分からなくなる（真ん中のプレビュー以外はその場に案内も残らない）。
// 押せばそのまま本体へ戻せる。

import { useEffect, useState, type JSX } from 'react'
import { perf } from '../lib/perfMonitor'
import { useToastCtx } from '../state/toastContext'
import { issueUrl, summarize, type CrashInfo } from '../../../shared/crashReport'

/** 報告の出し先。**公開リポジトリなので中継役が要らない** */
const REPO = 'kyohei0612/GiftCut'

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

/**
 * 測っている物をファイルへ書き出す。
 *
 * **どこへ出したかを必ず言う。** 場所を言わないと、押した人は
 * 「押したけど何も起きなかった」と思う（スクショで実際にそうなっていた）。
 * 書けなかったときも黙らない——黙ると、知らせる口があること自体が信用されなくなる。
 */
async function savePerf(showToast: (m: string, kind?: 'success' | 'error') => void): Promise<void> {
  try {
    const r = await window.giftcut?.savePerfReport?.(perf.report(), true)
    if (r?.ok) showToast('測定を書き出しました:\n' + (r.path ?? 'ダウンロード'), 'success')
    else showToast('測定を書き出せませんでした: ' + (r?.error ?? '理由不明'), 'error')
  } catch (e) {
    showToast('測定を書き出せませんでした: ' + String(e), 'error')
  }
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
  shuttleRate,
  poppedPanes,
  autosaveNg,
  appVersion,
  onDock
}: {
  telopCount: number
  selection: SelectionCounts
  tool: string
  /** 早送り・巻き戻しの倍率（0＝ふつう）。**他所に出ないのでここに残す** */
  shuttleRate: number
  /** 別ウィンドウへ出しているパネル */
  poppedPanes: { id: string; label: string }[]
  /** 下書き（自動保存）が書けていない。**消える通知だけにしない**ための常時表示 */
  autosaveNg?: boolean
  /** いま動いている本体の版。名前の横に出す（新旧の取り違えを一目で分かるように） */
  appVersion?: string
  onDock: (id: string) => void
}): JSX.Element {
  // **受け取らず自分で見に行く。** 出すのは「書き出せたか」の一言だけなので、
  // 心臓の配線を1本増やす価値が無い（品書き＝AppMenus と同じ流儀）
  const { showToast } = useToastCtx()

  /**
   * 前回が正常に終わっていなければ、**押せる案内**を出す。
   *
   * 起動時のトーストは消えるので、席を外していると誰も気づかない。
   * 落ちたことは**消えない場所**に残す必要がある（自動保存の警告と同じ理由で、
   * この帯の役目）。ここも受け取らず自分で見に行く。
   */
  const [crash, setCrash] = useState<CrashInfo | null>(null)
  useEffect(() => {
    void (async () => {
      const info = await window.giftcut?.lastCrash?.()
      if (info?.crashed) setCrash(info)
    })()
  }, [])

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
      {/* **前回が正常に終わっていない。** 自動保存の警告と並べる——
          どちらも「消えると誰も気づかない」類で、この帯の役目。
          押すと GitHub の issue が**中身入りで開く**だけで、送信はしない。
          何が入っているかは本文に書いてあるので、読んでから決められる
          （何を入れて何を入れないかは shared/crashReport） */}
      {crash && (
        <button
          className="status-ng status-crash"
          title={`${summarize(crash)}\n押すと報告の下書きがブラウザで開きます（送信はしません）`}
          onClick={() => window.open(issueUrl(crash, appVersion ?? '不明', REPO), '_blank')}
        >
          ⚠ 前回落ちました（報告する）
        </button>
      )}
      <span>{telopCount ? `${telopCount} テロップ` : 'テロップなし'}</span>
      <span>選択: {selectionSummary(selection)}</span>
      <span>ツール: {TOOL_LABEL[tool] ?? tool}</span>
      {/* **比率と再生ヘッドの時刻は、ここには出さない**（2026-08-05）。
          どちらも本来の置き場がある:

            比率        … 上の帯の 16:9 / 9:16 / 1:1（**選ぶ所がそのまま今の値**）
            再生ヘッド  … モニタ下のタイムコード（プレミアもそこ）

          2か所に出すと、**片方が古くなる**か、目が散って両方読まなくなる。
          この帯の役目は「**他所に出ていない事**（選択・ツール・別窓・版）」だけにする。
          シャトルの倍率がここに残っているのは、それが他のどこにも出ないため。 */}
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
      {/* **不具合を知らせるための口。**
          測るのは起動した瞬間からずっと走っている（`useDiagnostics`）。
          足りなかったのは**押せる場所**だけ——Ctrl+Shift+P は知らないと辿り着けず、
          5分ごとの自動書き出しは `userData/perf` にあって場所を説明するのが面倒。
          「重い」「カクつく」と思った瞬間に押せば、**その前の分がそのまま**出る。
          出し先はダウンロード（そのまま渡せる場所。確認の窓も出さない）。 */}
      <button
        // **`status-pop` を使い回さない。** あちらは「別ウィンドウへ出した区画を戻す」
        // チップで、数を数えている所がある（数えた側が壊れる）。役目が違う物には別の名前。
        className="status-perf"
        title={
          'いま測っている物をファイルに書き出します（ダウンロードへ）。\n' +
          '重い・カクつく・落ちた、を知らせるときに押してください。\n' +
          '押した時点より前の分も入っています（起動から測り続けています）。'
        }
        onClick={() => void savePerf(showToast)}
      >
        📈 測定を書き出す
      </button>
      {/* **いま動いている版。** 自動更新は黙って入れ替わるので、
          「直したはずが直っていない」と言われたときに、まずここを見れば
          新旧の取り違えかどうかが分かる。名前と並べて常に見える所に置く。 */}
      <span title={appVersion ? `GiftCut ${appVersion}` : 'GiftCut'}>
        GiftCut{appVersion ? ` v${appVersion}` : ''}
      </span>
    </footer>
  )
}
