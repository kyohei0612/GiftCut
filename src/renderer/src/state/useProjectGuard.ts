// プロジェクトを切り替える瞬間の、小さな決まりごと。
//
// ## なぜ独立しているか
//
// 「捨てる前に聞く」と「最近開いた物を覚える」は、**開く側と保存する側の
// 両方から呼ばれる**。以前は出し入れ（state/useProjectIO）の中に置いていたが、
// 開く／保存する側（state/useProjectFile）がこの2つを要り、
// 出し入れ側は開く側の applyProjectData を要る——という輪になっていた。
//
// 中身はどちらも「聞く」「控えに足す」だけで、開く処理も保存処理も要らない。
// 先に作っておけば、両方が素直に受け取れる。
import { useProjectStateCtx } from './projectStateContext'

export interface UseProjectGuardDeps {
  /** 何か作りかけの物があるか（空なら聞くまでもない） */
  hasProjectContent: () => boolean
  /** 最後に保存した中身 */
  savedJsonRef: React.MutableRefObject<string | null>
  /** いまの中身を文字列にする（重いので、聞くときにだけ呼ぶ） */
  currentJsonRef: React.MutableRefObject<() => string>
  askConfirm: (o: {
    title: string
    body: string
    okLabel?: string
    cancelLabel?: string
    danger?: boolean
  }) => Promise<boolean>
  /** 控えに残す件数の上限 */
  recentMax: number
}

export interface ProjectGuard {
  hasUnsavedChanges: () => boolean
  /** 作業内容を捨てる操作の前に確認する。true＝進めてよい */
  confirmDiscard: (what: string) => Promise<boolean>
  /** ファイルメニューの「最近使ったプロジェクト」に足す */
  rememberProject: (path: string) => void
}

export function useProjectGuard(deps: UseProjectGuardDeps): ProjectGuard {
  const { hasProjectContent, savedJsonRef, currentJsonRef, askConfirm, recentMax } = deps
  const { setRecentProjects } = useProjectStateCtx()

  function hasUnsavedChanges(): boolean {
    try {
      if (!hasProjectContent()) return false
      // **ここはその場で比べ直す。** タイトルの「＊」は一定間隔でしか
      // 見直していないので、閉じる瞬間には古いことがある
      return savedJsonRef.current !== currentJsonRef.current()
    } catch {
      return false
    }
  }

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

  function rememberProject(path: string): void {
    const name = path.split(/[\\/]/).pop() ?? path
    setRecentProjects((prev) =>
      [{ path, name, at: Date.now() }, ...prev.filter((r) => r.path !== path)].slice(0, recentMax)
    )
  }

  return { hasUnsavedChanges, confirmDiscard, rememberProject }
}
