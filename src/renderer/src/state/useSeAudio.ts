// 効果音を鳴らす物（<audio> 要素）の面倒を見る。
//
// ## なぜ1か所にまとまるか
//
// 効果音には**鳴らし方が2通り**ある。
//   - タイムラインに置いた物 … 再生に合わせて鳴らす。要素はクリップごと
//   - 見本帳で試聴する物     … 押した瞬間に鳴らす。要素は使い回しの1つ
// どちらも「前の音を確実に止めてから次へ行く」という同じ気の使い方が要る。
// 別々の場所に置くと、片方だけ直して片方で音が残る。
import { useRef } from 'react'
import { toGcUrl } from '../lib/gcUrl'

export function useSeAudio() {
  /** タイムラインに置いた効果音の <audio>（クリップID → 要素） */
  const seAudioRefs = useRef<Map<number, HTMLAudioElement>>(new Map())
  const seRefCbsRef = useRef<Map<number, (el: HTMLAudioElement | null) => void>>(new Map())

  /**
   * クリップIDごとの ref コールバック。**IDごとに1つに固定する。**
   *
   * 毎レンダー新しい無名関数を渡すと、React はそれを「別物」と見て
   * 外す→付け直すを毎回やる。外す瞬間に音を止めているので、
   * **鳴っている最中の効果音が途切れる。**
   */
  const seRefCb = (id: number): ((el: HTMLAudioElement | null) => void) => {
    let fn = seRefCbsRef.current.get(id)
    if (!fn) {
      fn = (el: HTMLAudioElement | null): void => {
        if (el) seAudioRefs.current.set(id, el)
        else {
          // 外される瞬間に音が残らないよう、忘れる前に止める
          const prev = seAudioRefs.current.get(id)
          if (prev && !prev.paused) prev.pause()
          seAudioRefs.current.delete(id)
          seRefCbsRef.current.delete(id)
        }
      }
      seRefCbsRef.current.set(id, fn)
    }
    return fn
  }

  /** 見本帳の試聴用。1つを使い回し、前の音を止めてから鳴らす */
  const sePreviewRef = useRef<HTMLAudioElement | null>(null)
  function previewSE(path: string): void {
    try {
      if (!sePreviewRef.current) sePreviewRef.current = new Audio()
      const a = sePreviewRef.current
      a.pause()
      a.src = toGcUrl(path)
      a.currentTime = 0
      void a.play().catch(() => {})
    } catch {
      /* 鳴らせなくても編集は続けられる */
    }
  }

  return { seAudioRefs, seRefCb, sePreviewRef, previewSE }
}
