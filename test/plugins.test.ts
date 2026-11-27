import { readFileSync } from 'node:fs';
import type http from 'node:http';
import { afterEach, describe, expect, test } from 'vitest';
import { createScrapeContext, type ScrapeContext } from '@/context.js';
import { StatusError } from '@/http/status-error.js';
import { defineSummalyPlugin, type SummalyPluginDefinition } from '@/plugin/index.js';
import { createPluginContext } from '@/plugin/context.js';
import { isSummalyPlugin } from '@/plugin/define.js';
import { amazon } from '@/builtin-plugins/amazon.js';
import { bluesky } from '@/builtin-plugins/bluesky.js';
import { branchioDeeplinks } from '@/builtin-plugins/branchio-deeplinks.js';
import { builtinPlugins } from '@/builtin-plugins/list.js';
import { wikipedia } from '@/builtin-plugins/wikipedia.js';
import type { SummalyOptions } from '@/types.js';
import { loopbackAgents } from './helpers/loopback-agent.js';
import { startTestServer, type TestServer } from './helpers/test-server.js';

type Received = { method: string; host: string; url: string; headers: http.IncomingHttpHeaders };

const servers: TestServer[] = [];
const cleanups: (() => void)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
	await Promise.all(servers.splice(0).map(s => s.close()));
});

/**
 * Starts a server that answers every request with `handler`, and a context whose agents route
 * every host to it. Returns the context and the requests the server received.
 */
async function loopback(
	handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
	options: SummalyOptions = {},
): Promise<{ ctx: ScrapeContext; received: Received[] }> {
	const received: Received[] = [];
	const server = await startTestServer((req, res) => {
		received.push({ method: req.method ?? '', host: req.headers.host ?? '', url: req.url ?? '', headers: req.headers });
		handler(req, res);
	});

	servers.push(server);
	const agents = loopbackAgents(Number(new URL(server.url).port));

	cleanups.push(() => agents.destroy());
	const ctx = createScrapeContext({ ...options, agent: { http: agents.http, https: agents.https } });

	cleanups.push(() => ctx.transport.close());

	return { ctx, received };
}

function send(res: http.ServerResponse, body: string, contentType: string) {
	const buf = Buffer.from(body);

	res.writeHead(200, { 'content-type': contentType, 'content-length': buf.length });
	res.end(buf);
}

describe('test()', () => {
	const cases: [string, typeof amazon, string, boolean][] = [
		...[
			'www.amazon.com',
			'www.amazon.co.jp',
			'www.amazon.ca',
			'www.amazon.com.br',
			'www.amazon.com.mx',
			'www.amazon.co.uk',
			'www.amazon.de',
			'www.amazon.fr',
			'www.amazon.it',
			'www.amazon.es',
			'www.amazon.nl',
			'www.amazon.cn',
			'www.amazon.in',
			'www.amazon.au',
		].map(host => ['amazon', amazon, host, true] as [string, typeof amazon, string, boolean]),
		['amazon', amazon, 'amazon.com', false],
		['amazon', amazon, 'smile.amazon.com', false],
		['amazon', amazon, 'www.amazon.com.au', false],
		['bluesky', bluesky, 'bsky.app', true],
		['bluesky', bluesky, 'www.bsky.app', false],
		['bluesky', bluesky, 'bsky.social', false],
		['wikipedia', wikipedia, 'ja.wikipedia.org', true],
		['wikipedia', wikipedia, 'en.m.wikipedia.org', true],
		['wikipedia', wikipedia, 'wikipedia.org', false],
		['wikipedia', wikipedia, 'ja.wikipedia.org.example.com', false],
		['branchio', branchioDeeplinks, 'abc123.app.link', true],
		['branchio', branchioDeeplinks, 'ABC.app.link', true],
		['branchio', branchioDeeplinks, 'spotify.link', true],
		['branchio', branchioDeeplinks, 'app.link', false],
		['branchio', branchioDeeplinks, 'a-b.app.link', false],
		['branchio', branchioDeeplinks, 'x.y.app.link', false],
		['branchio', branchioDeeplinks, 'open.spotify.link', false],
	];

	test.each(cases)('%s: %s → %s', (_name, provider, host, expected) => {
		expect(provider.test(new URL(`https://${host}/path`))).toBe(expected);
	});
});

