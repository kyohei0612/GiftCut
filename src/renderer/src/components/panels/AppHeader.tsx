// 画面のいちばん上。アプリの更新の帯と、ファイル/編集などのメニューバー。
//
// ## 更新は「何が起きるか」を先に出す
//
// 再起動は勝手にやるが、黙って落ちると壊れたように見える。細い帯で先に知らせる。
// 作業の邪魔をしないよう、覆いではなく帯にしてある。
//
// ## メニューは押した所しか開かない
//
// 開いている間にどこかを押したら閉じる。Escape でも閉じる。
// **閉じられないと裏が押せなくなる**（見出しをもう一度押す動きは「開く」ではなく
// 「閉じる」なので、閉じたつもりで押すと開かない、という分かりにくい形で出る）。
//
// ## 音量そろえと画面比はここに置いてある
//
// どちらも「書き出しの結果が変わる」設定なので、作業中に触る物とは離してある。

import { useAppChromeCtx } from '../../state/appChromeContext'
import { useShortcutPrefsCtx } from '../../state/shortcutPrefsContext'
import { useLibraryCtx } from '../../state/libraryContext'
import { useHeader } from '../../state/headerContext'
import type { JSX } from 'react'
import { MenuBar } from '../MenuBar'
import { formatCombo } from '../../../../shared/shortcuts'
import { useToastCtx } from '../../state/toastContext'
import { useExportCtx } from '../../state/exportContext'
import { useProjectStateCtx } from '../../state/projectStateContext'
import { useDoc } from '../../state/contentContext'
import { useSel } from '../../state/selectionContext'
import { InstallingScreen } from './InstallingScreen'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface AppHeaderProps {
  [k: string]: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function AppHeader(): JSX.Element {
  // **受け取らず、心臓から自分で見に行く**（区画・品書きと同じ流儀）
  const {
    shortcuts, appVersion,
    unsaved, saveProjectFn, openProjectFn, packProjectFn, openPackFn, saveAsTemplateFn,
    openTemplateFn, handleAppendVideo, handleReplaceVideo, handleImportSrt, exportSrtFn,
    refreshPresets, setSubtitleOpen, openExportDialog, addTelop, changeRatio, projectPath
  } = useHeader()
  // **配線を通さず、元の心臓を直に見に行く**（2026-08-04。npm run passthrough）
  const { updateState, setUpdateState } = useAppChromeCtx()
  const { fileMenuOpen, setFileMenuOpen, setPrefsOpen } = useShortcutPrefsCtx()
  const { importMotionPresets, refreshSE, refreshMotionPresets } = useLibraryCtx()
  const { showToast } = useToastCtx()
  const { ratio, loudnormLUFS, setLoudnormLUFS } = useExportCtx()
  const { recentProjects, newTelopStyle, setNewTelopStyle } = useProjectStateCtx()
  const { cues, setCues } = useDoc()
  const { selectedIds } = useSel()
  /**
   * 書字方向を切り替える。
   *
   * **次に作る物と、いま選んでいる物の両方に当てる。** 向きは作ってから決めることが
   * 多く、選んで押せないと作り直す羽目になる。選んでいなければ既定だけ変える。
   */
  const setTelopVertical = (v: boolean): void => {
    setNewTelopStyle((s: typeof newTelopStyle) => ({ ...s, vertical: v }))
    if (!selectedIds.length) return
    setCues((prev) =>
      prev.map((c) =>
        selectedIds.includes(c.id) ? { ...c, style: { ...c.style, vertical: v } } : c
      )
    )
  }
  void cues
  return (
    <>
  {/* アプリの更新。作業の邪魔をしない細い帯で出す。
      **こちらから再起動を促さない**（2026-08-02 に変更）。落とし終わったことを
      伝えるだけで、当てるのは本人が閉じたとき。待てない人のために
      「今すぐ更新して再起動」は置くが、押されたときだけ動く。 */}
  {/* **入れ替え中は全画面にする**（2026-08-06）。細い帯にしないのは2つ理由がある:
      ・ここから先はインストーラの仕事で、**触っても何もできない**。
        触れる見た目のまま置くと、押しても反応しない画面を触らせることになる
      ・押した直後から十数秒、何も起きないように見える。今日 e2e で
        「固まってる」と言われたのと同じ型——**動いているのに見えていない**

      **進み具合の数字は出せない。** NSIS が黙って入れ替えるので、
      何%終わったかを返してこない（`shared/updateState.ts` に理由）。
      出せるのは経過秒だけなので、それを出して「進んでいる」ことを見せる。 */}
  {updateState?.phase === 'installing' && <InstallingScreen />}
  {/* **更新が当たった後の最初の起動で、一度だけ言う**（2026-08-06・本人の指摘）。
      「なんか一回ロード挟んで起動したりする」——アプリが消えて戻ってくるのに、
      戻ってきた側が何も言わないので、**何のための間だったのか分からない**。
      待ちは減らせないが、**何だったのかは説明できる**。 */}
  {updateState?.phase === 'updated' && (
    <div className="update-bar update-bar-done">
      <span>✨ 新しくなりました（v{updateState.version}）</span>
      <button
        className="update-btn update-btn-ghost"
        onClick={() => setUpdateState(null)}
      >
        閉じる
      </button>
    </div>
  )}
  {(updateState?.phase === 'downloading' || updateState?.phase === 'ready') && (
    <div className="update-bar">
      {updateState.phase === 'downloading' ? (
        // **割合だけでなく実数（MB）も出す。**「45%」だけだと、あと何秒なのか・
        // そもそも大きい物なのかが分からない。何MB中の何MBかが見えれば、
        // 待てるかどうかを本人が決められる
        <span>
          ⬇ 新しい GiftCut を用意しています… {updateState.percent}%
          {updateState.totalMB > 0 && `（${updateState.doneMB} / ${updateState.totalMB} MB）`}
        </span>
      ) : (
        <>
          <span>✨ {updateState.message}</span>
          {/* 待てない人のための道。**押されたときだけ動く**ので、
              放っておけば作業は一切邪魔されない */}
          {/* **押すと何が起きるかを、押す前に言う**（2026-08-06）。
              押すと「閉じる → 入れ替え（十数秒・画面には何も出ない）→ 開き直す」。
              入れ替えはアプリが終了してからでないと始められない
              （動いている実行ファイルは上書きできない）ので、この待ちは減らせない。

              **普通に閉じれば待ち時間はゼロ**——閉じた後に当たるので、
              こちらはもう離席している。急がないなら押さないのが一番速い。 */}
          {/* **待ち時間が2通りある**（2026-08-06）。JS だけの更新なら
              インストーラを走らせないので、閉じて開くだけ＝数秒で戻ってくる。
              ffmpeg や Electron が変わった版は、いままでどおり十数秒かかる。
              どちらかは押す前にしか選べないので、**ボタンに書く**。 */}
          <button
            className="update-btn"
            title={
              updateState.viaBundle
                ? '押すと、いったん閉じて開き直します（数秒）。\n' +
                  '中身は用意できているので、入れ替えの待ちはありません。'
                : '押すと、いったん閉じて入れ替えます（十数秒かかり、その間は画面に何も出ません）。\n' +
                  '急がないなら押さなくて大丈夫です——**普通に閉じたときに自動で当たります**。'
            }
            onClick={() => window.giftcut.updateNow()}
          >
            {updateState.viaBundle ? '今すぐ更新して再起動（数秒）' : '今すぐ更新して再起動（十数秒）'}
          </button>
          <button
            className="update-btn update-btn-ghost"
            onClick={() => {
              window.giftcut.updateLater()
              setUpdateState(null)
            }}
          >
            閉じる
          </button>
        </>
      )}
    </div>
  )}
  {/* 一番上のメニューは components/MenuBar.tsx。ここでは並べる物だけを書く。
      置くのは「パネルからは届かない操作」だけ（素材の追加・SRT読込・書き出しは
      プロジェクトパネルとモードバーでできるので出さない）。 */}
  <MenuBar
    open={fileMenuOpen}
    onToggle={() => setFileMenuOpen((o: boolean) => !o)}
    rows={[
      {
        kind: 'item',
        label: 'プロジェクトを開く…　(Ctrl+O)',
        onClick: () => {
          setFileMenuOpen(false)
          void openProjectFn()
        }
      },
      // 最近使ったプロジェクト。保存先を覚えていなくてもここから開ける
      recentProjects.length > 0 && { kind: 'label', label: '最近使ったプロジェクト' },
      ...recentProjects.map(
        (r) =>
          ({
            kind: 'recent',
            label: r.name,
            title: r.path,
            onClick: () => {
              setFileMenuOpen(false)
              void openProjectFn(r.path)
            }
          }) as const
      ),
      recentProjects.length > 0 && { kind: 'sep' },
      {
        kind: 'item',
        label: `${projectPath ? 'プロジェクトを保存' : 'プロジェクトを保存…'}　(${formatCombo(shortcuts.saveProject)})`,
        title: projectPath ? `上書き保存: ${projectPath}` : '保存先を選んで保存します',
        onClick: () => {
          setFileMenuOpen(false)
          void saveProjectFn()
        }
      },
      {
        kind: 'item',
        label: '別名で保存…',
        onClick: () => {
          setFileMenuOpen(false)
          void saveProjectFn(true)
        }
      },
      { kind: 'sep' },
      // 別PCへ渡す用。プロジェクトだけ渡しても素材が無ければ開けない
      {
        kind: 'item',
        label: '素材ごとまとめて書き出す…（ZIP）',
        title:
          '使っている素材を全部入れた ZIP を作ります。別のPCの GiftCut で開けば続きから編集できます',
        onClick: () => {
          setFileMenuOpen(false)
          void packProjectFn()
        }
      },
      {
        kind: 'item',
        label: 'まとめたプロジェクトを開く…（ZIP）',
        title:
          'まとめた ZIP を展開して開きます（素材はドキュメント/GiftCut/受け取ったプロジェクト に置きます）',
        onClick: () => {
          setFileMenuOpen(false)
          void openPackFn()
        }
      },
      { kind: 'sep' },
      {
        kind: 'item',
        label: 'テンプレートとして保存…',
        onClick: () => {
          setFileMenuOpen(false)
          saveAsTemplateFn()
        }
      },
      {
        kind: 'item',
        label: 'テンプレートを開く…',
        onClick: () => {
          setFileMenuOpen(false)
          void openTemplateFn()
        }
      },
      { kind: 'sep' },
      {
        kind: 'item',
        label: '動画をタイムライン末尾に置く…',
        title: '選んだ動画をタイムラインのいちばん後ろに置きます',
        onClick: () => {
          setFileMenuOpen(false)
          void handleAppendVideo()
        }
      },
      {
        kind: 'item',
        label: '動画を差し替え…',
        title: '現在のカットを破棄して別の動画に置き換えます',
        onClick: () => {
          setFileMenuOpen(false)
          void handleReplaceVideo()
        }
      },
      {
        kind: 'item',
        label: 'SRT を書き出し…',
        onClick: () => {
          setFileMenuOpen(false)
          void exportSrtFn()
        }
      },
      // 動きの取り込みは**一度きり**の作業なので、見本帳の中には置かない。
      // 常に見える所に置くと、細いパネルでは一覧の場所を食うだけになる
      // （実際に、幅を詰めると演出が1つも見えなくなっていた）。
      {
        kind: 'item',
        label: 'Premiere の動きを取り込む…',
        title: '.prfpset を読んで、中の動きを「トランジション → 動き」に並べます',
        onClick: () => {
          setFileMenuOpen(false)
          importMotionPresets()
        }
      },
      { kind: 'sep' },
      // 更新で消えない置き場。**更新はアプリ本体を丸ごと入れ替える**が、
      // ここ（%APPDATA%\GiftCut\）の下は触られない。自分で足した素材の
      // 置き場所であり、退避も引っ越しもここを開ければできる。
      // **ZIP を選ぶだけで済ませる。**
      // 「開いて・展開して・貼る」は手順が3つあり、どれか1つ間違えると
      // 素材が出てこない。しかも間違いに気づけない（何も起きないだけ）。
      { kind: 'label', label: '素材を入れる' },
      {
        kind: 'item',
        label: '素材パック（ZIP）を取り込む…（展開しなくて OK）',
        title:
          'SE・テロップ素材・動き・テンプレートが入った ZIP を選ぶだけで、' +
          '展開して置き場へ入れ、そのまま使えるようにします（更新しても消えません）',
        onClick: () => {
          setFileMenuOpen(false)
          void window.giftcut
            .importAssetZip()
            .then((r) => {
              if (r?.canceled) return
              if (!r?.ok) {
                showToast(`取り込めませんでした。\n${r?.error ?? ''}`)
                return
              }
              const n = Object.entries(r.added ?? {})
                .map(([k, v]) => `${k} ${v}件`)
                .join(' / ')
              // **その場で全部読み直す。** 「入れました」と言われたのに
              // 一覧が変わらないと、入ったのかどうか分からない。
              // 種類を1つでも読み飛ばすと、そこだけ再起動するまで出てこない。
              //（テンプレートは開くときに読むので、ここでは要らない）
              refreshSE()
              refreshPresets()
              refreshMotionPresets()
              showToast(`素材を取り込みました（${n}）。そのまま使えます。`)
            })
            .catch((e) => showToast(`取り込めませんでした。\n${String(e)}`))
        }
      },
      { kind: 'sep' },
      { kind: 'label', label: '置き場を開く（更新しても消えません）' },
      ...(
        [
          ['se', '効果音（SE）', '自分で足した効果音の置き場'],
          ['telop', 'テロップ素材', '自分で足したテロップ素材の置き場'],
          ['motion', '動きのプリセット', '取り込んだ動き（.prfpset から写した物）の置き場'],
          ['template', 'テンプレート', 'テンプレートとして保存した物の置き場'],
          ['data', '設定・保存データ', '設定・自動保存の下書き・プロキシの置き場']
        ] as const
      ).map(
        ([key, label, title]) =>
          ({
            kind: 'item',
            label: `${label}のフォルダを開く`,
            title,
            onClick: () => {
              setFileMenuOpen(false)
              void window.giftcut.openFolder(key).then((r) => {
                if (!r?.ok) showToast(`フォルダを開けませんでした。\n${r?.error ?? ''}`)
              })
            }
          }) as const
      ),
      { kind: 'sep' },
      {
        kind: 'item',
        label: '環境設定（ショートカット）…',
        onClick: () => {
          setFileMenuOpen(false)
          setPrefsOpen(true)
        }
      }
    ]}
  />

  {/* ===== モードバー ===== */}
  <div className="modebar">
    <div className="modebar-left">
      <span className="home">⌂</span>
      <button className="mode-tab mode-tab-on">編集</button>
      {/* **字幕は編集と書き出しの間。**
          喋りを起こしてから仕上げる、という順番そのものを並びで示す。
          押してすぐ走らせない（何分もかかる処理なので、必ず確認を挟む）。 */}
      <button
        className="mode-tab"
        onClick={() => setSubtitleOpen(true)}
        title="喋っている内容を聞き取って、テロップにします"
      >
        字幕
      </button>
      {/* 設定ダイアログを経由する（メニューや Ctrl+M と挙動を揃える。
          以前はここだけ前回設定で即書き出しが始まっていた） */}
      <button className="mode-tab" onClick={() => openExportDialog()}>
        書き出し
      </button>
    </div>
    <div className="modebar-sep" />
    <div className="modebar-title" title={projectPath ?? '未保存のプロジェクト'}>
      {/* タイトルはプロジェクトファイル名。SRTのファイル名を出すと保存先を誤認させる */}
      {projectPath ? projectPath.split(/[\\/]/).pop() : 'GiftCut - 無題プロジェクト'}
      {unsaved ? ' *' : ''}
      {/* **いま動いている版。**
          自動更新は黙って入れ替わるので、「直したはずの物が直っていない」と
          言われたときに、まずここを見れば新旧の取り違えかどうかが分かる。 */}
      {appVersion && (
        <span className="app-ver" title="いま動いている GiftCut の版">
          v{appVersion}
        </span>
      )}
    </div>
    <div className="modebar-right">
      <button className="btn btn-primary" onClick={handleImportSrt}>
        SRT読込
      </button>
      <button className="btn" onClick={addTelop} title={`再生ヘッド位置にテロップを追加 (${formatCombo(shortcuts.addTelop)})`}>
        ＋テロップ
      </button>
      {/* **横書き／縦書き。** ＋テロップの隣に置く（次に作る物の向きを決める所なので）。
          選んでいるテロップがあれば、そちらにも当てる——向きは「作ってから決める」
          ことの方が多く、選んで押せないと作り直す羽目になる。
          受け取らず自分で見に行くのは、品書き（AppMenus）や下の帯と同じ流儀。 */}
      {/* **`ratio-group` を使い回さない。** あちらは画面比の chip で、
          「いま選ばれている chip」を数えている所がある（数えた側が壊れる）。
          見た目が同じだからと同じ名前を付けると、必ずどこかが巻き添えになる
          （測定ボタンで `status-pop` を使い回して同じ事故を起こした） */}
      <div className="wm-group">
        {([false, true] as const).map((v) => (
          <button
            key={String(v)}
            className={`chip ${!!newTelopStyle.vertical === v ? 'chip-on' : ''}`}
            title={
              v
                ? '縦書き（列は右から左）。選んでいるテロップにも当てます'
                : '横書き。選んでいるテロップにも当てます'
            }
            onClick={() => setTelopVertical(v)}
          >
            {v ? '縦書き' : '横書き'}
          </button>
        ))}
      </div>
      <div className="ratio-group">
        {(['16:9', '9:16', '1:1'] as const).map((r) => (
          <button
            key={r}
            className={`chip ${ratio === r ? 'chip-on' : ''}`}
            title="フレームの縦横比を変更（テロップの箱と文字サイズも比率に合わせて補正します）"
            onClick={() => changeRatio(r)}
          >
            {r}
          </button>
        ))}
      </div>
      <select
        className="lufs-select"
        title="ラウドネス正規化（書き出し時に音量を目標LUFSへ自動調整）"
        value={loudnormLUFS === null ? 'off' : String(loudnormLUFS)}
        onChange={(e) =>
          setLoudnormLUFS(e.target.value === 'off' ? null : Number(e.target.value))
        }
      >
        <option value="-14">🔊 音量そろえ -14 LUFS（YouTube）</option>
        <option value="-16">🔊 音量そろえ -16 (podcast)</option>
        <option value="-23">🔊 音量そろえ -23 (放送)</option>
        <option value="off">音量そろえ OFF</option>
      </select>
    </div>
  </div>
    </>
  )
}
