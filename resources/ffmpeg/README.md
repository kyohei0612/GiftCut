# ここに置くもの

配布物へ同梱する `ffmpeg.exe` と `ffprobe.exe`。

## 必ず LGPL 版を置くこと

GPL 版（x264 入り）を置くと、**GiftCut 全体を GPL で配ることになり、
ソース公開の義務が付く**。見た目では区別が付かないので、置いたら必ず:

```
npm run check:ffmpeg
```

で確かめる。`--enable-gpl` が入っていたら止まる。

## 何が要るか

- **H.264 で焼ける手段**が1つ以上（GPU: nvenc/qsv/amf、または libopenh264）
- **libopenh264**（GPU が1つも無い PC のための砦。これが無いと、
  そういう機械で書き出せない）

## 置いていない間

開発中は PC に入っている ffmpeg（PATH）を使うので、空でも動く。
配布物を作るときだけ必要。
