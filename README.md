summaly
================================================================

[![][npm-badge]][npm-link]
[![][mit-badge]][mit]
[![][himawari-badge]][himasaku]
[![][sakurako-badge]][himasaku]

Get summary of web page.

Installation
----------------------------------------------------------------
```
npm install @misskey-dev/summaly
```

Usage
----------------------------------------------------------------
As a function:

```javascript
import { summaly } from 'summaly';

summaly(url[, opts])
```

As Fastify plugin:
(will listen `GET` of `/`)

```javascript
import Summaly from 'summaly';

fastify.register(Summaly[, opts])
```

Run the server:

```
git clone https://github.com/misskey-dev/summaly.git
cd summaly
pnpm install
pnpm build
pnpm serve
```

`pnpm serve` runs `node built/server.js`, so you can also start the built server directly:

```
SUMMALY_HOST=127.0.0.1 SUMMALY_PORT=3000 SUMMALY_LANG=ja-JP node built/server.js
```

The server serves `GET /` and takes the `url` (required) and `lang` query parameters, e.g. `http://localhost:3000/?url=https://example.com/&lang=ja-JP`.

The server is configured with the following environment variables.
Unset or empty variables are ignored, and the default value is used.
Invalid values (e.g. `SUMMALY_PORT=abc`) make the server exit with an error.

| Environment variable                | Maps to (SummalyOptions)    | Type                                           | Default                                       |
|:------------------------------------|:----------------------------|:-----------------------------------------------|:----------------------------------------------|
| **SUMMALY_HOST**                    | (listen address)            | *string*                                       | `localhost`                                   |
| **SUMMALY_PORT**                    | (listen port)               | *integer* (0-65535)                            | `3000`                                        |
| **SUMMALY_LANG**                    | `lang`                      | *string*                                       | the `lang` query parameter of the request     |
| **SUMMALY_USER_AGENT**              | `userAgent`                 | *string*                                       | `SummalyBot/[version] (+[Link to README file in GitHub])` |
| **SUMMALY_FOLLOW_REDIRECTS**        | `followRedirects`           | *boolean* (`true` / `false` / `1` / `0`)       | `false`                                       |
| **SUMMALY_RESPONSE_TIMEOUT**        | `responseTimeout`           | *integer* (milliseconds, 0-2147483647)         | `20000`                                       |
| **SUMMALY_OPERATION_TIMEOUT**       | `operationTimeout`          | *integer* (milliseconds, 0-2147483647)         | `60000`                                       |
| **SUMMALY_CONTENT_LENGTH_LIMIT**    | `contentLengthLimit`        | *integer* (bytes)                              | `10485760`                                    |
| **SUMMALY_CONTENT_LENGTH_REQUIRED** | `contentLengthRequired`     | *boolean* (`true` / `false` / `1` / `0`)       | `false`                                       |

* The server listens on `localhost` by default. Since summaly fetches arbitrary URLs given by clients, be careful when exposing it to other hosts (e.g. `SUMMALY_HOST=0.0.0.0`).
* `SUMMALY_LANG` and `SUMMALY_FOLLOW_REDIRECTS` take precedence over the per-request behavior of the Fastify plugin (the `lang` query parameter and `followRedirects: false`).
* `plugins` and `agent` cannot be configured with environment variables. Register the Fastify plugin in your own server to use them.

Run the server with Docker:

Container images for `linux/amd64` and `linux/arm64` are published to GitHub Container Registry for each release.

```
docker run --rm -p 127.0.0.1:3000:3000 -e SUMMALY_LANG=ja-JP ghcr.io/misskey-dev/summaly:latest
```

Each release is tagged with its version, e.g. `5.6.0`, `5.6` and `5` (pre-releases only with their full version), and the latest release is also tagged as `latest`.

The environment variables above can be passed with `-e`.
In the image, `SUMMALY_HOST` defaults to `0.0.0.0` so that the server is reachable through a published port, and the server runs as the non-root `node` user.
Publish the port only where needed (e.g. `127.0.0.1:3000:3000` as above), or do not publish it and access the server from other containers on the same network.

To build the image yourself:

```
git clone https://github.com/misskey-dev/summaly.git
cd summaly
docker build -t summaly .
docker run --rm -p 127.0.0.1:3000:3000 -e SUMMALY_LANG=ja-JP summaly
```

With Docker Compose, put the following in your `compose.yaml`.
Other services in the same Compose project can access the server at `http://summaly:3000/`.

```yaml
services:
  summaly:
    image: ghcr.io/misskey-dev/summaly:latest
    # To build the image yourself, replace "image" with "build" and the path to the cloned repository,
    # relative to compose.yaml:
    # build: ./summaly
    restart: unless-stopped
    environment:
      SUMMALY_LANG: ja-JP
```

#### opts (SummalyOptions)

