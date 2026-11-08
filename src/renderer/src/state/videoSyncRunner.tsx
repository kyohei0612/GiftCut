// 画面の <video> / <audio> を「いま」に追従させる係（state/useVideoSync）を**独立した葉**で動かす。
//
// ## なぜ配線（useAppWiring）から出したか（2026-11-08）
//
// useVideoSync は毎コマ変わる `currentTime` を読む（7つの effect が追従のために要る）。
// 配線の中で呼ぶと、**配線を持つ部品（App の中身）ごと毎コマ描き直り**、タイムラインの
// 帯・左右のパネル・素材ビンまで全部が巻き添えになる。実測（再生5秒・初期の素材）:
// commit 121回/秒、描き直った部品 14,010/秒、うち ClipBand 1,216/秒。帯は数に比例して増える
// ので「編集を続けるほど重い」になる。
//
// 返す物は無い（副作用だけ）。この部品が毎コマ描き直っても、中身（子）が無いので誰も巻き添えにならない。
// 読む囲いは全部 App の積んだ物（AppInner の中で作る束は読まない）ので、AppInner の隣に置ける。
import { useVideoSync } from './useVideoSync'

export function VideoSyncRunner(): null {
  useVideoSync()
  return null
}
