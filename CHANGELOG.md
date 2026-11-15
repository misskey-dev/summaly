# Changelog

## [5.5.1-psr.4.3.4](https://github.com/Soli0222/summaly/compare/5.5.1-psr.4.3.3...5.5.1-psr.4.3.4) (2026-11-13)


### バグ修正・依存関係の更新

* **deps:** update node.js to v26.13.1 ([#211](https://github.com/Soli0222/summaly/issues/211)) ([64c8eed](https://github.com/Soli0222/summaly/commit/64c8eed9faba4d56061e600fffac000c5654092c))

## [5.5.1-psr.4.3.3](https://github.com/Soli0222/summaly/compare/5.5.1-psr.4.3.2...5.5.1-psr.4.3.3) (2026-11-07)


### バグ修正・依存関係の更新

* **deps:** update node @types/node to v26.6.6 ([#197](https://github.com/Soli0222/summaly/issues/197)) ([bae0c3e](https://github.com/Soli0222/summaly/commit/bae0c3e094e9f5bcb3a18136cfb689d4484ba1ca))
* **deps:** update node got to v16.2.0 ([#200](https://github.com/Soli0222/summaly/issues/200)) ([bd1544d](https://github.com/Soli0222/summaly/commit/bd1544d0c7b01ca939f55a10c37be27e943b791f))
* **deps:** update node.js to v26.13.0 ([#189](https://github.com/Soli0222/summaly/issues/189)) ([d5d73e3](https://github.com/Soli0222/summaly/commit/d5d73e3e5408f933870980dbb94b64da60c72b83))

## [5.5.1-psr.4.3.2](https://github.com/Soli0222/summaly/compare/5.5.1-psr.4.3.1...5.5.1-psr.4.3.2) (2026-10-22)


### バグ修正・依存関係の更新

* **deps:** update node.js to v26.12.1 ([#181](https://github.com/Soli0222/summaly/issues/181)) ([94b8920](https://github.com/Soli0222/summaly/commit/94b89200696f90d6f44172216167eeba67590db1))

## [5.5.1-psr.4.3.1](https://github.com/Soli0222/summaly/compare/5.5.1-psr.4.3...5.5.1-psr.4.3.1) (2026-10-21)


### バグ修正・依存関係の更新

* automate current Node.js releases and publish the Summaly chart ([#179](https://github.com/Soli0222/summaly/issues/179)) ([e65e2d6](https://github.com/Soli0222/summaly/commit/e65e2d654de7c9cc5dd03ce216db2a2eeef84316))
* **ci:** restore Renovate status checks and surface errors ([#142](https://github.com/Soli0222/summaly/issues/142)) ([350a537](https://github.com/Soli0222/summaly/commit/350a537325284b333a30741e754cfe666b051ba7))
* **deps:** update node chardet to v2.2.0 ([#164](https://github.com/Soli0222/summaly/issues/164)) ([615a4a3](https://github.com/Soli0222/summaly/commit/615a4a396f9183500b2975a29404119c0aa169e2))
* **deps:** update node got to v15.1.0 ([#165](https://github.com/Soli0222/summaly/issues/165)) ([0a2cca6](https://github.com/Soli0222/summaly/commit/0a2cca64aa1de50a7c9fff8473b4cf062dd4b87c))
* **deps:** update node got to v16 ([#173](https://github.com/Soli0222/summaly/issues/173)) ([4ac080d](https://github.com/Soli0222/summaly/commit/4ac080d1589f0de6d262002e0220b5de1043d9b2))
* **deps:** update node ipaddr.js to v2.5.0 ([#166](https://github.com/Soli0222/summaly/issues/166)) ([b2d200d](https://github.com/Soli0222/summaly/commit/b2d200db2ed1197ae47cc866c8514811e48e4bee))
* **deps:** update node pino to v10.4.0 ([#167](https://github.com/Soli0222/summaly/issues/167)) ([41728ba](https://github.com/Soli0222/summaly/commit/41728bae2676e81e38795ea3d1390302252f8de0))
* keep TypeScript 6 until typescript-eslint supports TS 7 ([#175](https://github.com/Soli0222/summaly/issues/175)) ([7ffa9f1](https://github.com/Soli0222/summaly/commit/7ffa9f10b0c44a542ae1dee3f5763eec929c55d3))

5.5.1 / 2026/06/20
------------------

* 現在お使いの summaly のバージョンの export の型が `any` になっている問題を修正

5.5.0 / 2026/06/20
------------------

* デフォルトの User Agent に、summaly の readme へのリンクを含めるようにしました。
* 現在お使いの summaly のバージョンを export するように
* 依存関係の更新

5.4.0 / 2026/05/11
------------------
* テキストのデコードに `TextDecoder` を使用するように
  * いくつかの文字コードを採用しているサイトにて文字化けを抑制します
* `twitter:card` タグの値を `thumbnailStyle` として取り出せるように
  * 現在は `summary` および `summary_large_image` の場合のみ値を返し、その他の場合は `null` となります
* 依存関係の更新

5.3.0 / 2026/05/02
------------------
* summalyをバンドルしてビルドするように
  * パスを参照してsummalyの特定のファイルをインポートしている場合はそれらが使用できなくなりますが、想定されている使用方法ではないためBreaking Changeと見做していません。
* 依存関係の見直し
* `SummalyResult`型をexportするように
* summalyを別のプロジェクトにバンドルして使用できない問題を修正
* 依存関係の更新

5.2.5 / 2025/10/22
------------------
* 依存関係の更新

5.2.4 / 2025/10/01
------------------
* 依存関係の更新

5.2.3 / 2025/07/19
------------------
* パッケージが使用できない問題を修正

5.2.2 / 2025/07/06
------------------
* 最初のHEADリクエストにUAが反映されない問題を修正
* 依存関係の更新
* テストスイートをVitestに変更

5.2.1 / 2025/04/28
------------------
* セキュリティに関する修正

5.2.0 / 2025/02/05
------------------
* センシティブフラグの判定を `<meta property="rating">` および `rating` ヘッダでも行うように
* Bluesky（bsky.app）のプレビューに対応
* `fediverse:creator` のパースに対応
* 依存関係の更新
* eslintの設定を更新

5.1.0 / 2024-03-18
------------------
* GETリクエストよりも前にHEADリクエストを送信し、その結果を使用して検証するように (#22)
* 下記のパラメータを`summaly`メソッドのオプションに追加
  - userAgent
  - responseTimeout
  - operationTimeout
  - contentLengthLimit
  - contentLengthRequired

5.0.3 / 2023-12-30
------------------
* Fix .github/workflows/npm-publish.yml

5.0.2 / 2023-12-30
------------------
* Fix .github/workflows/npm-publish.yml

5.0.1 / 2023-12-30
------------------
* Fix .github/workflows/npm-publish.yml

5.0.0 / 2023-12-30
------------------
* support `<link rel="alternate" type="application/activitypub+json" href="{href}">` https://github.com/misskey-dev/summaly/pull/10, https://github.com/misskey-dev/summaly/pull/11
  * 結果の`activityPub`プロパティでherfの内容を取得できます
* branch.ioを用いたディープリンク（spotify.link）などでパースに失敗する問題を修正 https://github.com/misskey-dev/summaly/pull/13
* Twitter Cardが読めていない問題を修正 https://github.com/misskey-dev/summaly/pull/15
* 'mixi:content-rating'をsensitive判定で見ることで、dlsiteなどでセンシティブ情報を得れるように https://github.com/misskey-dev/summaly/pull/16
* sitenameをURLから生成する場合、ポートを含むように (URL.hostname → URL.host)
* `Summary`型に`url`プロパティを追加した`SummalyResult`型をexportするように
* `IPlugin`インターフェースを`SummalyPlugin`に改称

4.0.2 / 2023-04-20
------------------
* YouTubeをフルスクリーンにできない問題を修正

4.0.1 / 2023-03-16
------------------
* oEmbedの読み込みでエラーが発生した際は、エラーにせずplayerの中身をnullにするように

4.0.0 / 2023-03-14
------------------
* oEmbed type=richの制限的なサポート
* プラグインの引数がWHATWG URLになりました

3.0.4 / 2023-02-12
------------------
* 不要な依存関係を除去

3.0.3 / 2023-02-12
------------------
* agentが指定されている（もしくはagentが空のオブジェクトの）場合はプライベートIPのリクエストを許可

3.0.2 / 2023-02-12
------------------
* Fastifyのルーティングを'/url'から'/'に

3.0.1 / 2023-02-12
------------------
* ES Moduleになりました
  - `import { summaly } from 'summaly';`で関数をインポートします
  - デフォルトエクスポートはFastifyプラグインになります
* https/http agents options
* サーバーのコマンドはnpm run serveになりました

2.7.0 / 2022-07-09
------------------
* accept XHTML
* update got to 11.8.5

2.6.0 / 2022-06-18
------------------
* Improve player detection

2.5.0 / 2021-12-17
------------------
* プライベートIPアドレス等は拒否するように
* Update dependencies

2.3.1 / 2019-09-02
------------------
* Fix amazon support
* Update dependencies

2.3.0 / 2019-06-18
------------------
* Lang support

2.2.0 / 2018-08-29
------------------
* Add standalone server

2.1.4 / 2018-08-22
------------------
* Fix bug

2.1.3 / 2018-08-16
------------------
* Fix bug

2.1.2 / 2018-08-11
------------------
* Fix bug

2.1.1 / 2018-08-10
------------------
* Fix bug

2.1.0 / 2018-08-09
------------------
* Add twitter:player support
* Dependency updates

2.0.6 / 2018-05-18
------------------
* Fix bug

2.0.5 / 2018-05-18
------------------
* Fix bug

2.0.4 / 2018-04-18
------------------
* Dependencies update

2.0.3 / 2017-05-06
------------------
* Improve title cleanuping

2.0.2 / 2017-05-04
------------------
* Support more favicon cases #64
* Update some dependencies
* Bug fix

2.0.1 / 2017-03-11
------------------
* Update some dependencies
* Some refactors

2.0.0 / 2017-02-08
------------------
* **[BREAKING CHANGE] Renamed: Plugins: Method `summary` is now `summarize`**
* Some refactors

1.6.1 / 2017-02-06
------------------
* Fix the incorrect type definition

1.6.0 / 2017-02-05
------------------
* Add user-defined plugin support #22
* Add `followRedirects` option #16
* Add `url` property to result #15

1.5.0 / 2017-01-31
------------------
* Improve: Check favicon exist #7
* [Plugin:Wikipedia] Improve: Clip description #11
* Fix: Import the missing function

1.4.1 / 2017-01-30
------------------
* [Plugin:Wikipedia] Fix bug

1.4.0 / 2017-01-30
------------------
* Follow redirects #5

1.3.0 / 2017-01-15
------------------
* Improve: Better Wikipedia support #2
* Remove babel completely

1.2.7 / 2016-12-11
------------------
* iroiro
* Remove babel

1.2.6 / 2016-10-23
------------------
* Bug fix

1.2.5 / 2016-10-23
------------------
* Fix type definitions problem

1.2.4 / 2016-09-22
------------------
* Fix: Add missing dependency

1.2.3 / 2016-09-15
------------------
* Improvement

1.2.2 / 2016-09-15
------------------
* Bug fix

1.2.1 / 2016-09-15
------------------
* Some improvements
* Some bug fixes

1.2.0 / 2016-09-15
------------------
* Amazon support

1.1.3 / 2016-09-15
------------------
* [Plugin:Wikipedia] Bug fix

1.1.2 / 2016-09-15
------------------
* Bug fix

1.1.1 / 2016-09-15
------------------
* Bug fix

1.1.0 / 2016-09-15
------------------
* Some improvements

1.0.0 / 2016-09-15
------------------
**[BREAKING CHANGE] なんかもうめっちゃ変えた**

0.0.1 / 2016-09-13
------------------
* :bug: Some bug fixes
  * https://github.com/syuilo/summaly/commit/65de5ae1fbf6a0f4dacccc12f2a2e027142ae4b0
  * https://github.com/syuilo/summaly/commit/33132b2ba2744835c52b72da4c4c8b854b0d2045

0.0.0 / 2016-09-13
------------------
Initial release
