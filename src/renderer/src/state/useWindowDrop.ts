// 素材のドラッグを、ウィンドウ全体で受け取る。
//
// ## なぜ window で受けるか
//
// 以前はアプリのルート div にだけ付けていた。しかしウィンドウの最下部に
// div の外側の帯が数px あり、そこだけ受け皿が無くて 🚫（駐禁）が出ていた。
// **1pxでも取りこぼすと「置けない場所」に見える。**
//
// ## なぜ ref に入れ替えるか
//
// 置き先の判定はいまの中身（どのクリップがどこにあるか）を見る必要がある。
// 一度だけ登録した関数はクロージャに古い中身が焼き付くので、**毎回の描き直しで
// 中身だけ差し替え**、window に登録する関数そのものは1回きりにする。
import { useEffect, useRef } from 'react'

export interface UseWindowDropDeps {
  /** いま掴んでいる素材（掴んでいなければ null） */
  draggingMediaRef: { current: { path: string; kind: string } | null }
  /** 置き先の影を出す */
  updateDropGhost: (
    m: never,
    x: number,
    y: number,
    ctrl: boolean,
    target: EventTarget | null
  ) => void
  clearDropGhosts: () => void
  /** いちばん近い置き場所へ落とす */
  dropMediaNearest: (m: never, x: number, y: number) => void
}

export function useWindowDrop(deps: UseWindowDropDeps) {
  const { draggingMediaRef, updateDropGhost, clearDropGhosts, dropMediaNearest } = deps

  const winDragRef = useRef({
    enter: (_e: DragEvent): void => {},
    over: (_e: DragEvent): void => {},
    drop: (_e: DragEvent): void => {},
    end: (): void => {}
  })
  winDragRef.current = {
    // 要素をまたぐ瞬間に飛ぶ。dragover だけ受けて dragenter を受けないと、
    // またいだ一瞬だけ 🚫 が出る（段から段へ動かすとチラチラする原因）。
    // HTML5 のドラッグは両方で受け入れを宣言して初めて「置ける」扱いになる。
    enter: (e) => {
      if (!draggingMediaRef.current) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    },
    over: (e) => {
      const m = draggingMediaRef.current
      if (!m) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      // タイムラインの外にいても、置き先の影を出し続ける
      updateDropGhost(m as never, e.clientX, e.clientY, e.ctrlKey, e.target)
    },
    drop: (e) => {
      const m = draggingMediaRef.current
      // **影は、掴んでいる物が残っているかに関わらず必ず消す。**
      // 先に受け皿が処理して掴んでいる物を手放していると、ここで `m` が無い。
      // 前はその場合に何もせず帰っていたので、**置き先の影（薄い破線の枠）が
      // 段に残りっぱなし**になっていた。触れない（pointer-events: none）ので、
      // 見た人には「見覚えのない透明な枠」としか映らない。
      clearDropGhosts()
      if (!m) return
      // タイムライン・プレビュー・ビンなど、ちゃんとした受け皿が処理した場合は
      // そちらが preventDefault 済み。二重に置かないよう、ここでは影を消すだけ。
      if (e.defaultPrevented) {
        clearDropGhosts()
        return
      }
      e.preventDefault()
      // 左右のパネル（素材ビン・テロップ一覧など）の中で離したのは「やめた」扱い。
      // ビンから掴んで同じビンへ戻しただけでタイムラインに置かれると事故になる。
      if ((e.target as HTMLElement | null)?.closest?.('.panel:not(.monitor)')) return
      dropMediaNearest(m as never, e.clientX, e.clientY)
    },
    end: () => clearDropGhosts()
  }

  useEffect(() => {
    // **最後の受け皿。** 掴んでいないのに影が残っていたら、次に画面を押した時点で消す。
    // `dragend` は**掴んだ元の要素**へ飛ぶので、素材ビンが描き直されて元の
    // カードが消えていると誰も受け取れず、影だけが残る。
    // 掴んでいる最中は（HTML5 のドラッグ中なので）pointerdown は飛んでこない＝
    // 出ている途中の影を消してしまうことはない。
    const stray = (): void => {
      if (!draggingMediaRef.current) clearDropGhosts()
    }
    window.addEventListener('pointerdown', stray, true)
    const enter = (e: DragEvent): void => winDragRef.current.enter(e)
    const over = (e: DragEvent): void => winDragRef.current.over(e)
    const drop = (e: DragEvent): void => winDragRef.current.drop(e)
    const end = (): void => winDragRef.current.end()
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    window.addEventListener('dragend', end)
    return () => {
      window.removeEventListener('pointerdown', stray, true)
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
      window.removeEventListener('dragend', end)
    }
  }, [])
}
