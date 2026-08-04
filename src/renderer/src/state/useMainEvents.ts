// メインプロセスからの知らせを受ける口を、1か所に並べる。
//
// ## なぜ1か所か
//
// どれも同じ形（`on〜` で登録し、片付けで外す）で、**受け手が居なければ
// 何も起きないまま静かに終わる**という同じ壊れ方をする。
// バラバラに置くと「知らせは飛んでいるのに誰も聞いていない」に気づけない。
// 関連付けで開いたプロジェクトが開かない、が実際にこれだった
// （「メモ帳で開きますか？」のまま何も起きない）。
//
// ## 片付けを必ず返す
//
// 外し忘れると、画面を作り直すたびに受け手が増えて多重に反応する。
import { useEffect } from 'react'
import type { SubtitlePhase } from '../components/dialogs/SubtitleDialog'
import type { UpdateState } from '../../../preload/index.d'
import { useAppChromeCtx } from './appChromeContext'
import { useExportCtx } from './exportContext'
import { useMediaCtx } from './mediaContext'
import { useProjectFileCtx } from './projectFileContext'
import { useSubtitlePrefsCtx } from './subtitlePrefsContext'

export interface UseMainEventsDeps {
  /** いま「プレビュー最適化中」を出している原本のパス */
  proxyForPathRef: { current: string | null }
  setProxyPct: (v: number | null) => void
  setExportPct: (v: number | null) => void
  setSubtitleState: (s: SubtitlePhase) => void
  setUpdateState: (s: UpdateState | null) => void
  /** まとめ中かどうか（そうでないときの進み具合は捨てる） */
  packBusyRef: { current: boolean }
  setPackPct: (v: number | null) => void
  /** 関連付け（ダブルクリック）で渡されたプロジェクトを開く */
  openProjectFn: (p: string) => void | Promise<void>
  /** いまの中身を文字列にする（更新の再起動の直前に下書きへ書く） */
  projectJson: () => string
}

export function useMainEvents() {
  // **要る9個は心臓から自分で取る**（2026-08-04。配線はただの素通しだった）
  const { proxyForPathRef, setUpdateState, packBusyRef, setPackPct } = useAppChromeCtx()
  const { setProxyPct } = useMediaCtx()
  const { setExportPct } = useExportCtx()
  const { setSubtitleState } = useSubtitlePrefsCtx()
  const { openProjectFn, projectJson } = useProjectFileCtx()

  // 焼き直しの進み具合。**いま読み込み中の原本のぶんだけ**出す
  useEffect(() => {
    const off = window.giftcut?.onProxyProgress?.(({ path, percent }) => {
      if (path === proxyForPathRef.current) setProxyPct(percent >= 100 ? null : percent)
    })
    return () => off?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 書き出しの進み具合
  useEffect(() => {
    const off = window.giftcut?.onExportProgress?.(({ percent }) => setExportPct(percent))
    return () => off?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 字幕づくりの進み具合
  useEffect(() => {
    const off = window.giftcut?.onSubtitleProgress?.((s) => setSubtitleState(s as SubtitlePhase))
    return () => off?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 関連付け（ダブルクリック）で開かれたプロジェクトを開く。
  // **受け取る側が居ないと「メモ帳で開きますか？」のまま何も起きない。**
  useEffect(() => {
    const off = window.giftcut?.onOpenProjectPath?.((p) => {
      void openProjectFn(p)
    })
    return () => off?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 更新の再起動の直前。いまの状態を下書きに書いてから「書けた」と返す。
  //
  // 更新は「未保存の変更が無いとき」しか当てないが、それでも開いていた
  // プロジェクト・再生位置・画面の形は消したくない。次の起動でこれを黙って
  // 読み直すので、印（resumeAfterUpdate）も付ける。
  //
  // **依存配列を付けない**（毎回登録し直す）。ここだけは「いまの中身」を
  // 書く必要があり、1回だけ登録すると起動直後の空っぽを書いてしまう。
  useEffect(() => {
    const off = window.giftcut?.onUpdateFlush?.(() => {
      void (async () => {
        try {
          localStorage.setItem('giftcut.resumeAfterUpdate', '1')
          await window.giftcut.autosaveProject(projectJson())
        } catch (e) {
          console.warn('[update] 再起動前の保存に失敗:', e)
        } finally {
          window.giftcut.updateFlushed()
        }
      })()
    })
    return () => off?.()
  })

  // 更新の様子
  useEffect(() => {
    const off = window.giftcut?.onUpdateState?.((s) => {
      // 「新しいのは無い」「見に行っています」は黙っておく。
      // 何も起きていないことをいちいち画面に出しても、邪魔なだけなので。
      setUpdateState(s.phase === 'none' || s.phase === 'checking' ? null : s)
    })
    return () => off?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 素材ごとまとめる（持ち出し）の進み具合
  useEffect(() => {
    const off = window.giftcut?.onPackProgress?.(({ percent }) => {
      if (packBusyRef.current) setPackPct(percent)
    })
    return () => off?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
