// いま作っているプロジェクトを、**開く・保存する**。
//
// ## ここが一番「静かに壊れる」所
//
// 開いたときに拾い忘れた項目は、**エラーも出ずに消える**。
// 保存する側（下の `projectJson`）に項目を足したら、**流し込む側
//（./useProjectApply）にも必ず足すこと。** 片方だけだと、開いた瞬間に既定値へ戻る。
//
// ## 読む側と書く側で分かれている（2026-08-04。542 → 217行）
//
// ここは**心臓の値を読むだけ**（setter を1つも持たない）。入れる側は全部
// ./useProjectApply にある。「どっちがどっちを壊したか」を切り分けられる形。
//
// 出したのは `applyProjectData`（297行）。記号解決で測ったら**受け取る24・返す0**で、
// 受け取る24は全部 import か型だった（`引き継ぎ-心臓の分け直し.md`）。
//
// ## テンプレートは別ファイル（2026-08-03 に出した）
//
// 元の冒頭は「開く・保存・復元**と、テンプレート**」と**2つ宣言していた**。
// テンプレートは「次に始めるときの形」を決める話で、タイムラインの中身を
// 一切触らない。持ち物もほとんど重ならなかった（deps 3個・context 8個が
// まるごと不要になった）→ `./useProjectTemplates`。
//
// ## 中身
//
// - `useProjectFile` … 下をまとめて返す唯一の入口
// - `projectJson` … いまの中身を丸ごと文字列にする（保存と自動保存で共通）
// - `saveProjectFn` … 保存する。**保留中の履歴を先に確定させてから**書く
// - `openProjectFn` … ファイルを開く。未保存があれば先に確かめる
// ※ 流し込む（`applyProjectData`）は ./useProjectApply へ出した。**同じ名前で返している**
// ※ templateMerge / telopTemplates の保存系は ./useProjectTemplates へ一緒に出た
//    （混ぜる話はテンプレートを当てるときにしか出てこない）。
// ※ 読み込みの整え直し（projectLoad / trackState / iconLibrary）は
//    ./useProjectApply へ一緒に出た。**開く・保存にはもう出てこない**
import { useProjectApply, type UseProjectApplyDeps } from './useProjectApply'
import type { Snap } from './useHistory'
import { useDoc } from './contentContext'
import { useProjectStateCtx } from './projectStateContext'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'
import { useExportCtx } from './exportContext'
import { useMediaCtx } from './mediaContext'
import { useIconsCtx } from './iconsContext'

// **ここは画面側の配線をそのまま借りている。**
//
// 前はここを全部 `any` にして「型を細かく付けるより、借り物であることが
// 見えている方が直しやすい」と書いてあった。**2026-08-04 に取り下げた**——
// `any` は「借り物」ではなく「何でも通る」で、
//
//   ・借りている物が別の形に変わっても、ここは黙って通る
//   ・引数の数を間違えても通る
//
// 借り物であることは**この説明**が伝えればよく、型を捨てる必要はない。
//
// **手で書いても腐らない。** ここは呼ぶ側（`useAppWiring`）が実物を渡す入口なので、
// 型がズレた瞬間に呼び出し側で落ちる（心臓の受け口＝`*Context.tsx` とは逆で、
// あちらは渡す側も受ける側も `any` だったので誰も気づけなかった）。
// 型は推測せず、**呼び出し側が実際に渡している物をそのまま写した**。
//
// ※ duration / mediaMeta / audioTrackGain / undoStackRef / redoStackRef /
//    pendingTimerRef は消した。**渡されていたが本文で一度も読んでいなかった**
//    （残っていた出現箇所は全部コメントの中の文字列だった）。
//    deps の未使用は noUnusedLocals では出ない（分割代入に入れなければ黙る）
// ※ kindOf / askText / setTemplatePicker は ./useProjectTemplates へ移した
//   （素材の種類を見分けるのも、名前を尋ねるのも、テンプレートの時だけ要る）
export interface UseProjectFileDeps extends UseProjectApplyDeps {
  layoutNow: () => Record<string, unknown>
  snapNow: () => Snap
  confirmDiscard: (what: string) => Promise<boolean>
  hasProjectContent: () => boolean
  rememberProject: (path: string) => void
  commitPending: () => void
  lastAutosaveRef: React.MutableRefObject<string>
  baselineRef: React.MutableRefObject<Snap>
}

