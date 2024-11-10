summaly
================================================================

[![][npm-badge]][npm-link]
[![][mit-badge]][mit]
[![][himawari-badge]][himasaku]
[![][sakurako-badge]][himasaku]

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
NODE_ENV=development npm install
npm run build
npm run serve
```

#### opts (SummalyOptions)

| Property                  | Type                   | Description                                                                                                                                                                         | Default                |
|:--------------------------|:-----------------------|:------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-----------------------|
| **lang**                  | *string*               | Accept-Language for the request                                                                                                                                                     | `null`                 |
| **followRedirects**       | *boolean*              | Whether follow redirects                                                                                                                                                            | `true`                 |
| **plugins**               | *plugin[]* (see below) | Custom plugins                                                                                                                                                                      | `null`                 |
| **agent**                 | *Got.Agents*           | Custom HTTP agent (see below)                                                                                                                                                       | `null`                 |
| **userAgent**             | *string*               | User-Agent for the request                                                                                                                                                          | `SummalyBot/[version]` |
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
| **title**       | *string* \| *null* | The title of the web page                                  |
| **icon**        | *string* \| *null* | The url of the icon of the web page                        |
| **description** | *string* \| *null* | The description of the web page                            |
| **thumbnail**   | *string* \| *null* | The url of the thumbnail of the web page                   |
| **sitename**    | *string* \| *null* | The name of the web site                                   |
| **player**      | *Player*           | The player of the web page                                 |
| **sensitive**   | *boolean*          | Whether the url is sensitive                               |
| **activityPub** | *string* \| *null* | The url of the ActivityPub representation of that web page |
| **url**         | *string*           | The url of the web page                                    |

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
	"icon": "https://www.youtube.com/s/desktop/711fd789/img/logos/favicon.ico",
	"description": "Website▶https://columbia.jp/idolmaster/Playlist▶https://www.youtube.com/playlist?list=PL83A2998CF3BBC86D2018年7月18日発売予定THE IDOLM@STER CINDERELLA GIRLS CG STAR...",
	"thumbnail": "https://i.ytimg.com/vi/NMIEAhH_fTU/maxresdefault.jpg",
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
