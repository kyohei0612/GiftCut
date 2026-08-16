// 下書き（自動保存）と、未保存のときに聞くこと。
//
// ## 落ちても・閉じても、続きから始められるように
//
// 中身そのものをファイルに書く。重いので落ち着いてから、一定の間隔で。
//
// ## 閉じる前に必ず流し込む
//
// 間隔タイマーだけだと、閉じた瞬間に**最大その間隔ぶんの編集が無警告で消える**。
// 閉じる直前には待たずに1回書く。
//
// ## ✕ を押したときは、こちらが聞く
//
// メイン側は閉じるのを止めてここへ聞きに来る。アプリ内で答えて、
// 了承なら `confirmClose` で閉じ直してもらう
// （Electron のまま止めると、無言で閉じられなくなる）。
//
// ## 呼ぶ順を変えない
//
// 元は `useSessionMemory` の中にあり、**セッション保存 → 履歴 → ここ**の順で
// 走っていた。`useAppWiring` ではこの順を保つこと（2026-08-03 に分けた）。
import { perf } from '../lib/perfMonitor'
import { AUTOSAVE_MS } from '../lib/appConst'
import { useEffect } from 'react'
import { useToastCtx } from './toastContext'
import type { Ask } from './useAsk'
import type { RestoreState } from '../components/dialogs/ProjectDialogs'
import { useAskCtx } from './askContext'
import { useAutosaveMarkCtx } from './autosaveMarkContext'
import { useProjectFileCtx } from './projectFileContext'
import { useProjectIOCtx } from './projectIOContext'

// **`any` で受けない。** ここは呼ぶ側（`useAppWiring`）が実物を渡す入口なので、
// 型がズレた瞬間に呼び出し側で落ちる＝手で書いても腐らない。
// 型は推測せず、呼び出し側が実際に渡している物をそのまま写した。
export interface UseAutosaveDraftDeps {
  /** 下書きを書く */
  writeAutosave: (json: string) => Promise<void>
  /** いまの中身を文字列にした物と、その版 */
  currentJsonRef: React.MutableRefObject<() => string>
  projectRevRef: React.MutableRefObject<number>
  autosavedRevRef: React.MutableRefObject<number>
  lastAutosaveRef: React.MutableRefObject<string>
  /** 中身が入っているか（空なら復元を聞かない） */
  hasContentRef: React.MutableRefObject<() => boolean>
  /**
   * 読み込んだ下書きをタイムラインへ流し込む。
   * **`data` が `any` なのは正しい**——ディスクから読んだ物で形が保証されていない
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyProjectData: (data: any, videoExists: boolean, srcPath: string | null) => Promise<void>
  /** 形は書き写さず引く（同じ物が4か所で要る） */
  askConfirm: Ask['askConfirm']
  setRestorePrompt: React.Dispatch<React.SetStateAction<RestoreState | null>>
}

export function useAutosaveDraft(): void {
  // **要る10個は心臓から自分で取る**（2026-08-04。配線はただの素通しだった）
  const { writeAutosave } = useProjectIOCtx()
  const {
    currentJsonRef, projectRevRef, autosavedRevRef, lastAutosaveRef,
    hasContentRef, setRestorePrompt
  } = useAutosaveMarkCtx()
  const { applyProjectData } = useProjectFileCtx()
  const { askConfirm } = useAskCtx()
  const { showToast } = useToastCtx()

  useEffect(() => {
    // **名札を付ける**（`perf.measure`）。プロジェクト全体を文字列にするので、
    // 中身が大きいと主スレッドを塞ぐ。再生中は上の行で早く帰るはずだが、
    // 「はず」を記録で確かめられるようにしておく
    const id = window.setInterval(() => {
      perf.measure('下書きの自動保存', () => {
        if (!hasContentRef.current()) return
        if (projectRevRef.current === autosavedRevRef.current) return // 何も変わっていない
        autosavedRevRef.current = projectRevRef.current
        const json = currentJsonRef.current()
        if (json === lastAutosaveRef.current) return
        void writeAutosave(json)
      })
    }, AUTOSAVE_MS)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 終了/リロード直前に、その時点の内容を自動保存へ流し込む。
  // （間隔タイマーだけだと、閉じた瞬間に最大その間隔ぶんの編集が無警告で消える）
  // ※ここでは閉じるのをキャンセルしない（Electronでは無言で閉じられなくなるため）。
  //   未保存の確認はメインプロセスのネイティブダイアログで行う（project:dirty を通知）。
  useEffect(() => {
    const onBeforeUnload = (): void => {
      if (!hasContentRef.current()) return
      const json = currentJsonRef.current()
      if (json !== lastAutosaveRef.current) {
        void writeAutosave(json) // 最後のフラッシュ
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // 起動時: 自動保存があれば復元プロンプトを出す
  useEffect(() => {
    void window.giftcut?.autosaveCheck?.()?.then(async (r) => {
      if (r?.exists && r.data) {
        // 更新のために自分で落としたのなら、「復元しますか？」とは聞かない。
        // 勝手に閉じておいて開き直しを頼むのは筋が通らないので、黙って続きから開く。
        if (localStorage.getItem('giftcut.resumeAfterUpdate')) {
          localStorage.removeItem('giftcut.resumeAfterUpdate')
          await applyProjectData(r.data, !!r.videoExists, null)
          showToast('新しい GiftCut になりました。続きから開いています。')
          return
        }
        const when = (ms?: number): string | undefined =>
          ms ? new Date(ms).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' }) : undefined
        setRestorePrompt({
          data: r.data,
          videoExists: !!r.videoExists,
          savedAt: when(r.mtime),
          onlyPrev: !!r.onlyPrev,
          prev: r.prev
            ? { data: r.prev.data, videoExists: !!r.prev.videoExists, savedAt: when(r.prev.mtime) }
            : undefined
        })
        return
      }
      // **起動時にテンプレート選択で塞がない**（2026-08-07）。
      //
      // 前は、自動保存の復元が無ければ全面の覆いを出していた。
      // 初めて入れた人が**アプリを見る前に選択を迫られる**形で、
      // 閉じるまで何一つ押せない（画面を撮って回る見学も、ここで全部止まった）。
      //
      // テンプレートは慣れた人の道具で、初回に要る物ではない。
      // 入口は**ファイル →「テンプレートを開く…」**に前からあるので、
      // 塞がなくても辿り着ける。
      //
      // ※ 消したのは「起動時に自動で開く」だけ。選択そのものは同じ物を使う。
    })
  }, [])

  // ✕ で閉じようとしたときの確認。メイン側は閉じるのを止めてここへ聞きに来るので、
  // アプリ内のモーダルで答えて、了承なら confirmClose で閉じ直してもらう。
  useEffect(() => {
    if (!window.giftcut?.onCloseRequest) return
    return window.giftcut.onCloseRequest(() => {
      void askConfirm({
        title: '保存していない変更があります',
        body: '閉じると、最後の保存以降の変更は自動保存の下書きにだけ残ります。次回の起動時に復元できます。',
        okLabel: '保存せずに閉じる',
        cancelLabel: '閉じない',
        danger: true
      }).then((ok: boolean) => {
        if (ok) window.giftcut.confirmClose()
      })
    })
  }, [])
}
