summaly
================================================================

[![][npm-badge]][npm-link]
[![][mit-badge]][mit]
[![][himawari-badge]][himasaku]
[![][sakurako-badge]][himasaku]

Get summary of web page: give it a URL and it returns the page's title, description, thumbnail, icon, oEmbed player and so on.
Misskey uses it for URL previews.

summaly is a library, a Fastify plugin and a standalone server (Docker image `ghcr.io/misskey-dev/summaly`).

* Requests to private IP addresses are blocked **before connecting**, for every redirect and for the oEmbed and favicon requests too.
* Only the `<head>` of a page is parsed, and the page's encoding is decided mostly the way browsers do, while still reading pages whose server declares the wrong charset.
* Results can be cached and in-flight requests shared, through a cache you provide.
* Plugins summarize sites the generic rules cannot, with the same connection settings as the rest of the summary.

Upgrading from v5? See [CHANGELOG.md](./CHANGELOG.md) for the breaking changes.

* [About SummalyBot](#about-summalybot)
* [Installation](#installation)
* [Usage](#usage)
* [Cache and in-flight sharing](#cache-and-in-flight-sharing)
* [Plugins](#plugins)
* [Fastify plugin](#fastify-plugin)
* [Standalone server](#standalone-server)
* [Testing](#testing)
* [License](#license)

About SummalyBot
----------------------------------------------------------------
If you found `SummalyBot` in your access logs, this section is for you.

```
SummalyBot/<version> (+https://github.com/misskey-dev/summaly/blob/master/README.md)
```

**What it does.** SummalyBot makes link previews.
When a user of a Misskey server (or another service that uses summaly) posts a URL, the server fetches that page once to build the preview card shown with the post (title, description, thumbnail).
Besides the page itself it may fetch what the page names for the preview (its oEmbed endpoint and favicon) and follow its redirects.
For a few sites (such as Wikipedia) it reads their public API instead of the page's HTML.
It does not crawl and does not follow other links.

**How to identify it.** By the User-Agent above.
SummalyBot is not a central crawler: each server that uses summaly fetches pages itself, from its own IP addresses, so there is no fixed IP range.
Server administrators can change the User-Agent; Misskey servers usually send `SummalyBot/<version> (<server URL>; +https://github.com/misskey-dev/summaly/blob/master/README.md)`, which names the server that made the request.
For problems with requests from one particular server, contacting that server's administrator is usually the fastest way.

Installation
----------------------------------------------------------------
```
npm install @misskey-dev/summaly
```

Requires Node.js `^22.22.2 || ^24.17.0 || >=26.4.0`. ESM only.

The package has four entry points:

| Entry point                      | What it is for                                                                |
|:---------------------------------|:------------------------------------------------------------------------------|
| `@misskey-dev/summaly`           | `summaly()`, `createSummaly()` and the types of their options and results    |
| `@misskey-dev/summaly/cache`     | [Cache and in-flight sharing](#cache-and-in-flight-sharing)                  |
| `@misskey-dev/summaly/plugin`    | [Plugins](#plugins)                                                           |
| `@misskey-dev/summaly/fastify`   | [Fastify plugin](#fastify-plugin) (needs `fastify`, an optional peer dependency) |

Usage
----------------------------------------------------------------
```javascript
import { summaly } from '@misskey-dev/summaly';

const summary = await summaly('https://example.com/', { lang: 'ja-JP' });
```

`summaly()` uses one instance of `createSummaly()`, made on its first call.
For settings shared by many calls, or to release the instance's connections, make your own:

```javascript
import { createSummaly } from '@misskey-dev/summaly';

const summarize = createSummaly({ lang: 'ja-JP', userAgent: 'MyBot/1.0' });

await summarize('https://example.com/');                 // options given per call are merged over the base
await summarize('https://example.com/', { lang: 'en' });

await summarize.close(); // refuses new calls, waits for the calls in progress, then closes its connections
```

An instance also works with `await using`, which closes it at the end of the scope.
The requests of one instance reuse each other's connections for a short time (up to 4 idle connections per site, closed after 4 seconds of idle time); separate instances never share connections.

### Options

| Option                     | Type                                                  | Default             | Description |
|:---------------------------|:------------------------------------------------------|:--------------------|:------------|
| **lang**                   | `string \| null`                                      | `null`              | `Accept-Language` for the requests |
| **followRedirects**        | `boolean`                                             | `true`              | Whether to follow redirects (at most 10) |
| **plugins**                | `SummalyPlugin[]`                                     | `[]`                | [Plugins](#plugins), tried before the built-in ones |
| **agent**                  | `{ http?: http.Agent, https?: https.Agent }`          | none                | Agents for the requests (see [Private IP blocking](#private-ip-blocking)) |
| **userAgent**              | `string`                                              | `SummalyBot/<version> (+...)` | `User-Agent` for the requests |
| **responseTimeout**        | `number` (ms)                                         | `20000`             | Timeout for connecting and for each wait for data. `0` disables it |
| **operationTimeout**       | `number` (ms)                                         | `60000`             | Timeout for the whole request, redirects included. `0` disables it |
| **contentLengthLimit**     | `number` (bytes)                                      | `10485760`          | Error if `content-length`, the bytes received or the decompressed bytes exceed it |
| **contentLengthRequired**  | `boolean`                                             | `false`             | Error if the response has no `content-length` |
| **allowedPrivateNetworks** | `string[]`                                            | `[]`                | CIDRs exempt from the private IP block, e.g. `['10.0.0.0/8', 'fd00::/8']` |
| **proxy**                  | `{ http?: string, https?: string, noProxy?: string }` | none                | Outbound proxy (see [Proxies](#proxies)) |
| **cache**                  | `SummaryCache \| false`                               | none                | See [Cache and in-flight sharing](#cache-and-in-flight-sharing) |
| **coordinator**            | `InflightCoordinator \| false`                        | none                | See [Cache and in-flight sharing](#cache-and-in-flight-sharing) |

`allowedPrivateNetworks` entries must be canonical CIDRs: IPv4 as four plain decimal numbers without leading zeros (`192.168.10.0/24`, not `192.168.010.0/24`), and IPv4 networks written in IPv4 form rather than as IPv4-mapped IPv6. Other notations throw a `TypeError`.

### Private IP blocking

summaly refuses to connect to private, loopback, link-local and other non-public addresses.
It checks the addresses a host name resolves to before connecting, for every redirect and for the oEmbed and favicon requests too, so a public URL that redirects to a private address is refused as well.
A refused request fails with a `StatusError` whose `statusMessage` is `Private IP Rejected`.

* Networks listed in `allowedPrivateNetworks` are allowed.
* When you pass an `agent` for a scheme, blocking for that scheme is left to your agent (Misskey's agents do it).
  Passing only `agent.http` keeps summaly's own blocking for `https:` requests.
* `SUMMALY_ALLOW_PRIVATE_IP=true` turns the blocking off. **For tests only.**

### Proxies

`proxy.http` is used for `http:` targets and `proxy.https` for `https:` targets.
Proxy URLs must be `http:` or `https:` URLs with a host (`http://user:pass@proxy.example:3128`); anything else throws a `TypeError`, with any credentials removed from the message.
`noProxy` takes a comma-separated list like `NO_PROXY`: `*`, host names or IPs (matching the host and its subdomains, with or without a leading dot), and `host:port` (`[v6]:port` for IPv6).

* summaly sends **`CONNECT` for every target, including `http://` ones**. The proxy must allow `CONNECT` to non-TLS ports such as 80.
* To keep the private IP block in effect, summaly resolves the target itself, checks the addresses, and sends `CONNECT` to **a checked IP address**, not to the host name. The `Host` header, TLS SNI and certificate verification still use the host name.
* A scheme for which you pass an `agent` does not use `proxy`; the agent handles it.

### Result

`summaly()` returns a Promise of a `SummalyResult`.
Almost all values are nullable; `player` is never null.
`icon` and `thumbnail` are http(s) URLs or image `data:` URLs, and `player.url` and `activityPub` are http(s) URLs: other schemes (such as `javascript:`) a page or a plugin gives are replaced with null.

| Property             | Type                                             | Description                                                |
|:---------------------|:-------------------------------------------------|:-----------------------------------------------------------|
| **title**            | *string* \| *null*                               | The title of the web page                                  |
| **icon**             | *string* \| *null*                               | The url of the icon of the web page                        |
| **description**      | *string* \| *null*                               | The description of the web page                            |
| **thumbnail**        | *string* \| *null*                               | The url of the thumbnail of the web page                   |
| **thumbnailStyle**   | *"summary"* \| *"summary_large_image"* \| *null* | The display style of the thumbnail (from `twitter:card`)   |
| **sitename**         | *string* \| *null*                               | The name of the web site                                   |
| **player**           | *Player*                                         | The player of the web page                                 |
| **sensitive**        | *boolean*                                        | Whether the url is sensitive                               |
| **activityPub**      | *string* \| *null*                               | The url of the ActivityPub representation of that web page |
| **fediverseCreator** | *string* \| *null*                               | The page's fediverse handle                                |
| **url**              | *string*                                         | The url of the web page (after redirects)                  |

#### Player

| Property   | Type               | Description                                     |
|:-----------|:-------------------|:------------------------------------------------|
| **url**    | *string* \| *null* | The url of the player                           |
| **width**  | *number* \| *null* | The width of the player                         |
| **height** | *number* \| *null* | The height of the player                        |
| **allow**  | *string[]*         | The names of the allowed permissions for iframe |

Currently the possible items in `allow` are `autoplay`, `clipboard-write`, `fullscreen`, `encrypted-media`, `picture-in-picture` and `web-share`.
See [Permissions Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Permissions_Policy) in MDN for details of them.

### Errors

A failed summary rejects with the error that caused it.
A response with an error status (and a refused private address) gives a `StatusError` (exported), which has `statusCode`, `statusMessage` and `isPermanentError` (true for 4xx).
Timeouts, size limits and connection errors give an `Error` with a message saying so.

### Example

```javascript
import { summaly } from '@misskey-dev/summaly';

const summary = await summaly('https://www.youtube.com/watch?v=NMIEAhH_fTU');

console.log(summary);
```

will be ... ↓

```json
{
	"title": "【アイドルマスター】「Stage Bye Stage」(歌：島村卯月、渋谷凛、本田未央)",
	"icon": "https://www.youtube.com/s/desktop/cb518cf3/img/favicon.ico",
	"description": "Website▶https://columbia.jp/idolmaster/Playlist▶https://www.youtube.com/playlist?list=PL83A2998CF3BBC86D2018年7月18日発売THE IDOLM@STER CINDERELLA GIRLS CG STAR L...",
	"thumbnail": "https://i.ytimg.com/vi/NMIEAhH_fTU/maxresdefault.jpg",
	"thumbnailStyle": "summary_large_image",
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
			"fullscreen"
		]
	},
	"sitename": "YouTube",
	"sensitive": false,
	"activityPub": null,
	"fediverseCreator": null,
	"url": "https://www.youtube.com/watch?v=NMIEAhH_fTU"
}
```

Cache and in-flight sharing
----------------------------------------------------------------
summaly keeps nothing between calls unless you give it a `cache` or a `coordinator` (as an option of `createSummaly` or of a call; `false` in a call turns off the one of its instance).

* A **cache** (`SummaryCache`) keeps summaries, failures included, and the result of each favicon check, so pages of one site share one favicon request.
* A **coordinator** (`InflightCoordinator`) makes calls with the same key wait for the one already running instead of fetching again, so a URL shown on many timelines at once reaches the site once.

```javascript
import { createSummaly } from '@misskey-dev/summaly';
import { InProcessCoordinator } from '@misskey-dev/summaly/cache';

class RedisSummaryCache {
	async get(key) {
		const raw = await redis.get(`summaly:${key}`);
		return raw === null ? undefined : JSON.parse(raw);
	}

	async set(key, entry) {
		// Keep successes for 10 minutes and failures for 1 minute.
		const succeeded = entry.kind === 'ok' || (entry.kind === 'icon' && entry.href !== null);
		await redis.set(`summaly:${key}`, JSON.stringify(entry), 'PX', succeeded ? 600_000 : 60_000);
	}
}

const summarize = createSummaly({ cache: new RedisSummaryCache(), coordinator: new InProcessCoordinator() });
```

* `SummaryCache` has `get(key)` and `set(key, entry)`. Whether and for how long an entry is kept, and how much is kept at all, is up to the cache.
* Entries (`CacheEntry`) survive JSON: `{ kind: 'ok', value }` (a summary), `{ kind: 'error', error }` (a failure: name, message, status), `{ kind: 'icon', href }` (a favicon check; `href` is null when it failed).
* Keys are SHA-256 hex digests of the URL and every option that can change the result (plugins by name, agents by identity within the process), so proxy credentials never appear in them.
* A failing `set` does not fail the summary; a failing `get` does.
* Every caller gets its own copy of a shared or cached result. A cached failure is rethrown as a new `Error` (or `StatusError`) with the original name, message and status, but not the stack.
* `InflightCoordinator` has `run(key, task)`. `run` is called again with another key from inside a running task (a summary waits for its favicon check), so an implementation must only make calls with the same key wait for each other. To limit concurrency, limit the calls to summaly instead.

Plugins
----------------------------------------------------------------
A plugin summarizes the URLs its `test` accepts, for sites the generic rules (meta tags, oEmbed, favicon) cannot summarize well.

```javascript
// my-plugin.js
import { defineSummalyPlugin } from '@misskey-dev/summaly/plugin';

export default defineSummalyPlugin({
	name: 'example',
	test: url => url.hostname === 'example.com',
	summarize: async ({ url, fetch, options }) => {
		if (url.pathname === '/') {
			return null; // leave it to the generic rules
		}
		const api = (await fetch(`/api${url.pathname}`)).json();
		return { title: api.title, description: api.text };
	},
});
```

```javascript
import { summaly } from '@misskey-dev/summaly';
import myPlugin from './my-plugin.js';

await summaly(url, { plugins: [myPlugin] });
```

* Plugins are tried in order, before the built-in ones, with the URL after redirects. The first whose `test` returns true summarizes it.
* `summarize` returns a summary, or `null` to leave the URL to the generic rules. Fields it leaves out are filled in (`null`, an empty player, `sensitive: false`). Throw to fail the summary.
* `name` identifies the plugin, including in cache keys, so two plugins with the same name must behave the same. Names must be unique among the plugins of a call; names starting with `summaly:` are reserved for the built-in plugins.
* Plugins must be made with `defineSummalyPlugin`. `test` and `summarize` are called without `this`.

`summarize` gets a context. Every request made through it uses the summary's connection settings: the private IP block, `allowedPrivateNetworks`, `proxy`, `agent`, User-Agent, timeouts and size limit. Its functions can be destructured.

| Context              | Description |
|:---------------------|:------------|
| `url`                | The URL to summarize |
| `options`            | The summary's settings with the defaults filled in (`lang`, `userAgent`, `followRedirects`, timeouts, size options) |
| `fetch(url, init?)`  | Sends a request (`GET` or `HEAD`; a relative URL is resolved against `url`). Follows redirects, accepts any content type and rejects on an error status. The response has `url`, `status`, `headers`, `body`, `text()` and `json()`. `user-agent` cannot be changed |
| `fetchPage(url, options?)` | GETs an HTML page. `options` can change `followRedirects` and `contentLengthRequired` for this request |
| `summarizePage(page)` | Summarizes a page from `fetchPage` with the generic rules |
| `general(url?)`      | Fetches and summarizes a page with the generic rules (defaults to `url`) |

The built-in plugins handle Amazon product pages, Bluesky, Wikipedia and branch.io deep links.

Fastify plugin
----------------------------------------------------------------
```javascript
import Fastify from 'fastify';
import { fastifySummaly } from '@misskey-dev/summaly/fastify';

const fastify = Fastify();
await fastify.register(fastifySummaly, { lang: 'ja-JP' });
```

It serves `GET /?url=<url>&lang=<lang>&...` (under the `prefix` you register it with) with the summary as JSON.

* The options are summaly's [options](#options), applied to every request. Each registration has its own instance, closed when Fastify closes.
* Besides `url` and `lang`, it reads the options Misskey sends to a summary proxy: `userAgent`, `followRedirects`, `responseTimeout`, `operationTimeout`, `contentLengthLimit` and `contentLengthRequired`. Booleans must be exactly `true` or `false`; malformed or repeated values are ignored.
  * `lang`, `userAgent` and `followRedirects` given as options win over the query. `followRedirects` defaults to `false`.
  * The timeouts and `contentLengthLimit` given as options (or their defaults) are upper bounds: a query value is used only when it is above 0 and not above the bound. A timeout option of `0` (no timeout) has no bound.
  * The query can turn `contentLengthRequired` on, but not off.
* A successful summary has a `Cache-Control` header, for a reverse proxy or a CDN in front: `public, max-age=86400, stale-while-revalidate=43200` by default. The `cacheControl` option changes it (`false` sends none). Errors never have one.
* A missing `url` gives 400 `{ "error": "url is required" }`.
* A failed summary gives 500 `{ "error": { "name", "message", "statusCode"?, "statusMessage"?, "isPermanentError"?, "code"? } }`: the error's name and message (up to 1024 characters), the status for an error response, and the system error code (such as `ENOTFOUND`) for a connection error. Never the stack.

Standalone server
----------------------------------------------------------------
The standalone server is the Fastify plugin at `/`, with an in-process cache and in-flight sharing, plus `GET /healthz` (`{ "status": "ok" }`).
It works as the "Summary proxy" (`urlPreviewSummaryProxyUrl`) of a Misskey server.

> [!WARNING]
> The server fetches any URL its clients ask for. Do not expose it to the internet; let only your Misskey server reach it.

Run it with Docker (images for `linux/amd64` and `linux/arm64` are published to GitHub Container Registry for each release):

```
docker run --rm -p 127.0.0.1:3000:3000 -e SUMMALY_LANG=ja-JP ghcr.io/misskey-dev/summaly:latest
```

Each release is tagged with its version, e.g. `6.0.0`, `6.0` and `6` (pre-releases only with their full version), and the latest release is also tagged as `latest`.
In the image, `SUMMALY_HOST` defaults to `0.0.0.0`, the server runs as the non-root `node` user, and a `HEALTHCHECK` polls `/healthz`.

With Docker Compose, put the following in your `compose.yaml`.
Other services in the same Compose project can access the server at `http://summaly:3000/`.

```yaml
services:
  summaly:
    image: ghcr.io/misskey-dev/summaly:latest
    restart: unless-stopped
    environment:
      SUMMALY_LANG: ja-JP
```

To build and run it from the repository instead:

```
git clone https://github.com/misskey-dev/summaly.git
cd summaly
pnpm install
pnpm build
pnpm serve
```

`pnpm serve` runs `node built-server/server.mjs`. `built-server/` bundles every dependency, so it runs without `node_modules` (their licenses are in `built-server/THIRD-PARTY-LICENSES.txt`). `docker build -t summaly .` builds the image.

The server logs to standard output (Fastify's JSON logs) and, on SIGTERM / SIGINT, answers the requests in progress before exiting.

### Environment variables

Unset or empty variables are ignored, and the default is used. Invalid values (e.g. `SUMMALY_PORT=abc`) make the server exit with an error.

| Environment variable                  | Default                          | Description |
|:--------------------------------------|:---------------------------------|:------------|
| **SUMMALY_HOST**                      | `localhost` (`0.0.0.0` in the Docker image) | Listen address |
| **SUMMALY_PORT**                      | `3000`                           | Listen port (0-65535) |
| **SUMMALY_LANG**                      | the `lang` query parameter       | `Accept-Language` for the requests |
| **SUMMALY_USER_AGENT**                | the `userAgent` query parameter, else `SummalyBot/<version> (+...)` | `User-Agent` for the requests |
| **SUMMALY_FOLLOW_REDIRECTS**          | the `followRedirects` query parameter, else `false` | Whether to follow redirects (`true` / `false` / `1` / `0`) |
| **SUMMALY_RESPONSE_TIMEOUT**          | `20000`                          | Connect / idle timeout in ms (0-2147483647, `0` = none). Upper bound for the query parameter |
| **SUMMALY_OPERATION_TIMEOUT**         | `60000`                          | Whole-request timeout in ms (0-2147483647, `0` = none). Upper bound for the query parameter |
| **SUMMALY_CONTENT_LENGTH_LIMIT**      | `10485760`                       | Maximum response size in bytes. Upper bound for the query parameter |
| **SUMMALY_CONTENT_LENGTH_REQUIRED**   | `false`                          | Reject responses without `content-length` (`true` / `false` / `1` / `0`) |
| **SUMMALY_ALLOWED_PRIVATE_NETWORKS**  | none                             | Comma-separated CIDRs exempt from the private IP block, e.g. `10.0.0.0/8,fd00::/8` |
| **SUMMALY_CACHE_TTL**                 | `300000`                         | How long successful summaries (and favicon checks) are cached, in ms (`0` = not cached) |
| **SUMMALY_ERROR_CACHE_TTL**           | `30000`                          | How long failures are cached, in ms (`0` = not cached) |
| **SUMMALY_CACHE_CONTROL**             | `public, max-age=86400, stale-while-revalidate=43200` | `Cache-Control` header of a successful summary (e.g. `no-store` to keep caches in front from storing it) |
| **HTTP_PROXY** / `http_proxy`         | none                             | Proxy for `http:` targets (see [Proxies](#proxies)) |
| **HTTPS_PROXY** / `https_proxy`       | none                             | Proxy for `https:` targets |
| **NO_PROXY** / `no_proxy`             | none                             | Hosts that bypass the proxy |
| **SUMMALY_ALLOW_PRIVATE_IP**          | unset                            | `true` turns the private IP block off. **For tests only** |

The upper-case proxy variables win over the lower-case ones.
The in-process cache keeps up to 2000 entries (summaries and favicon checks) and up to 64 MiB, and drops the oldest first.

Testing
----------------------------------------------------------------
```
pnpm test
```

Tests that summarize real sites are skipped with `SKIP_NETWORK_TEST=true`.
`pnpm test:docker` builds the Docker image and tests it.

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
