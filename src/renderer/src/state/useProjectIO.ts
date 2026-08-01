// 素材とプロジェクトの出し入れ。開く・足す・持ち出す・下書きを書く。
//
// ## 「持ち出す」は素材ごと固める
//
// プロジェクトのファイルは素材の**置き場所**しか覚えていない。別のPCへ渡すと
// 全部リンク切れになるので、使っている素材を集めて1つの箱（ZIP）にする。
// 使っていない素材は入れない（箱が無駄に太る）。
//
// ## 下書き（自動保存）は捨てない
//
// 保存していない変更があるまま閉じても、次に開いたときに戻せるようにする。
// 消えて困る物なので、書けなかったときは黙らず知らせる。
//
// ## 開く前に「消えてよいか」を聞く
//
// 開くと、いま触っている中身は消える。保存していない変更があるときだけ聞く
// （毎回聞くと、聞かれること自体に慣れて読まなくなる）。

import type { RecentProject } from './useProjectState'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'
import { useMediaCtx } from './mediaContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface UseProjectIODeps {
  /** 最近開いた物を何件まで覚えるか */
  RECENT_MAX: number
  setRecentProjects: React.Dispatch<React.SetStateAction<RecentProject[]>>
  projectPath: any
  /** いまの中身を文字列にした物（保存の要否を見る） */
  projectJson: any
  currentJsonRef: any
  savedJsonRef: any
  /** 読み込んだ中身をタイムラインへ流し込む */
  applyProjectData: any
  askConfirm: any
  /** 素材を読む・登録する */
  loadVideo: any
  registerSource: any
  addMediaPaths: any
  toGcUrl: any
  /** これから調べる素材の待ち行列 */
  mediaQueue: any
  /** サムネを作り終えた素材 */
  thumbDoneRef: any
  /** 持ち出し（ZIP）の最中か */
  packBusyRef: any
  setPackPct: any
  /** 下書き（自動保存）のまわり */
  autosaveNgRef: any
  autosavedRevRef: any
  lastAutosaveRef: any
  setAutosaveNg: any
  /** 中身が入っているか（空なら聞かずに開いてよい） */
  hasProjectContent: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useProjectIO(deps: UseProjectIODeps) {
  const {
    RECENT_MAX, setRecentProjects, projectPath, projectJson, currentJsonRef, savedJsonRef,
    applyProjectData, askConfirm, loadVideo, registerSource, addMediaPaths, toGcUrl,
    mediaQueue, thumbDoneRef, packBusyRef, setPackPct, autosaveNgRef, autosavedRevRef,
    lastAutosaveRef, setAutosaveNg, hasProjectContent
  } = deps
  const { setSegments, segsRef, segIdCounter } = useDoc()
  const { showToast } = useToastCtx()
  const { videoPath, videoName, sourcesRef, setMediaItems } = useMediaCtx()

  function rememberProject(path: string): void {
    const name = path.split(/[\\/]/).pop() ?? path
    setRecentProjects((prev) =>
      [{ path, name, at: Date.now() }, ...prev.filter((r) => r.path !== path)].slice(0, RECENT_MAX)
    )
  }

  // 動画をプロジェクト（メディアビン）に貯める。タイムラインには即反映しない。
  // ＝2本目以降が勝手に末尾へ足されないように。配置はビンからタイムラインへドラッグする。
  async function handleOpenVideo(): Promise<void> {
    const res = await window.giftcut.openVideo()
    if (!res) return
    const had = !!videoPath
    addMediaPaths([res.path])
    if (had)
      showToast(
        'プロジェクトに追加しました。タイムラインへドラッグして配置してください。',
        'success'
      )
  }
  // 現在の動画を差し替える（タイムラインのカットは作り直しになるので確認する）
  async function handleReplaceVideo(): Promise<void> {
    const res = await window.giftcut.openVideo()
    if (!res) return
    if (segsRef.current.length > 0) {
      const okToGo = await askConfirm({
        title: '現在のカットを破棄して動画を差し替えます',
        body: 'タイムラインの動画クリップは作り直しになります。テロップ・SE・画像・マーカーはそのまま残ります。',
        okLabel: '差し替える',
        danger: true
      })
      if (!okToGo) return
    }
    void loadVideo(res.path)
  }

  // 別の動画をタイムライン末尾に丸ごと連結（ファイルメニュー用）
  async function appendVideo(path: string): Promise<void> {
    if (!sourcesRef.current.length) {
      void loadVideo(path) // まだ何も読み込んでいなければ通常ロード（主ソース化）
      return
    }
    const reg = await registerSource(path)
    if (!reg) return
    const segId = segIdCounter.current++ // 採番はupdaterの外（StrictModeの二重実行対策）
    setSegments((prev) => [...prev, { id: segId, srcId: reg.id, srcStart: 0, srcEnd: reg.dur }])
    showToast(`「${path.split(/[\\/]/).pop()}」をタイムライン末尾に追加しました。`, 'success')
  }
  async function handleAppendVideo(): Promise<void> {
    const res = await window.giftcut.openVideo()
    if (res) void appendVideo(res.path)
  }

  // 動画アイテムのサムネを非同期生成して反映
  function genThumbFor(id: number, path: string): void {
    // 同じファイルを何度も作らない／同時に走らせない（ビンが多いと詰まる）
    if (thumbDoneRef.current.has(path)) return
    thumbDoneRef.current.add(path)
    mediaQueue(() =>
      window.giftcut.generateThumbnail(path).then((th) => {
        if (th?.ok && th.path) {
          const url = toGcUrl(th.path)
          setMediaItems((prev) => prev.map((m) => (m.id === id || m.path === path ? { ...m, thumb: url } : m)))
        }
      })
    )
  }
  async function addFilesToProject(): Promise<void> {
    const res = await window.giftcut.addMedia()
    if (res?.paths) addMediaPaths(res.paths)
  }
  async function addFolderToProject(): Promise<void> {
    const res = await window.giftcut.addFolder()
    if (res?.paths?.length) addMediaPaths(res.paths, res.folder)
    else if (res) showToast('フォルダ内にメディアファイルが見つかりませんでした。')
  }

  // 保存（既存パスがあれば上書き）。asNew=true で「別名で保存」。
  // 未保存の変更があるか。ウィンドウを閉じるときの判定と同じ基準にそろえる
  // （isDirty() は履歴のベースライン比較で450msで false に戻るため使えない）。
  function hasUnsavedChanges(): boolean {
    try {
      if (!hasProjectContent()) return false
      // ここはその場で比べ直す（「＊」の更新が遅れていても、閉じるときは必ず正しい）
      return savedJsonRef.current !== currentJsonRef.current()
    } catch {
      return false
    }
  }
  // 作業内容を捨てる操作の前に確認する。true=進めてよい
  async function confirmDiscard(what: string): Promise<boolean> {
    if (!hasUnsavedChanges()) return true
    return askConfirm({
      title: '保存していない変更があります',
      body: `${what}と、その変更は失われます。`,
      okLabel: 'このまま続ける',
      cancelLabel: '中止して保存する',
      danger: true
    })
  }

  // ---- 持ち出し（素材ごと1つの ZIP）----
  //
  // プロジェクトファイルだけ渡しても、相手のPCには素材が無いので全部
  // 「見つかりません」になる。使っている素材を全部入れて渡せるようにする。
  async function packProjectFn(): Promise<void> {
    if (packBusyRef.current) return // 二重起動しない
    const name = projectPath
      ? (projectPath.split(/[\\/]/).pop() ?? '').replace(/\.(gcproj|json)$/i, '')
      : (videoName ?? '').replace(/\.[^.]+$/, '') || '無題プロジェクト'
    packBusyRef.current = true
    setPackPct(0)
    try {
      const res = await window.giftcut.packProject(projectJson(), name)
      if (res.canceled) return
      if (!res.ok) {
        showToast('まとめられませんでした:\n' + (res.error ?? '不明なエラー'), 'error')
        return
      }
      const mb = Math.round((res.size ?? 0) / 1024 / 1024)
      // 入れられなかった素材は必ず伝える。黙って抜けると、渡した先で
      // 「一部だけ見つかりません」と言われて原因が分からない。
      const miss = res.missing?.length
        ? `\n入れられなかった素材 ${res.missing.length} 件（元の場所に見つかりません）:\n` +
          res.missing.slice(0, 5).join('\n') +
          (res.missing.length > 5 ? `\n…他 ${res.missing.length - 5} 件` : '')
        : ''
      showToast(
        `まとめました（素材 ${res.files ?? 0} 件 / ${mb}MB）\n${res.path}${miss}`,
        res.missing?.length ? 'error' : undefined
      )
    } finally {
      packBusyRef.current = false
      setPackPct(null)
    }
  }

  // 受け取ったまとめ（ZIP）を開く。展開してパスを繋ぎ直したものをそのまま開く。
  async function openPackFn(): Promise<void> {
    if (packBusyRef.current) return
    if (!(await confirmDiscard('まとめたプロジェクトを開く'))) return
    packBusyRef.current = true
    setPackPct(0)
    try {
      const res = await window.giftcut.openPack()
      if (res.canceled) return
      if (!res.ok || !res.data) {
        showToast('まとめを開けませんでした:\n' + (res.error ?? '不明なエラー'), 'error')
        return
      }
      await applyProjectData(res.data, !!res.videoExists, res.path ?? null)
      if (res.path) rememberProject(res.path)
      showToast(`まとめを開きました。素材はここに展開しています:\n${res.dir}`)
    } finally {
      setPackPct(null)
    }
  }

  async function writeAutosave(json: string): Promise<void> {
    const prev = lastAutosaveRef.current
    lastAutosaveRef.current = json // 同じ内容で二重に書かない
    let ok = false
    try {
      const r = await window.giftcut?.autosaveProject?.(json)
      ok = !!r?.ok
    } catch {
      ok = false
    }
    if (ok) {
      if (autosaveNgRef.current) {
        autosaveNgRef.current = false
        setAutosaveNg(false)
        showToast('自動保存が復旧しました。')
      }
      return
    }
    // 書けなかった: 「書いた」記録を戻して、次の回にやり直せるようにする
    lastAutosaveRef.current = prev
    autosavedRevRef.current = -1
    if (!autosaveNgRef.current) {
      autosaveNgRef.current = true
      setAutosaveNg(true)
      showToast('自動保存できていません。手動で保存してください（Ctrl+S）。')
    }
  }

  return {
    rememberProject, handleOpenVideo, handleReplaceVideo, appendVideo, handleAppendVideo,
    genThumbFor, addFilesToProject, addFolderToProject, hasUnsavedChanges, confirmDiscard,
    packProjectFn, openPackFn, writeAutosave
  }
}