describe('builtinPlugins', () => {
	test('amazon, bluesky, wikipedia, branchio の順で、名前は summaly: で始まる', () => {
		expect(builtinPlugins).toEqual([amazon, bluesky, wikipedia, branchioDeeplinks]);
		expect(builtinPlugins.map(p => p.name)).toEqual(['summaly:amazon', 'summaly:bluesky', 'summaly:wikipedia', 'summaly:branchio-deeplinks']);
	});
});

describe('amazon', () => {
	test('#title、#landingImage、#productDescription から title、thumbnail、description を取る', async () => {
		const page = readFileSync(new URL('./fixtures/amazon.html', import.meta.url), 'utf-8');
		const { ctx, received } = await loopback((_req, res) => send(res, page, 'text/html; charset=utf-8'));

		const summary = await amazon.summarize(createPluginContext(ctx, new URL('https://www.amazon.co.jp/dp/B000000000')));

		expect(summary).toEqual({
			title: 'KISS 原則の本',
			icon: 'https://www.amazon.com/favicon.ico',
			description: 'シンプルに保て、という原則を説明する本。',
			thumbnail: 'https://m.media-amazon.com/images/I/kiss.jpg',
			thumbnailStyle: 'summary_large_image',
			player: { url: null, width: null, height: null, allow: [] },
			sitename: 'Amazon',
			activityPub: null,
			fediverseCreator: null,
		});
		expect(received.map(r => [r.method, r.host, r.url])).toEqual([['GET', 'www.amazon.co.jp', '/dp/B000000000']]);
	});

	test('#productDescription がなければ meta description、twitter:player があれば player を返す', async () => {
		const page = `<html><head>
			<meta name="description" content=" meta の説明 ">
			<meta name="twitter:player" content="https://player.example.com/embed">
			<meta name="twitter:player:width" content="640">
			<meta name="twitter:player:height" content="360">
		</head><body><div id="title">T</div></body></html>`;
		const { ctx } = await loopback((_req, res) => send(res, page, 'text/html'));

		const summary = await amazon.summarize(createPluginContext(ctx, new URL('https://www.amazon.com/dp/X')));

		expect(summary).toMatchObject({
			title: 'T',
			description: 'meta の説明',
			thumbnail: null,
			thumbnailStyle: null,
			player: { url: 'https://player.example.com/embed', width: 640, height: 360, allow: ['fullscreen', 'encrypted-media'] },
		});
	});
});

describe('bluesky', () => {
	test('GET で取得して汎用の抽出を行う', async () => {
		const page = '<html><head><title>Post</title><meta property="og:description" content="hello"></head></html>';
		const { ctx, received } = await loopback((req, res) => {
			if (req.url === '/') {
				send(res, page, 'text/html');
			} else {
				res.writeHead(404).end();
			}
		});

		const summary = await bluesky.summarize(createPluginContext(ctx, new URL('https://bsky.app/')));

		expect(summary).toMatchObject({ title: 'Post', description: 'hello', sitename: 'bsky.app' });
		expect(received[0]).toMatchObject({ method: 'GET', host: 'bsky.app', url: '/' });
	});
});