export function useProjectFile(deps: UseProjectFileDeps) {
  // ※ kindOf / askText / setTemplatePicker は ./useProjectTemplates へ移った
  //   （素材の種類を見分けるのも、名前を尋ねるのも、テンプレートの時だけ要る）
  const { layoutNow, snapNow, confirmDiscard, hasProjectContent, rememberProject, commitPending, lastAutosaveRef, baselineRef, savedJsonRef, markUnsavedRef } = deps
  // 読んだ中身を画面へ流し込む所（297行）は state/useProjectApply。
  // **自分で心臓を見に行く**ので、ここから渡すのは deps だけ
  //（`UseProjectFileDeps` があちらを extends している＝そのまま通せる）
  const { applyProjectData } = useProjectApply(deps)
  // **読む側しか要らない。** 入れる側（setter）は全部 ./useProjectApply が持っている。
  // ここは「いまの中身を文字列にして書く」だけなので、値だけ見る
  const { cues, segments, seClips, imgClips, vClips, markers } = useDoc()
  const { tracks, trackStates } = useTracksCtx()
  const { showToast } = useToastCtx()
  const { ratio, exportOpts, masterVolume, loudnormLUFS } = useExportCtx()
  const { videoPath, sources, mediaItems } = useMediaCtx()
  const { iconSide, iconOffset, iconScale, iconAuto, iconAnchorPos } = useIconsCtx()
  const {
    projectPath, setProjectPath, setRecentProjects,
    // ※ テロップの整理（★/分類/自作フォルダ/自作テロップ）は ./useProjectTemplates へ。
    //   **混ぜるのはテンプレートを当てるときだけ**で、開く・保存には出てこなかった
    newTelopStyle, transDur, srtPath,
    iconAssign, laneIconAssign, missingMedia
  } = useProjectStateCtx()


  // ※ restore（控えを画面へ戻す）は state/useHistory へ移した。
  //   控えを取る側と同じ持ち物を触るだけなのに、ここに置いていたせいで
  //   「履歴は戻す物を要り、こちらは履歴の初期化を要る」という輪になっていた。

  // ================= プロジェクト保存 / 読み込み =================
  // プロジェクトのシリアライズ（保存・自動保存で共通）
  // pathOverride: 保存直後に「保存済みの基準」を作るとき、まだ state に
  // 反映されていない新しい保存先を渡す。これを渡さないと基準が古いパスで
  // 作られ、以降ずっと「未保存の変更あり」と判定され続ける（初回保存や
  // 別名保存の直後に必ず起きていた）。
  function projectJson(pathOverride?: string | null): string {
    return JSON.stringify(
      {
        version: 1,
        // 素材が見つからなかった場合は元のパスを書き戻す（消さない）
        videoPath: videoPath ?? missingMedia?.videoPath ?? null,
        srtPath,
        // マルチソース: 元動画一覧（id/path/name）。プロキシ/波形/fpsは読込時に再生成。
        sources: sources.length
          ? sources.map((s) => ({ id: s.id, path: s.path, name: s.name }))
          : (missingMedia?.sources ?? []),
        ratio,
        tracks,
        cues,
        segments,
        seClips,
        markers,
        imgClips,
        vClips,
        // トラックの状態（ロック/非表示/ミュート/ソロ/音量）とメディアビンも保存する
        // ＝開き直したときに非表示設定や追加素材が消えないように
        trackStates,
        mediaItems: mediaItems.map((m) => ({
          path: m.path,
          name: m.name,
          kind: m.kind,
          folder: m.folder
        })),
        iconSide,
        iconOffset,
        iconScale,
        iconAuto,
        iconAnchorPos,
        // ラベル色/レーンごとのアイコン割当。プロジェクトに入れないと、別PCで開いたとき
        // 「個別にD&Dしたアイコンだけ残り、色で割り当てたアイコンが無警告で全部消える」。
        iconAssign,
        laneIconAssign,
        // 書き出し設定・音量系もプロジェクトの一部（毎回やり直し＆設定違いでの再エンコード事故を防ぐ）
        exportOpts,
        loudnormLUFS,
        masterVolume,
        transDur, // トランジションの既定長
        newTelopStyle, // このプロジェクトで次に追加するテロップの既定スタイル
        // 画面の配置（パネルの幅・段の高さ・タブ・切り離した窓）。
        // 「開き直したら前と同じ形で始まる」ようにするため、中身と一緒に持つ。
        layout: layoutNow(),
        // 現在のプロジェクトファイルパス（自動保存からの復帰でタイトル/上書き先を失わないため）
        projectPath: pathOverride !== undefined ? pathOverride : projectPath
      },
      null,
      1
    )
  }

  async function saveProjectFn(asNew = false): Promise<void> {
    if (!hasProjectContent()) {
      showToast('保存する内容がありません。')
      return
    }
    // 保留中(450msデバウンス)の履歴を先に確定させる。これが無いと
    // 「動かして即 Ctrl+S」の直後の Ctrl+Z が、その移動ではなく1つ前を取り消す。
    commitPending()
    // .gcproj 以外（例: 読み込んだSRT）を上書き先にしない安全弁
    const cur = projectPath && /\.(gcproj|json)$/i.test(projectPath) ? projectPath : null
    const res = await window.giftcut.saveProject(projectJson(), cur, asNew)
    if (res?.ok && res.path) {
      setProjectPath(res.path) // 以降の Ctrl+S はここへ上書き
      // 手動保存できたら自動保存の下書きは不要（毎起動で復帰プロンプトが出続けるのを防ぐ）
      void window.giftcut.autosaveClear()
      const saved = projectJson(res.path)
      lastAutosaveRef.current = saved
      savedJsonRef.current = saved // ここを「保存済み」の基準にする
      baselineRef.current = snapNow() // 保存時点を「未編集」の基準にする
      rememberProject(res.path) // ファイルメニューの「最近使ったプロジェクト」に出す
      markUnsavedRef.current(saved) // タイトルの「＊」を待たずに消す
      showToast('プロジェクトを保存しました:\n' + res.path, 'success')
    } else if (res?.error && res.error !== 'キャンセル')
      showToast('保存失敗: ' + res.error, 'error')
  }

  // path 省略=ダイアログで選ぶ / path 指定=最近使ったプロジェクトを直接開く
  async function openProjectFn(path?: string): Promise<void> {
    // 閉じるときは確認するのに開くときはしない、という非対称を解消する
    // （確認なしだと30分の作業が警告なしに消え、しかも自動保存の下書きも
    //   30秒後に新しいプロジェクトで上書きされて復元不能になる）
    if (!(await confirmDiscard('別のプロジェクトを開く'))) return
    const res = await window.giftcut.openProject(path)
    if (!res) return
    if (!res.ok || !res.data) {
      showToast('プロジェクトを開けませんでした:\n' + (res.error ?? '不明なエラー'), 'error')
      // 見つからなくなったファイルは一覧から外す（毎回同じエラーを踏まないように）
      if (path) setRecentProjects((prev) => prev.filter((r) => r.path !== path))
      return
    }
    await applyProjectData(res.data, !!res.videoExists, res.path ?? null)
    if (res.path) rememberProject(res.path)
  }

  // テンプレJSON＝プロジェクトタブ(メディアビン)＋テロップ設定(フォルダ/お気に入り/カテゴリ)＋比率/アイコン。
  // タイムライン(カット/配置=cues/segments/seClips/videoPath)は含めない。


  // ※ テロップの見本（作る・当てる・消す）は state/useTelopTemplate へ出した。
  //    このファイルの頭が言う「テンプレート」は**プロジェクトの雛形**のことで、
  //    テロップの文字装飾とは別物だった（あちらは runs / strokes / shadows を
  //    相似で拡大縮小する話で、ファイルの読み書きが1行も出てこない）。

  // **返すのは、外が本当に受け取っている物だけ。**
  // return の中は noUnusedLocals が見ないので、放っておくと静かに増える。
  return { projectJson, saveProjectFn, openProjectFn, applyProjectData }
}
