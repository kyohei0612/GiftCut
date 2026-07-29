# FFmpeg について（同梱している物の表示）

GiftCut は、動画の読み込み・書き出しに **FFmpeg** を使っています。
このアプリには FFmpeg の実行ファイル（`ffmpeg.exe` / `ffprobe.exe`）と、
その動作に必要な DLL を**手を加えずにそのまま**同梱しています。

## ライセンス

**GNU Lesser General Public License version 3（LGPL v3）** です。

- 本文: このフォルダの `LGPL-3.0.txt`
- LGPL v3 は GPL v3 への追加条項という形なので、GPL v3 の本文（`GPL-3.0.txt`）も併せて置いてあります

同梱しているのは **LGPL 版**です（`--enable-gpl` も `--enable-nonfree` も付いていません）。
入れ替わっていないことは `npm run check:ffmpeg` が機械で見張っています。

## 同梱している版

```
ffmpeg version N-125781-gacf6b520c1-20260727
```

- 元のソース: https://github.com/FFmpeg/FFmpeg （コミット `acf6b520c1`）
- ビルドの手順（configure の指定も含む）: https://github.com/BtbN/FFmpeg-Builds

ビルド時の指定は、同梱の実行ファイルから誰でも確認できます。

```
ffmpeg -version
```

この出力の `configuration:` の行に、有効にした外部ライブラリ（42件）がすべて並びます。
それぞれのライブラリは各自のライセンス（BSD 系・MIT・LGPL など）に従います。

## 差し替えについて

LGPL は「使う人が、そのライブラリを自分の版に差し替えられること」を求めます。
GiftCut は FFmpeg を**独立した実行ファイル・DLL として**同梱していて、
アプリの中に埋め込んではいません。

アプリのフォルダの中の

```
resources/ffmpeg/
```

にある `ffmpeg.exe` `ffprobe.exe` と DLL を、同じ名前の別の版に置き換えれば、
GiftCut はそちらを使います。

## GiftCut 本体について

GiftCut 自体は FFmpeg とは別の作品で、LGPL の対象ではありません。
FFmpeg を**呼び出して使っている**だけです（プロセスとして起動しています）。