describe('wikipedia', () => {
	test('API を ctx の transport で取得して要約する', async () => {
		const extract = 'あ'.repeat(310);
		const body = JSON.stringify({ query: { pages: { 123: { title: 'KISSの原則', extract } } } });
		const { ctx, received } = await loopback((_req, res) => send(res, body, 'application/json; charset=utf-8'));

		const summary = await wikipedia.summarize(createPluginContext(ctx, new URL('https://ja.wikipedia.org/wiki/KISS%E3%81%AE%E5%8E%9F%E5%89%87')));

		expect(summary).toEqual({
			title: 'KISSの原則',
			icon: 'https://wikipedia.org/static/favicon/wikipedia.ico',
			description: 'あ'.repeat(300) + '...',
			thumbnail: 'https://wikipedia.org/static/images/project-logos/jawiki.png',
			thumbnailStyle: 'summary',
			player: { url: null, width: null, height: null, allow: [] },
			sitename: 'Wikipedia',
			activityPub: null,
			fediverseCreator: null,
		});
		expect(received).toHaveLength(1);
		expect(received[0].host).toBe('ja.wikipedia.org');
		expect(received[0].url).toBe('/w/api.php?format=json&action=query&prop=extracts&exintro=&explaintext=&titles=KISS%E3%81%AE%E5%8E%9F%E5%89%87');
		expect(received[0].headers['user-agent']).toBe(ctx.options.userAgent);
	});

	test('query.pages がなければ fetch failed', async () => {
		const { ctx } = await loopback((_req, res) => send(res, '{}', 'application/json'));

		await expect(wikipedia.summarize(createPluginContext(ctx, new URL('https://en.wikipedia.org/wiki/X')))).rejects.toThrow('fetch failed');
	});
});

describe('branchio-deeplinks', () => {
	test('$web_only=true を付けて汎用の抽出を行う', async () => {
		const { ctx, received } = await loopback((req, res) => {
			if (req.url?.startsWith('/abc')) {
				send(res, '<html><head><title>Deep</title></head></html>', 'text/html');
			} else {
				res.writeHead(404).end();
			}
		});

		const summary = await branchioDeeplinks.summarize(createPluginContext(ctx, new URL('https://example.app.link/abc?foo=1')));

		expect(summary?.title).toBe('Deep');
		const page = received.find(r => r.url.startsWith('/abc'));

		expect(page?.host).toBe('example.app.link');
		const query = new URL(page?.url ?? '', 'https://example.app.link').searchParams;

		expect(query.get('foo')).toBe('1');
		expect(query.get('$web_only')).toBe('true');
	});
});

describe('defineSummalyPlugin', () => {
	const summarize = async () => null;

	test('name、test()、summarize() を持つ凍結したプラグインを返す', () => {
		const plugin = defineSummalyPlugin({ name: 'example', test: url => url.hostname === 'example.com', summarize });

		expect(plugin.name).toBe('example');
		expect(plugin.test(new URL('https://example.com/'))).toBe(true);
		expect(plugin.test(new URL('https://example.org/'))).toBe(false);
		expect(Object.isFrozen(plugin)).toBe(true);
		expect(isSummalyPlugin(plugin)).toBe(true);
		expect(isSummalyPlugin({ name: 'plain', test: () => true, summarize })).toBe(false);
	});

	const invalid: [string, unknown, string][] = [
		['name が空', { name: '', test: () => true, summarize }, 'non-empty name'],
		['name が summaly: で始まる', { name: 'summaly:mine', test: () => true, summarize }, 'reserved'],
		['summarize() がない', { name: 'x', test: () => true }, 'needs test() and summarize()'],
		['オブジェクトでない', null, 'takes an object'],
	];

	test.each(invalid)('%s なら TypeError', (_label, definition, message) => {
		expect(() => defineSummalyPlugin(definition as unknown as SummalyPluginDefinition)).toThrow(TypeError);
		expect(() => defineSummalyPlugin(definition as unknown as SummalyPluginDefinition)).toThrow(message);
	});
});