| Property                  | Type                   | Description                                                                                                                                                                         | Default                |
|:--------------------------|:-----------------------|:------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-----------------------|
| **lang**                  | *string*               | Accept-Language for the request                                                                                                                                                     | `null`                 |
| **followRedirects**       | *boolean*              | Whether follow redirects                                                                                                                                                            | `true`                 |
| **plugins**               | *plugin[]* (see below) | Custom plugins                                                                                                                                                                      | `null`                 |
| **agent**                 | *Got.Agents*           | Custom HTTP agent (see below)                                                                                                                                                       | `null`                 |
| **userAgent**             | *string*               | User-Agent for the request                                                                                                                                                          | `SummalyBot/[version] (+[Link to README file in GitHub])` |
| **responseTimeout**       | *number*               | Set timeouts for each phase, such as host name resolution and socket communication.                                                                                                 | `20000`                |
| **operationTimeout**      | *number*               | Set the timeout from the start to the end of the request.                                                                                                                           | `60000`                |
| **contentLengthLimit**    | *number*               | If set to true, an error will occur if the content-length value returned from the other server is larger than this parameter (or if the received body size exceeds this parameter). | `10485760`             |
| **contentLengthRequired** | *boolean*              | If set to true, it will be an error if the other server does not return content-length.                                                                                             | `false`                |

#### Plugin

``` typescript
interface SummalyPlugin {
	test: (url: URL) => boolean;
	summarize: (url: URL) => Promise<Summary>;
}
```

urls are WHATWG URL since v4.

#### Custom HTTP agent for proxy
You can specify agents to be passed to Got for proxy use, etc.  
https://github.com/sindresorhus/got/blob/v12.6.0/documentation/tips.md#proxying

**⚠️If you set some agent, local IP rejecting will not work.⚠️**  
(Summaly usually rejects local IPs.)

(Summaly currently does not support http2.)

### Returns

A Promise of an Object that contains properties below:

※ Almost all values are nullable. player should not be null.

#### SummalyResult

| Property        | Type               | Description                                                |
|:----------------|:-------------------|:-----------------------------------------------------------|
| **title**            | *string* \| *null* | The title of the web page                                  |
| **icon**             | *string* \| *null* | The url of the icon of the web page                        |
| **description**      | *string* \| *null* | The description of the web page                            |
| **thumbnail**        | *string* \| *null* | The url of the thumbnail of the web page                   |
| **thumbnailStyle**   | *"summary"* \| *"summary_large_image"* \| *null* | The display style of the thumbnail                         |
| **sitename**         | *string* \| *null* | The name of the web site                                   |
| **player**           | *Player*           | The player of the web page                                 |
| **sensitive**        | *boolean*          | Whether the url is sensitive                               |
| **activityPub**      | *string* \| *null* | The url of the ActivityPub representation of that web page |
| **fediverseCreator** | *string* \| *null* | The pages fediverse handle                                 |
| **url**              | *string*           | The url of the web page                                    |

#### Summary

`Omit<SummalyResult, "url">`

#### Player

| Property   | Type               | Description                                     |
|:-----------|:-------------------|:------------------------------------------------|
| **url**    | *string* \| *null* | The url of the player                           |
| **width**  | *number* \| *null* | The width of the player                         |
| **height** | *number* \| *null* | The height of the player                        |
| **allow**  | *string[]*         | The names of the allowed permissions for iframe |

Currently the possible items in `allow` are:

* `autoplay`
* `clipboard-write`
* `fullscreen`
* `encrypted-media`
* `picture-in-picture`
* `web-share`

See [Permissions Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Permissions_Policy) in MDN for details of them.

### Example

```javascript
import { summaly } from 'summaly';

const summary = await summaly('https://www.youtube.com/watch?v=NMIEAhH_fTU');

console.log(summary);
```

will be ... ↓

```json
{
	"title": "【アイドルマスター】「Stage Bye Stage」(歌：島村卯月、渋谷凛、本田未央)",
	"icon": "https://www.youtube.com/s/desktop/14cba078/img/favicon.ico",
	"description": "Website▶https://columbia.jp/idolmaster/Playlist▶https://www.youtube.com/playlist?list=PL83A2998CF3BBC86D2018年7月18日発売予定THE IDOLM@STER CINDERELLA GIRLS CG STAR...",
	"thumbnail": "https://i.ytimg.com/vi/NMIEAhH_fTU/maxresdefault.jpg",
	"thumbnailStyle": null,
	"player": {
		"url": "https://www.youtube.com/embed/NMIEAhH_fTU?feature=oembed",
		"width": 200,
		"height": 113,
		"allow": [
			"autoplay",
			"clipboard-write",
			"encrypted-media",
			"picture-in-picture",
			"web-share",
			"fullscreen",
		]
	},
	"sitename": "YouTube",
	"sensitive": false,
	"activityPub": null,
	"fediverseCreator": null,
	"url": "https://www.youtube.com/watch?v=NMIEAhH_fTU"
}
```

Testing
----------------------------------------------------------------
`npm run test`

License
----------------------------------------------------------------
[MIT](LICENSE)

[mit]:            http://opensource.org/licenses/MIT
[mit-badge]:      https://img.shields.io/badge/license-MIT-444444.svg?style=flat-square
[himasaku]:       https://himasaku.net
[himawari-badge]: https://img.shields.io/badge/%E5%8F%A4%E8%B0%B7-%E5%90%91%E6%97%A5%E8%91%B5-1684c5.svg?style=flat-square
[sakurako-badge]: https://img.shields.io/badge/%E5%A4%A7%E5%AE%A4-%E6%AB%BB%E5%AD%90-efb02a.svg?style=flat-square
[npm-link]:       https://www.npmjs.com/package/@misskey-dev/summaly
[npm-badge]:      https://img.shields.io/npm/v/@misskey-dev/summaly.svg?style=flat-square
