import { readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import type net from 'node:net';
import { Parser } from 'htmlparser2';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createScrapeContext } from '@/context.js';
import { scrapeGeneral } from '@/extract/general.js';
import { pickDescription, pickImage, pickSiteName, pickTitle } from '@/extract/fields.js';
import { parseHead } from '@/html/head.js';
import type { Summary } from '@/types.js';
import { startTestServer, type TestServer } from './helpers/test-server.js';

/** The fixtures hard-code this origin; it is rewritten to the dynamic test server origin. */
const FIXTURE_ORIGIN = 'http://localhost:3060';
const LOCAL_NETWORKS = ['127.0.0.0/8', '::1/128'];

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, origin: string) => void;

const servers: TestServer[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(servers.splice(0).map(s => s.close()));
});

/**
 * Starts a test server: `'/path'` serves GET and HEAD for that path,
 * `'*'` serves every path, and anything else is 404. Returns the origin (e.g. `http://127.0.0.1:12345`).
 */
async function serve(routes: Partial<Record<string, Handler>>, host?: string): Promise<string> {
	let origin = '';
	const server = await startTestServer((req, res) => {
		const path = new URL(req.url ?? '/', 'http://localhost').pathname;
		const route = routes[path] ?? routes['*'];

		if (!route) {
			res.writeHead(404).end();

			return;
		}
		route(req, res, origin);
	}, host);

	servers.push(server);
	origin = server.url.replace(/\/$/, '');

	return origin;
}

function sendBody(res: http.ServerResponse, content: Buffer | string, contentType: string, headers: http.OutgoingHttpHeaders = {}) {
	const body = Buffer.from(content);

	res.writeHead(200, { 'content-length': body.length, 'content-type': contentType, ...headers });
	res.end(body);
}

/** Serves a file under test/fixtures, with the fixtures' origin replaced by this server's origin. */
function fixture(path: string, contentType = 'text/html', headers: http.OutgoingHttpHeaders = {}): Handler {
	return (_req, res, origin) => {
		const content = readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf-8').replaceAll(FIXTURE_ORIGIN, origin);

		sendBody(res, content, contentType, headers);
	};
}

function html(content: string): Handler {
	return (_req, res) => sendBody(res, content, 'text/html');
}

async function summaly(host: string, ctx = createScrapeContext({ allowedPrivateNetworks: LOCAL_NETWORKS })): Promise<Summary> {
	const summary = await scrapeGeneral(ctx, new URL(host));

	if (summary === null) {
		throw new Error('failed summaly');
	}

	return summary;
}

