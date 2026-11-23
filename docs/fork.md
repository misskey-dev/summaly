# Fork の変更点 (`Soli0222/summaly` vs `misskey-dev/summaly`)

このドキュメントは、本フォーク (`origin: Soli0222/summaly`) が upstream
(`misskey-dev/summaly`) に対してどのような変更を加えているかをまとめたものです。

## 比較基準

- 比較ベース: `upstream/master` (= `921dbaf` / Release 5.6.0)
- 以下に挙げる差分は、すべてフォークが独自に加えた変更である。
- 差分は `git diff upstream/master` で確認できる。

---

## 1. 配布形態・リリース

### npm 公開の廃止とコンテナイメージ・Helm chart の配布
- `.github/workflows/npm-publish.yml` を削除し、npm への公開を廃止。
- upstream の `.github/workflows/docker.yml` (release 時に `ghcr.io/<owner>/<repo>` へ
  `latest` などのタグで push する) は削除。イメージの公開は fork のリリースパイプライン
  (`release.yaml`) が行い、公開済みのタグを別のリビジョンで上書きしないようにしている。
- `Dockerfile` と `.dockerignore` は upstream のものをそのまま使う
  (`node built/server.js` で起動するマルチステージビルド)。PR と master への push では
  `docker-test.yaml` が amd64 / arm64 のイメージをビルドする。
- Helm chart (`charts/summaly`) を追加し、`oci://ghcr.io/soli0222/charts/summaly` に公開する。

### バージョン系列
- `package.json` の `version` は `<upstream>-psr.<major>.<minor>.<patch>` 形式
  (例: `5.6.0-psr.4.4.0`) のフォーク独自系列で運用し、release-please で更新する。
- `name` は `@misskey-dev/summaly` のまま (npm publish しない前提なので衝突しない)。
- リリース手順の詳細は [releasing.md](./releasing.md) を参照。

---

## 2. サーバー機能

`src/index.ts` の Fastify プラグインに以下を追加・変更している。

### `/health` エンドポイント
- `GET /health` を追加。`{ status: 'ok', timestamp: ISO8601 }` を 200 で返す。

### エラーレスポンスの整形とエラーログ
- `GET /` で 500 を返す際のボディを `{ error: e }` から
  `{ error: { message, name } }` へ変更し、スタックトレースを応答に含めない。
- エラーの詳細 (スタックトレースを含む) は `req.log.error` でサーバー側のログに出す。

### `followRedirects` の既定値
- upstream は `GET /` のハンドラで `followRedirects: false` を options より前に指定しているが、
  本フォークではこれを外し、既定値 (`true`) でリダイレクトを追う。
  `SUMMALY_FOLLOW_REDIRECTS` か、プラグインに渡す options で変更できる。

### ログ
- スタンドアロンサーバー (`src/server/index.ts`) は Fastify 標準のロガーを使い、オプションで次のように設定している。
  - `requestId`: `X-Request-ID` ヘッダーがあればそれを、なければ UUID を使う
    (`requestIdHeader`, `genReqId`, `LogController` の `requestIdLogLabel`)。
  - 受信ログに method, url, query, User-Agent, IP を出す (`serializers.req`)。
  - `level` を数値ではなく文字列 (`"info"` など) で出す (`formatters.level`)。
  - `LOG_LEVEL` (デフォルト `info`) でログレベルを指定し、`NODE_ENV !== 'production'` のときは
    `pino-pretty` で整形する。
- `SummalyOptions` / `GeneralScrapingOptions` に `logger` を追加し、`general` 関数で
  OGP 取得の開始と成功 (statusCode, content-type, content-length) をログに出す。
  Fastify プラグインは `req.log` を渡すので、これらのログにも `requestId` が付く。
  エラーは呼び出し側に投げるので、`general` では出さない。
- 以前は独自の pino ロガー (`src/utils/logger.ts`) を使っていたが、5.6.0 の取り込み時に廃止した。
  Fastify 標準のリクエストログと二重に出ていたうえ、upstream との差分が大きかったため。
  メッセージの文言 (`incoming request` など) は Fastify 標準のままにしている。

---

## 3. プラグイン

### ニコニコ動画プラグインの追加
- `src/plugins/niconico.ts` を新規追加し、`src/plugins/index.ts` に登録。
- `nicovideo.jp` / `www.nicovideo.jp` を対象とする。
- 通常の取得が `StatusError` (例えば年齢確認やログイン要求などで取得不可) を
  返した場合、`www.nicozon.net` に hostname を差し替えて再取得を試みる。
- 再取得が成功した場合は、結果を `parseGeneral` に通したうえで
  - `icon`: `https://resource.video.nimg.jp/web/images/favicon/favicon.ico` (公式)
  - `player.url`: `https://embed.nicovideo.jp/watch/<videoId>?autoplay=1` (640x360)
  - `sitename`: `ニコニコ動画`

  に上書きして返す。再取得も失敗した場合は `null`。

---

## 4. 取得層 (`src/utils/got.ts`)

- `DEFAULT_RESPONSE_TIMEOUT` / `DEFAULT_OPERATION_TIMEOUT` を環境変数
  `SUMMALY_RESPONSE_TIMEOUT` / `SUMMALY_OPERATION_TIMEOUT` (ms / 整数) で
  上書きできるように変更。未設定時は従来通り 20s / 60s。
- upstream 5.6.0 でスタンドアロンサーバーも同名の環境変数を読むようになったため、
  サーバーとして動かす場合はどちらの経路でも同じ値になる。

---

## 5. CI / リポジトリ運用

### GitHub Actions
- `lint.yml` / `test.yml`: アクションと Node.js のバージョンを完全なバージョンで固定し、
  Renovate で更新する。upstream の Node.js のマトリクス (22 / 24 / 26) は使わない。
  `test.yml` では `scripts/release` のテストも実行する。
- リリース関連 (`release.yaml`, `release-retry.yaml`, `weekly-release.yaml`) と
  Helm chart 関連 (`chart-guard.yaml`, `chart-lint.yaml`, `chart-release.yaml`) は
  `Soli0222/shared-workflows` の reusable workflow を呼び出す。
- `renovate.yaml` で Renovate を実行する。

### Renovate
- 設定は `renovate.json5`。upstream の `renovate.json` は、Renovate が `renovate.json5` より
  優先して読んでしまうため削除している。
- Node.js は Dockerfile (`ARG NODE_VERSION`、customManager で docker datasource から取得)・
  CI・`.node-version` をまとめて更新する。
- `@stylistic/eslint-plugin` は `@misskey-dev/oxlint-fmt-config` の peerDependencies で
  完全固定されているため、Renovate では更新しない (upstream と同じ扱い)。

---

## 6. テスト

- `test/docker.test.ts` のプライベート IP 拒否のテストは、本フォークのエラーレスポンス
  (`{ error: { message, name } }`) に合わせて期待値を変えている。
- 独自プラグインである `niconico` の専用テストは現状追加されていない。
