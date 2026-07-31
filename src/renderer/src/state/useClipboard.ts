// コピーの控え（クリップと、設定の貼り付け）。
//
// ## 種類ごとに分けてある理由
//
// **テロップをコピーして動画に貼る、は成り立たない。** 種類が違う物へ
// 貼ると、持っていない設定を無理に当てることになって壊れる。
// 控えも種類ごとに分けておき、貼るときは同じ種類だけを見る。
//
// ## 最後にコピーしたのが何かを覚えている理由
//
// クリップのコピーと「動きだけのコピー」は同じキー（Ctrl+C / Ctrl+V）で行う。
// どちらを貼るかは**最後にコピーした方**で決める。覚えていないと、
// 動きをコピーしたつもりがクリップごと増える。

import { useRef, useState } from 'react'
import type { Cue } from '../lib/srt'
import type { ImgClip, SEClip, VClip } from '../lib/projectTypes'

/**
 * 「設定だけ」の貼り付け（プレミアの属性ペースト相当）。
 *
 * **種類をまたいで写せる物と、そうでない物がある。** 音まわりは音を持つ物にしか
 * 写せないし、文字の見た目はテロップにしか写せない。どちらも持っている物だけを
 * 当てるので、余分な項目は無いまま残る。
 */
export interface CopiedAttrs {
  from: 'telop' | 'seg' | 'img' | 'vclip' | 'se'
  fromName: string
  // 種類をまたいで写せるもの
  zoom?: { scale: number; x: number; y: number }
  rotate?: number
  flipH?: boolean
  flipV?: boolean
  opacity?: number
  adjust?: { b: number; c: number; s: number }
  crop?: { l: number; t: number; r: number; b: number }
  label?: string
  // 音まわり（音を持つものだけ）
  vol?: number
  afadeIn?: number
  afadeOut?: number
  // テロップだけ
  telopPos?: { x: number; y: number }
  telopScale?: number
  telopStyle?: Cue['style']
}

export interface Clipboard {
  clipboardRef: React.MutableRefObject<Cue[]>
  clipboardSeRef: React.MutableRefObject<SEClip[]>
  clipboardImgRef: React.MutableRefObject<ImgClip[]>
  clipboardVcRef: React.MutableRefObject<VClip[]>
  /** 最後にコピーしたのはクリップか、動きか */
  lastCopyRef: React.MutableRefObject<'clip' | 'motion'>
  copiedAttrs: CopiedAttrs | null
  setCopiedAttrs: React.Dispatch<React.SetStateAction<CopiedAttrs | null>>
}

export function useClipboard(): Clipboard {
  const clipboardRef = useRef<Cue[]>([])
  const clipboardSeRef = useRef<SEClip[]>([])
  const clipboardImgRef = useRef<ImgClip[]>([])
  const clipboardVcRef = useRef<VClip[]>([])
  const lastCopyRef = useRef<'clip' | 'motion'>('clip')
  const [copiedAttrs, setCopiedAttrs] = useState<CopiedAttrs | null>(null)
  return {
    clipboardRef,
    clipboardSeRef,
    clipboardImgRef,
    clipboardVcRef,
    lastCopyRef,
    copiedAttrs,
    setCopiedAttrs
  }
}