describe('local tests', () => {
	test('basic', async () => {
		const host = await serve({ '/': fixture('htmls/basic.html') });

		expect(await summaly(host)).toEqual({
			title: 'KISS principle',
			icon: null,
			description: null,
			thumbnail: null,
			thumbnailStyle: null,
			player: {
				url: null,
				width: null,
				height: null,
				'allow': [
					'autoplay',
					'encrypted-media',
					'fullscreen',
				],
			},
			sitename: new URL(host).host,
			sensitive: false,
			activityPub: null,
			fediverseCreator: null,
		});
	});

	test('faviconがHTML上で指定されていないが、ルートに存在する場合、正しく設定される', async () => {
		const host = await serve({
			'/': fixture('htmls/no-favicon.html'),
			'/favicon.ico': (_req, res) => res.writeHead(200).end(),
		});

		const summary = await summaly(host);

		expect(summary.icon).toBe(`${host}/favicon.ico`);
	});

	test('faviconがHTML上で指定されていなくて、ルートにも存在しなかった場合 null になる', async () => {
		const host = await serve({
			'/': fixture('htmls/no-favicon.html'),
			'*': (_req, res) => res.writeHead(404).end(),
		});

		const summary = await summaly(host);

		expect(summary.icon).toBe(null);
	});

	test('titleがcleanupされる', async () => {
		const host = await serve({ '/': fixture('htmls/og-title.html') });

		const summary = await summaly(host);

		expect(summary.title).toBe('Strawberry Pasta');
	});

	describe('OGP', () => {
		test('title', async () => {
			const host = await serve({ '*': fixture('htmls/og-title.html') });

			const summary = await summaly(host);

			expect(summary.title).toBe('Strawberry Pasta');
		});

		test('description', async () => {
			const host = await serve({ '/': fixture('htmls/og-description.html') });

			const summary = await summaly(host);

			expect(summary.description).toBe('Strawberry Pasta');
		});

		test('site_name', async () => {
			const host = await serve({ '/': fixture('htmls/og-site_name.html') });

			const summary = await summaly(host);

			expect(summary.sitename).toBe('Strawberry Pasta');
		});

		test('thumbnail', async () => {
			const host = await serve({ '/': fixture('htmls/og-image.html') });

			const summary = await summaly(host);

			expect(summary.thumbnail).toBe('https://himasaku.net/himasaku.png');
		});
	});

	describe('TwitterCard', () => {
		test('title', async () => {
			const host = await serve({ '/': fixture('htmls/twitter-title.html') });

			const summary = await summaly(host);

			expect(summary.title).toBe('Strawberry Pasta');
		});

		test('description', async () => {
			const host = await serve({ '/': fixture('htmls/twitter-description.html') });

			const summary = await summaly(host);

			expect(summary.description).toBe('Strawberry Pasta');
		});

		test('thumbnail', async () => {
			const host = await serve({ '/': fixture('htmls/twitter-image.html') });

			const summary = await summaly(host);

			expect(summary.thumbnail).toBe('https://himasaku.net/himasaku.png');
		});

		test.each([
			['missing', 'basic.html', null],
			['summary', 'twitter-card-summary.html', 'summary'],
			['summary_large_image', 'twitter-card-summary-large-image.html', 'summary_large_image'],
			['unsupported', 'twitter-card-player.html', null],
		])('thumbnailStyle: %s', async (_label, file, expected) => {
			const host = await serve({ '/': fixture(`htmls/${file}`) });

			const summary = await summaly(host);

			expect(summary.thumbnailStyle).toBe(expected);
		});

		test('Player detection - PeerTube:video => video', async () => {
			const host = await serve({ '/': fixture('htmls/player-peertube-video.html') });

			const summary = await summaly(host);

			expect(summary.player.url).toBe('https://example.com/embedurl');
			expect(summary.player.allow).toStrictEqual(['autoplay', 'encrypted-media', 'fullscreen']);
		});

		test('Player detection - Pleroma:video => video', async () => {
			const host = await serve({ '/': fixture('htmls/player-pleroma-video.html') });

			const summary = await summaly(host);

			expect(summary.player.url).toBe('https://example.com/embedurl');
			expect(summary.player.allow).toStrictEqual(['autoplay', 'encrypted-media', 'fullscreen']);
		});

		test('Player detection - Pleroma:image => image', async () => {
			const host = await serve({ '/': fixture('htmls/player-pleroma-image.html') });

			const summary = await summaly(host);

			expect(summary.thumbnail).toBe('https://example.com/imageurl');
		});
	});

	describe('oEmbed', () => {
		const setUpServer = (oEmbedPath: string, htmlPath = 'htmls/oembed.html') => serve({
			'/': fixture(htmlPath),
			'/oembed.json': fixture(`oembed/${oEmbedPath}`, 'application/json'),
		});

		for (const filename of readdirSync(new URL('./fixtures/oembed/invalid', import.meta.url))) {
			test(`Invalidity test: ${filename}`, async () => {
				const host = await setUpServer(`invalid/${filename}`);
				const summary = await summaly(host);

				expect(summary.player.url).toBe(null);
			});
		}

		test('basic properties', async () => {
			const host = await setUpServer('oembed.json');
			const summary = await summaly(host);

			expect(summary.player.url).toBe('https://example.com/');
			expect(summary.player.width).toBe(500);
			expect(summary.player.height).toBe(300);
		});

		test('type: video', async () => {
			const host = await setUpServer('oembed-video.json');
			const summary = await summaly(host);

			expect(summary.player.url).toBe('https://example.com/');
			expect(summary.player.width).toBe(500);
			expect(summary.player.height).toBe(300);
		});

		test('max height', async () => {
			const host = await setUpServer('oembed-too-tall.json');
			const summary = await summaly(host);

			expect(summary.player.height).toBe(1024);
		});

		test('children are ignored', async () => {
			const host = await setUpServer('oembed-iframe-child.json');
			const summary = await summaly(host);

			expect(summary.player.url).toBe('https://example.com/');
		});

		test('allows fullscreen', async () => {
			const host = await setUpServer('oembed-allow-fullscreen.json');
			const summary = await summaly(host);

			expect(summary.player.url).toBe('https://example.com/');
			expect(summary.player.allow).toStrictEqual(['fullscreen']);
		});

		test('allows legacy allowfullscreen', async () => {
			const host = await setUpServer('oembed-allow-fullscreen-legacy.json');
			const summary = await summaly(host);

			expect(summary.player.url).toBe('https://example.com/');
			expect(summary.player.allow).toStrictEqual(['fullscreen']);
		});

		test('allows safelisted permissions', async () => {
			const host = await setUpServer('oembed-allow-safelisted-permissions.json');
			const summary = await summaly(host);

			expect(summary.player.url).toBe('https://example.com/');
			expect(summary.player.allow).toStrictEqual([
				'autoplay', 'clipboard-write', 'fullscreen',
				'encrypted-media', 'picture-in-picture', 'web-share',
			]);
		});

		test('ignores rare permissions', async () => {
			const host = await setUpServer('oembed-ignore-rare-permissions.json');
			const summary = await summaly(host);

			expect(summary.player.url).toBe('https://example.com/');
			expect(summary.player.allow).toStrictEqual(['autoplay']);
		});

		const setUpServerWithHtml = (html: string) => serve({
			'/': fixture('htmls/oembed.html'),
			'/oembed.json': (_req, res) => sendBody(res, JSON.stringify({
				version: '1.0',
				type: 'rich',
				html,
				width: 500,
				height: 300,
			}), 'application/json'),
		});
		const setUpServerWithAllow = (allow: string) => setUpServerWithHtml(`<iframe src='https://example.com/' allow='${allow}'></iframe>`);

		test('markup nested two deep after the iframe is still accepted', async () => {
			const host = await setUpServerWithHtml('<iframe src=\'https://example.com/\'></iframe><p><b>x</b></p></iframe>');
			const summary = await summaly(host);

			expect(summary.player.url).toBe('https://example.com/');
		});

		test('deeply nested markup is rejected without blocking the event loop', async () => {
			// Parsing every level takes quadratic time in htmlparser2's element stack; the iframe alone would be accepted.
			const host = await setUpServerWithHtml(`<iframe src='https://example.com/'></iframe>${'<b>'.repeat(200_000)}</iframe>`);
			const opened = vi.spyOn(Parser.prototype, 'onopentagname');
			const summary = await summaly(host);

			expect(summary.player.url).toBe(null);
			// Parsing stops just past the depth limit instead of reading every <b> (the page itself adds a few tags).
			expect(opened.mock.calls.length).toBeLessThan(1_000);
		});

		test('whitespace around the separators of allow is dropped', async () => {
			const host = await setUpServerWithAllow('autoplay ;fullscreen;  encrypted-media');
			const summary = await summaly(host);

			expect(summary.player.url).toBe('https://example.com/');
			expect(summary.player.allow).toStrictEqual(['autoplay', 'fullscreen', 'encrypted-media']);
		});

		test('a long run of whitespace in allow does not block the event loop', async () => {
			// Splitting with a pattern that rescans the run from each of its positions takes far longer than the test timeout.
			const host = await setUpServerWithAllow(' '.repeat(300_000));
			const summary = await summaly(host);

			expect(summary.player.url).toBe(null);
		});

		test('oEmbed with relative path', async () => {
			const host = await setUpServer('oembed.json', 'htmls/oembed-relative.html');
			const summary = await summaly(host);

			expect(summary.player.url).toBe('https://example.com/');
		});

		test('oEmbed with nonexistent path', async () => {
			const host = await setUpServer('oembed.json', 'htmls/oembed-nonexistent-path.html');
			const summary = await summaly(host);

			expect(summary.player.url).toBe(null);
			expect(summary.description).toBe('nonexistent');
		});

		test('oEmbed with wrong path', async () => {
			const host = await setUpServer('oembed.json', 'htmls/oembed-wrong-path.html');
			const summary = await summaly(host);

			expect(summary.player.url).toBe(null);
			expect(summary.description).toBe('wrong url');
		});

		test('oEmbed with OpenGraph', async () => {
			const host = await setUpServer('oembed.json', 'htmls/oembed-and-og.html');
			const summary = await summaly(host);

			expect(summary.player.url).toBe('https://example.com/');
			expect(summary.description).toBe('blobcats rule the world');
		});

		test('Invalid oEmbed with valid OpenGraph', async () => {
			const host = await setUpServer('invalid/oembed-insecure.json', 'htmls/oembed-and-og.html');
			const summary = await summaly(host);

			expect(summary.player.url).toBe(null);
			expect(summary.description).toBe('blobcats rule the world');
		});

		test('oEmbed with og:video', async () => {
			const host = await setUpServer('oembed.json', 'htmls/oembed-and-og-video.html');
			const summary = await summaly(host);

			expect(summary.player.url).toBe('https://example.com/');
			expect(summary.player.allow).toStrictEqual([]);
		});

		test('width: 100%', async () => {
			const host = await setUpServer('oembed-percentage-width.json');
			const summary = await summaly(host);

			expect(summary.player.width).toBe(null);
			expect(summary.player.height).toBe(300);
		});
	});

	describe('ActivityPub', () => {
		test('Basic', async () => {
			const host = await serve({ '*': fixture('htmls/activitypub.html') });

			const summary = await summaly(host);

			expect(summary.activityPub).toBe('https://misskey.test/notes/abcdefg');
		});

		test('Null', async () => {
			const host = await serve({ '*': fixture('htmls/basic.html') });

			const summary = await summaly(host);

			expect(summary.activityPub).toBe(null);
		});
	});

	describe('Fediverse Creator', () => {
		test('Basic', async () => {
			const host = await serve({ '*': fixture('htmls/fediverse-creator.html') });

			const summary = await summaly(host);

			expect(summary.fediverseCreator).toBe('@test@example.com');
		});

		test('Null', async () => {
			const host = await serve({ '*': fixture('htmls/basic.html') });

			const summary = await summaly(host);

			expect(summary.fediverseCreator).toBeNull();
		});
	});

	describe('sensitive', () => {
		test('default', async () => {
			const host = await serve({ '/': fixture('htmls/basic.html') });

			expect((await summaly(host)).sensitive).toBe(false);
		});

		test('mixi:content-rating 1', async () => {
			const host = await serve({ '/': fixture('htmls/mixi-sensitive.html') });

			expect((await summaly(host)).sensitive).toBe(true);
		});

		test('meta rating adult', async () => {
			const host = await serve({ '/': fixture('htmls/meta-adult-sensitive.html') });

			expect((await summaly(host)).sensitive).toBe(true);
		});

		test('meta rating rta', async () => {
			const host = await serve({ '/': fixture('htmls/meta-rta-sensitive.html') });

			expect((await summaly(host)).sensitive).toBe(true);
		});

		test('HTTP Header rating adult', async () => {
			const host = await serve({ '/': fixture('htmls/basic.html', 'text/html', { rating: 'adult' }) });

			expect((await summaly(host)).sensitive).toBe(true);
		});

		test('HTTP Header rating rta', async () => {
			const host = await serve({ '/': fixture('htmls/basic.html', 'text/html', { rating: 'RTA-5042-1996-1400-1577-RTA' }) });

			expect((await summaly(host)).sensitive).toBe(true);
		});
	});
});


