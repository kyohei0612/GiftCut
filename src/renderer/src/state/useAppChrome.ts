// 画面の「枠まわり」の小さな状態。
//
// ## なぜ寄せ集めが1か所にあるのか
//
// 右クリックの品書き、いま持っている道具、マグネットの入切、進み具合のバッジ、
// 本体の版。**どれもプロジェクトの中身ではなく、画面の都合**。
// 中身（テロップ・クリップ）と混ぜて並べると、保存すべき物とそうでない物の
// 境目が読めなくなる。保存しない物は、まとめてここに置く。
import { useEffect, useRef, useState } from 'react'
import type { UpdateState } from '../../../preload/index.d'
// 形は置き場（useAppLayout）が持っている。**写さずに引く**
import type { RightTab } from './useAppLayout'

/** いま持っている道具 */
export type Tool = 'select' | 'razor' | 'trackFwd' | 'trackBack'

/** テロップの右クリックの品書き */
export interface ContextMenu {
  x: number
  y: number
  cueId: number
}

/** テロップ以外（動画の切片・効果音・画像・重ねる動画）の右クリックの品書き */
export interface ClipMenu {
  x: number
  y: number
  kind: 'seg' | 'se' | 'img' | 'vclip'
  id: number
  name: string
}

export function useAppChrome() {
  const [menu, setMenu] = useState<ContextMenu | null>(null)
  const [clipMenu, setClipMenu] = useState<ClipMenu | null>(null)
  const idCounter = useRef(1)

  const [tool, setTool] = useState<Tool>('select')

  /**
   * 右パネルのいま開いている見出し。
   *
   * **配線から移した（2026-08-04）。** ここを待っているフックが5本あり、
   * どれも「動きを付けたら動きのタブへ切り替える」ために書くだけだった。
   * 配線が持っていると、その5本を囲いへ上げられない。
   */
  const [rightTab, setRightTab] = useState<RightTab>('project')

  /**
   * マグネット（吸着）の入切。**PCに覚えさせる。**
   *
   * 編集の癖なので、プレビューの画質やパネルの幅と同じく残すべき物。
   * 以前はショートカット（S）だけが保存していて、ツールバーのボタンから
   * 切ると再起動で ON に戻っていた。切り替えは必ずここを通す。
   *
   * ここは描き直しの最中に走るので、共通の読み書き（loadLS）は使えない
   * （使うと起動時に「まだ作られていない物を読んだ」で真っ黒になる）。直に読む。
   */
  const [snap, setSnap] = useState<boolean>(() => {
    try {
      return localStorage.getItem('giftcut.snap') !== 'false'
    } catch {
      return true
    }
  })
  function toggleSnap(): void {
    setSnap((v) => {
      try {
        localStorage.setItem('giftcut.snap', JSON.stringify(!v))
      } catch {
        /* 覚えられなくても、この回の入切は効かせる */
      }
      return !v
    })
  }

  /** 動きの計測の小窓。既定は閉じたまま（閉じていても測り続ける） */
  const [perfOpen, setPerfOpen] = useState(false)
  /** 常時計測をこちらから止めたか。止めたら右下のボタンが灰色になる */
  const [perfStopped, setPerfStopped] = useState(false)

  /**
   * 素材ごとまとめる／まとめを開く の進み具合（null=やっていない）。
   * 数GBになることがあり、無反応に見えると二度押しされるので必ず出す。
   */
  const [packPct, setPackPct] = useState<number | null>(null)
  /**
   * いま動いているか。**進み具合の知らせは終わった後にも遅れて届く**ので、
   * これで無視する。見張っていないと最後の 100% が居座り、バッジが出たままに
   * なって「実行中だから」と次の操作を弾き続ける（実際にそうなった）。
   */
  const packBusyRef = useRef(false)

  /** 更新（GitHub から自動で当てる）の様子。null=何も出さない */
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)

  /** いま焼き直している原本のパス */
  const proxyForPathRef = useRef<string | null>(null)
  /**
   * この動画について最初の切片を作ったか。
   * 焼き直しが終わって映像が差し替わると読み込みが再び起きるので、
   * 「切片が空か」を条件にすると**全部消した直後にカットが勝手に復活する**。
   */
  const initializedForPathRef = useRef<string | null>(null)

  /** いま動いている本体の版（枠の題名の横に出す） */
  const [appVersion, setAppVersion] = useState('')
  useEffect(() => {
    void window.giftcut
      ?.getVersion?.()
      .then((v) => setAppVersion(typeof v === 'string' ? v : ''))
      .catch(() => setAppVersion(''))
  }, [])

  return {
    menu,
    setMenu,
    clipMenu,
    setClipMenu,
    idCounter,
    tool,
    setTool,
    rightTab,
    setRightTab,
    snap,
    toggleSnap,
    perfOpen,
    setPerfOpen,
    perfStopped,
    setPerfStopped,
    packPct,
    setPackPct,
    packBusyRef,
    updateState,
    setUpdateState,
    proxyForPathRef,
    initializedForPathRef,
    appVersion
  }
}
