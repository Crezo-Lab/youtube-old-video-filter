# 手元の試験台（本物の YouTube を開かずに動きを確かめる）

## 開き方
エクスプローラーで `tests/fixture.html` を Chrome にドラッグするか、アドレス欄に `file:///G:/マイドライブ/youtube-old-video-filter 2/tests/fixture.html` と入れる（file:// で開く）。拡張機能としてのインストールは要らない。`../content.js` と `../content.css` を直接読む。

設定は URL の後ろに足して変える（`chrome-stub.js` が chrome.storage の代わりをする）。
`fixture.html?amount=6&unit=month&mode=dim&hideShorts=0&hideWatched=1&watchedPercent=80&allow=@oldmaster&block=@spammer&pages=home,search&enabled=1`
省略した項目は content.js の既定値。

## 画面の見方
- 上の黒い帯: 隠れた数 / 薄くした数 / カード数 / run の回数・最後・最大・平均(ms) / 手動 run(ms) / 想定との食い違い。
- 「想定との食い違い」: カードの data-*（投稿時期・再生バー・チャンネル）と URL の設定だけから別に出した答えと、実際の結果の突き合わせ。0 が正しい。0 でなければ、帯の赤字に最初の3件が出る。
- 「カードを100件足す」: 無限スクロールのまね。「再生バーを毎秒書き換え」: YouTube の絶え間ない style 書き換えのまね。両方入れて run の最大 ms が伸びないかを見る。
- 自動で負荷をかける: `?add=10`（100件×10回）、`?bar=1`（再生バーの書き換えを最初から動かす）。
- 画面は3つ（ホーム・検索・再生画面の右）。ショート棚・続きの読み込み・ライブ・プレミア公開・読めない投稿時期のカードも入っている。

## 見るべき点
1. 食い違いが 0 か（`unit`・`amount`・`mode=dim`・`allow`・`block`・`hideShorts=0` を変えても）。
2. 再生バー書き換え中に、run の最大 ms が数十 ms を超えないか。カードが増えるほど伸びるなら全カードを毎回走査している。
3. ライブ・プレミアが「古い」で隠れていないか。
4. 隠したあとのグリッドに歯抜けが無いか（目で見る）。

## 注意
- file:// では pathname がファイルの場所になり、content.js の pageType() は "other" になる。stub が pages.other を有効にして動かしているので、ページ別の on/off（`pages=`）の試験は home/search/watch の区別では効かない（other の有効・無効だけ効く）。
- 初回の run は設定の取得後に同期で動く。「run 回数」は 200ms の間引きのあとで動いた分だけ数える。

## node の試験
`node tests/parse.test.mjs` — content.js を最小の偽物の中で読み込み、`window.__ytofParse`（parseAgeDays）が 日本語/英語の「◯日前」「N years ago」を正しく日数にし、ライブ・再生数などは null にするかを確かめる。jsdom などは使わない（追加のインストール不要）。