describe('プラグインの ctx', () => {
	test('fetch は ctx の transport を通り、相対 URL は ctx.url を基準にし、User-Agent は変えられない', async () => {
		const { ctx, received } = await loopback((_req, res) => send(res, '{"ok":true}', 'application/json'));
		const pluginCtx = createPluginContext(ctx, new URL('https://api.example/items/1'));

		const res = await pluginCtx.fetch('../list?x=1', { headers: { 'User-Agent': 'other', 'X-Test': 'yes' } });

		expect(res.status).toBe(200);
		expect(res.url).toBe('https://api.example/list?x=1');
		expect(res.text()).toBe('{"ok":true}');
		expect(res.json()).toEqual({ ok: true });
		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({ method: 'GET', host: 'api.example', url: '/list?x=1' });
		expect(received[0].headers['user-agent']).toBe(ctx.options.userAgent);
		expect(received[0].headers['x-test']).toBe('yes');
	});

	test('fetch は成功以外のステータスで StatusError を投げる', async () => {
		const { ctx } = await loopback((_req, res) => res.writeHead(404).end());

		await expect(createPluginContext(ctx, new URL('https://api.example/')).fetch('/missing')).rejects.toThrow(StatusError);
	});

	test('fetchPage は HTML 以外を拒否し、followRedirects と contentLengthRequired だけをその取得で変えられる', async () => {
		const { ctx } = await loopback((req, res) => {
			if (req.url === '/old') {
				res.writeHead(301, { location: '/new' }).end();
			} else if (req.url === '/json') {
				send(res, '{}', 'application/json');
			} else {
				// No content-length
				res.writeHead(200, { 'content-type': 'text/html' });
				res.end('<html><head><title>New</title></head></html>');
			}
		}, { followRedirects: false, contentLengthRequired: true });
		const pluginCtx = createPluginContext(ctx, new URL('https://site.example/old'));

		await expect(pluginCtx.fetchPage('/new')).rejects.toThrow('content-length required');
		// Not following redirects, the 301 itself is the response, and it is not HTML.
		await expect(pluginCtx.fetchPage('/old', { contentLengthRequired: false })).rejects.toThrow('Rejected by type filter');

		const page = await pluginCtx.fetchPage('/old', { followRedirects: true, contentLengthRequired: false });

		expect(page.url.href).toBe('https://site.example/old');
		expect(page.finalUrl.href).toBe('https://site.example/new');
		expect(page.html).toContain('<title>New</title>');
		await expect(pluginCtx.fetchPage('/json', { contentLengthRequired: false })).rejects.toThrow('Rejected by type filter');
	});

	test('summarizePage は page.url を基準に、general は既定で ctx.url を汎用の規則で要約する', async () => {
		const html = '<html><head><title>T</title><link rel="icon" href="/fav.ico"></head></html>';
		const { ctx } = await loopback((req, res) => {
			if (req.method === 'HEAD') {
				res.writeHead(200).end();
			} else {
				send(res, html, 'text/html');
			}
		});
		const { fetchPage, summarizePage, general } = createPluginContext(ctx, new URL('https://site.example/a'));

		const fromPage = await summarizePage(await fetchPage('/a'));
		const fromGeneral = await general();

		expect(fromPage).toMatchObject({ title: 'T', sitename: 'site.example', icon: 'https://site.example/fav.ico' });
		expect(fromGeneral).toEqual(fromPage);
	});

	test('options は既定値を埋めた読み取り専用の値', async () => {
		const { ctx } = await loopback((_req, res) => res.writeHead(404).end(), { lang: 'ja-JP', userAgent: 'ua' });
		const { options } = createPluginContext(ctx, new URL('https://site.example/'));

		expect(options).toEqual({
			lang: 'ja-JP',
			userAgent: 'ua',
			followRedirects: true,
			responseTimeout: 20000,
			operationTimeout: 60000,
			contentLengthLimit: 10 * 1024 * 1024,
			contentLengthRequired: false,
		});
		expect(Object.isFrozen(options)).toBe(true);
	});
});
