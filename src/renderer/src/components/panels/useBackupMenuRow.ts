// ファイルメニューの「バックアップから復元」の1行（奥の段に時刻つきで並べる）。
//
// 時刻つきのバックアップは、自動保存のたび・上書き保存のたびに貯まる（main/projectBackups。
// どれだけ残すかは shared/backupPrune）。**落ちていなくても、保存してしまった後でも、
// ここから選んで戻せる**——前は復元の入口が「落ちた次の起動」にしか無く、下書きも
// 2世代で消えていた（2026-11-12・本人「復元ができない。全く役に立たなかった」）。
//
// AppHeader から出したのは、あちらが500行を超えるため（話題も別）。
import { useEffect, useState } from 'react'
import { backupLabel, type BackupInfo } from '../../../../shared/backupPrune'
import { useProjectFileCtx } from '../../state/projectFileContext'
import { useShortcutPrefsCtx } from '../../state/shortcutPrefsContext'
import type { MenuRow } from '../MenuBar'

/** メニューに差し込む行。バックアップが1つも無ければ false（行を出さない） */
export function useBackupMenuRow(): MenuRow | false {
  const { openBackupFn } = useProjectFileCtx()
  const { fileMenuOpen, setFileMenuOpen } = useShortcutPrefsCtx()
  // **メニューを開くたびに取り直す**（開いている間にも増えるので、起動時に1回だけ
  // 取ると古い一覧を出し続ける）
  const [backups, setBackups] = useState<BackupInfo[]>([])
  useEffect(() => {
    if (!fileMenuOpen) return
    void window.giftcut?.listBackups?.()?.then((l) => setBackups(l ?? []))
  }, [fileMenuOpen])
  return (
    backups.length > 0 && {
      kind: 'sub',
      label: 'バックアップから復元',
      rows: backups.map(
        (b) =>
          ({
            kind: 'recent',
            label: backupLabel(b),
            title: '名前なしで開きます（いまのプロジェクトファイルは書き換えません）',
            onClick: () => {
              setFileMenuOpen(false)
              void openBackupFn(b.id)
            }
          }) as const
      )
    }
  )
}