describe('<head> の形が崩れたページ', () => {
	test('<head> タグがなくても title と og:image が取れる', async () => {
		const host = await serve({
			'/': html('<!DOCTYPE html><html><title>No Head</title><meta property="og:image" content="/image.png"><p>body text</p></html>'),
		});
		const summary = await summaly(host);

		expect(summary.title).toBe('No Head');
		expect(summary.thumbnail).toBe(`${host}/image.png`);
	});

	test('<head> 内に巨大な <script> があっても後ろの title と og:image が取れる', async () => {
		const big = 'a'.repeat(1024 * 1024);
		const host = await serve({
			'/': html(`<!DOCTYPE html><html><head><script>document.write("<body></head>"); var x = "${big}";</script><meta property="og:image" content="https://example.com/big.png"><title>Big Script</title></head><body></body></html>`),
		});
		const summary = await summaly(host);

		expect(summary.title).toBe('Big Script');
		expect(summary.thumbnail).toBe('https://example.com/big.png');
	});
});

describe('取得に呼び出し側の設定が使われる', () => {
	test('oEmbed と favicon の取得にも、渡した agent が使われる', async () => {
		const remotePorts = new Map<string, number>();
		const record = (handler: Handler): Handler => (req, res, origin) => {
			remotePorts.set(`${req.method} ${req.url}`, req.socket.remotePort ?? -1);
			handler(req, res, origin);
		};
		const host = await serve({
			'/': record(fixture('htmls/oembed.html')),
			'/oembed.json': record(fixture('oembed/oembed.json', 'application/json')),
			'/favicon.ico': record((_req, res) => res.writeHead(200).end()),
		});

		const agent = new http.Agent();
		const hookedPorts: number[] = [];
		const original = agent.createConnection.bind(agent);

		agent.createConnection = ((...args: Parameters<typeof original>) => {
			const socket = original(...args) as net.Socket | undefined;

			socket?.once('connect', () => hookedPorts.push(socket.localPort ?? -2));

			return socket;
		}) as typeof agent.createConnection;

		// No allowedPrivateNetworks: the caller-supplied http agent takes over private IP blocking for http:.
		const summary = await summaly(host, createScrapeContext({ agent: { http: agent } }));

		expect(summary.player.url).toBe('https://example.com/');
		expect(summary.icon).toBe(`${host}/favicon.ico`);
		expect([...remotePorts.keys()].sort()).toEqual(['GET /', 'GET /oembed.json', 'HEAD /favicon.ico']);
		for (const port of remotePorts.values()) {
			expect(hookedPorts).toContain(port);
		}
	});

	test('oEmbed と favicon の取得にも、指定した User-Agent が使われる', async () => {
		const userAgents: string[] = [];
		const record = (handler: Handler): Handler => (req, res, origin) => {
			userAgents.push(`${req.method} ${req.url} ${req.headers['user-agent']}`);
			handler(req, res, origin);
		};
		const host = await serve({
			'/': record(fixture('htmls/oembed.html')),
			'/oembed.json': record(fixture('oembed/oembed.json', 'application/json')),
			'/favicon.ico': record((_req, res) => res.writeHead(200).end()),
		});

		await summaly(host, createScrapeContext({ allowedPrivateNetworks: LOCAL_NETWORKS, userAgent: 'TestBot/1.0' }));
		expect(userAgents.sort()).toEqual(['GET / TestBot/1.0', 'GET /oembed.json TestBot/1.0', 'HEAD /favicon.ico TestBot/1.0']);
	});

	test('oEmbed の取得先がプライベート IP なら接続しない', async () => {
		let oEmbedRequests = 0;
		let oEmbedOrigin: string;

		try {
			oEmbedOrigin = await serve({
				'*': (req, res, origin) => {
					oEmbedRequests++;
					fixture('oembed/oembed.json', 'application/json')(req, res, origin);
				},
			}, '::1');
		} catch {
			console.warn('skip: cannot bind ::1');

			return;
		}
		const host = await serve({
			'/': html(`<!DOCTYPE html><link type="application/json+oembed" href="${oEmbedOrigin}/oembed.json" />`),
		});

		// Only 127.0.0.0/8 is exempt, so the page loads but the oEmbed endpoint on ::1 is blocked.
		const summary = await summaly(host, createScrapeContext({ allowedPrivateNetworks: ['127.0.0.0/8'] }));

		expect(summary.player.url).toBe(null);
		expect(oEmbedRequests).toBe(0);
	});
});

