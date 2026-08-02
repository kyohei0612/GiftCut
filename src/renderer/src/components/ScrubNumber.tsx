// 数値の入力欄。**押し込んで左右に振ると増減する**（Adobe / プレミアと同じ）。
//
// ## なぜ普通の数値欄ではいけないか
//
// 数を打ち込みたい場面より、「ちょっと増やして見た目を確かめる」場面のほうが
// ずっと多い。矢印ボタンを何十回も押す・毎回キーボードで打ち直す、では追いつかない。
// 押したまま横に振れば、見ながら決められる。
//
// **画面の端で止まらない**のが肝。ポインタをロックして movementX を積むので、
// 端に当たっても値は動き続ける。ロックが取れない環境でも、端までは動く。
//
// ## 使うときの注意
//
// 4px 動かすまではクリック扱い（打ち込みができる）。触っただけで値が変わると、
// 数を選んで打ち直すことができなくなる。

import type { JSX } from 'react'

/**
 * 1回のイベントで受け付ける最大の動き（px）。これを超えたら捨てる。
 *
 * **本命の対策は「ロック直後の1回を捨てる」方**（下の pendingLockSkip）。
 * ここは最後の砦で、その道を通らずに桁違いの値が届いたときだけ効く。
 * **低くしすぎてはいけない**——速く振った1回まで捨ててしまい、
 * 上限まで一気に持っていく操作ができなくなる（実際に確認が落ちた）。
 */
const ABSURD_STEP_PX = 1200

export function ScrubNumber({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  sensitivity = 3,
  disabled,
  title,
  className
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  /** 何pxで1ステップ動かすか。小さいほど敏感 */
  sensitivity?: number
  disabled?: boolean
  title?: string
  className?: string
}): JSX.Element {
  const clampV = (v: number): number => Math.min(max, Math.max(min, v))
  // 刻みの細かさに合わせて丸める。**小数2桁で固定しない。**
  // 拡大率のように 0.01 刻みの物を2桁で丸めると、それ以上細かくできない
  const decimals = ((): number => {
    const s = String(step)
    const i = s.indexOf('.')
    return i < 0 ? 0 : Math.min(6, s.length - i - 1)
  })()
  const round = (v: number): number => Number(v.toFixed(decimals))

  const onPointerDown = (e: React.PointerEvent<HTMLInputElement>): void => {
    if (e.button !== 0 || disabled) return
    const input = e.currentTarget
    const startVal = Number(value) || 0
    // movementX を積算するので、画面端に当たってもポインタロック中は動き続ける
    let acc = 0
    let scrubbing = false
    /** ロックを頼んだ直後か。効いた最初の1回は「飛び」なので捨てる */
    let pendingLockSkip = false
    const onMove = (ev: PointerEvent): void => {
      const dx = ev.movementX || 0
      // **ポインタをロックした直後の1回を捨てる。**
      //
      // ロックが効くと、その最初の1回だけ「元のカーソル位置から画面中央まで」の
      // 距離が movementX として届くことがある。数百pxになるので、押した瞬間に
      // 値がいきなり飛ぶ（「触った瞬間に数字が飛ぶ」の正体）。
      //
      // **「大きい値を全部捨てる」やり方にしてはいけない。** 速く振った1回まで
      // 捨ててしまい、上限まで一気に持っていく操作ができなくなる。
      // 捨てるのは「ロックが効いた直後の1回」だけにする。
      if (pendingLockSkip && document.pointerLockElement === input) {
        pendingLockSkip = false
        return
      }
      if (Math.abs(dx) > ABSURD_STEP_PX) return // 最後の砦（上の道を通らなかったとき）
      acc += dx
      if (!scrubbing) {
        if (Math.abs(acc) < 4) return // ここまではクリック扱い（打ち込みできる）
        scrubbing = true
        input.blur() // スクラブ中はキャレット/選択を出さない
        try {
          void input.requestPointerLock?.()
          pendingLockSkip = true // 効いたら最初の1回は捨てる（下の onMove）
        } catch {
          /* 失敗しても端まではスクラブ可能 */
        }
      }
      ev.preventDefault()
      onChange(round(clampV(startVal + Math.trunc(acc / sensitivity) * step)))
      window.getSelection()?.removeAllRanges()
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (document.pointerLockElement === input) document.exitPointerLock?.()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // 中断時も必ず解除（残すとマウスを動かすだけで数値が変わり続ける）
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <input
      type="number"
      className={`scrub ${className ?? ''}`}
      value={value}
      step={step}
      // **上限・下限は欄そのものにも持たせる。**
      // 値の丸めは中でやっているが、欄に付いていないと矢印キーや
      // スピナーが素通しになり、「打てないはずの値が打てる」ように見える。
      // （実際、拡大の下限100%が欄から消えていた）
      {...(Number.isFinite(min) ? { min } : null)}
      {...(Number.isFinite(max) ? { max } : null)}
      disabled={disabled}
      title={title}
      onPointerDown={onPointerDown}
      onChange={(e) => onChange(round(clampV(Number(e.target.value) || 0)))}
    />
  )
}