describe('fields', () => {
	test('meta の値はエンティティを1回デコードし、title / description / site_name はさらに1回デコードする', () => {
		const head = parseHead([
			'<head>',
			'<meta property="og:title" content="A &amp;amp; B">',
			'<meta property="og:description" content="&lt;b&gt;">',
			'<meta property="og:site_name" content="S &amp; T">',
			'<meta property="og:image" content="/img?a=1&amp;b=2&amp;amp;c=3">',
			'</head>',
		].join(''));

		expect(pickTitle(head)).toBe('A & B');
		expect(pickDescription(head)).toBe('<b>');
		expect(pickSiteName(head, new URL('https://example.com/'))).toBe('S & T');
		expect(pickImage(head, new URL('https://example.com/page'))).toBe('https://example.com/img?a=1&b=2&amp;c=3');
	});

	test('title がどこにもなければ空文字列', () => {
		expect(pickTitle(parseHead('<head></head>'))).toBe('');
	});

	test('rel / type の比較は大文字小文字を区別しない（cheerio の属性セレクタと同じ）', () => {
		const head = parseHead('<head><link rel="IMAGE_SRC" href="/a.png"></head>');

		expect(pickImage(head, new URL('https://example.com/'))).toBe('https://example.com/a.png');
	});

	test('解決できない画像 URL は null', () => {
		const head = parseHead('<head><meta property="og:image" content="http://[invalid"></head>');

		expect(pickImage(head, new URL('https://example.com/'))).toBe(null);
	});
});
