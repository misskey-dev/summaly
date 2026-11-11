import { readFileSync } from 'node:fs';
import type http from 'node:http';
import { afterEach, describe, expect, test } from 'vitest';
import { createScrapeContext, type ScrapeContext } from '@/context.js';
import { amazon } from '@/providers/amazon.js';
import { bluesky } from '@/providers/bluesky.js';
import { branchioDeeplinks } from '@/providers/branchio-deeplinks.js';
import { builtinProviders } from '@/providers/index.js';
import { nvd } from '@/providers/nvd.js';
import { fromPlugin } from '@/providers/provider.js';
import { wikipedia } from '@/providers/wikipedia.js';
import { StatusError } from '@/http/status-error.js';
import type { GeneralScrapingOptions, SummaryPlugin } from '@/types.js';
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
async function loopback(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ ctx: ScrapeContext; received: Received[] }> {
	const received: Received[] = [];
	const server = await startTestServer((req, res) => {
		received.push({ method: req.method ?? '', host: req.headers.host ?? '', url: req.url ?? '', headers: req.headers });
		handler(req, res);
	});

	servers.push(server);
	const agents = loopbackAgents(Number(new URL(server.url).port));

	cleanups.push(() => agents.destroy());

	return { ctx: createScrapeContext({ agent: { http: agents.http, https: agents.https } }), received };
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

	const nvdCases: [string, boolean][] = [
		['https://nvd.nist.gov/vuln/detail/CVE-2026-16478', true],
		['https://nvd.nist.gov/vuln/detail/cve-2026-16478', true],
		['https://nvd.nist.gov/vuln/detail/CVE-2026-16478/', true],
		['http://nvd.nist.gov/vuln/detail/CVE-2026-16478', true],
		['https://nvd.nist.gov/vuln/detail/CVE-2026-16478?x=1#y', true],
		['https://nvd.nist.gov/vuln/search', false],
		['https://nvd.nist.gov/vuln/detail/CVE-2026-16478/change-record', false],
		['https://nvd.nist.gov/vuln/detail/CVE-26-1', false],
		['https://www.nvd.nist.gov/vuln/detail/CVE-2026-16478', false],
		['https://nvd.nist.gov.example.com/vuln/detail/CVE-2026-16478', false],
	];

	test.each(nvdCases)('nvd: %s → %s', (url, expected) => {
		expect(nvd.test(new URL(url))).toBe(expected);
	});
});

describe('builtinProviders', () => {
	test('本家と同じ順の 4 つ (amazon, bluesky, wikipedia, branchio) の後に chiramiss 独自の nvd', () => {
		expect(builtinProviders).toEqual([amazon, bluesky, wikipedia, branchioDeeplinks, nvd]);
		expect(builtinProviders.map(p => p.name)).toEqual(['amazon', 'bluesky', 'wikipedia', 'branchio-deeplinks', 'nvd']);
	});
});

describe('amazon', () => {
	test('#title、#landingImage、#productDescription から title、thumbnail、description を取る', async () => {
		const page = readFileSync(new URL('./fixtures/amazon.html', import.meta.url), 'utf-8');
		const { ctx, received } = await loopback((_req, res) => send(res, page, 'text/html; charset=utf-8'));

		const summary = await amazon.summarize(ctx, new URL('https://www.amazon.co.jp/dp/B000000000'));

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

		const summary = await amazon.summarize(ctx, new URL('https://www.amazon.com/dp/X'));

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

		const summary = await bluesky.summarize(ctx, new URL('https://bsky.app/'));

		expect(summary).toMatchObject({ title: 'Post', description: 'hello', sitename: 'bsky.app' });
		expect(received[0]).toMatchObject({ method: 'GET', host: 'bsky.app', url: '/' });
	});
});

describe('wikipedia', () => {
	test('API を ctx の transport で取得し、本家と同じ形で返す', async () => {
		const extract = 'あ'.repeat(310);
		const body = JSON.stringify({ query: { pages: { 123: { title: 'KISSの原則', extract } } } });
		const { ctx, received } = await loopback((_req, res) => send(res, body, 'application/json; charset=utf-8'));

		const summary = await wikipedia.summarize(ctx, new URL('https://ja.wikipedia.org/wiki/KISS%E3%81%AE%E5%8E%9F%E5%89%87'));

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

		await expect(wikipedia.summarize(ctx, new URL('https://en.wikipedia.org/wiki/X'))).rejects.toThrow('fetch failed');
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

		const summary = await branchioDeeplinks.summarize(ctx, new URL('https://example.app.link/abc?foo=1'));

		expect(summary?.title).toBe('Deep');
		const page = received.find(r => r.url.startsWith('/abc'));

		expect(page?.host).toBe('example.app.link');
		const query = new URL(page?.url ?? '', 'https://example.app.link').searchParams;

		expect(query.get('foo')).toBe('1');
		expect(query.get('$web_only')).toBe('true');
	});
});

describe('nvd', () => {
	type Metric = { type?: string; cvssData?: { baseScore?: number; baseSeverity?: string }; baseSeverity?: string };

	function cveBody(cve: { descriptions?: { lang: string; value: string }[]; metrics?: Record<string, Metric[]> }): string {
		return JSON.stringify({ totalResults: 1, vulnerabilities: [{ cve: { id: 'CVE-2026-16478', ...cve } }] });
	}

	async function summarizeWith(body: string) {
		const { ctx } = await loopback((_req, res) => send(res, body, 'application/json'));

		return await nvd.summarize(ctx, new URL('https://nvd.nist.gov/vuln/detail/cve-2026-16478'));
	}

	test('ID を大文字にして API を ctx の transport で 1 回だけ取得し、深刻度とスコアを title に入れる', async () => {
		const body = cveBody({
			descriptions: [{ lang: 'en', value: 'Permissive list of allowed inputs vulnerability.\n\nThis issue affects pardus-nvidia-installer: before 2.0.1.' }],
			metrics: {
				cvssMetricV31: [{ type: 'Primary', cvssData: { baseScore: 7, baseSeverity: 'HIGH' } }],
			},
		});
		const { ctx, received } = await loopback((_req, res) => send(res, body, 'application/json'));

		const summary = await nvd.summarize(ctx, new URL('https://nvd.nist.gov/vuln/detail/cve-2026-16478'));

		expect(summary).toEqual({
			title: 'CVE-2026-16478 (HIGH 7.0)',
			icon: 'https://nvd.nist.gov/favicon.ico',
			description: 'Permissive list of allowed inputs vulnerability. This issue affects pardus-nvidia-installer: before 2.0.1.',
			thumbnail: null,
			thumbnailStyle: null,
			player: { url: null, width: null, height: null, allow: [] },
			sitename: 'NVD',
			activityPub: null,
			fediverseCreator: null,
		});
		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({ method: 'GET', host: 'services.nvd.nist.gov', url: '/rest/json/cves/2.0?cveId=CVE-2026-16478' });
		expect(received[0].headers['user-agent']).toBe(ctx.options.userAgent);
	});

	test('V4.0 と V3.1 があれば V4.0、Primary と Secondary があれば Primary を使う', async () => {
		const summary = await summarizeWith(cveBody({
			metrics: {
				cvssMetricV40: [
					{ type: 'Secondary', cvssData: { baseScore: 5.3, baseSeverity: 'MEDIUM' } },
					{ type: 'Primary', cvssData: { baseScore: 9.3, baseSeverity: 'CRITICAL' } },
				],
				cvssMetricV31: [{ type: 'Primary', cvssData: { baseScore: 7, baseSeverity: 'HIGH' } }],
			},
		}));

		expect(summary?.title).toBe('CVE-2026-16478 (CRITICAL 9.3)');
	});

	test('cvssMetricV40 が空なら V3.1 に進み、Primary がなければ先頭を使う', async () => {
		const summary = await summarizeWith(cveBody({
			metrics: {
				cvssMetricV40: [],
				cvssMetricV31: [
					{ type: 'Secondary', cvssData: { baseScore: 6.5, baseSeverity: 'MEDIUM' } },
					{ type: 'Secondary', cvssData: { baseScore: 8.8, baseSeverity: 'HIGH' } },
				],
			},
		}));

		expect(summary?.title).toBe('CVE-2026-16478 (MEDIUM 6.5)');
	});

	test('V3.0 しかなければ V3.0 を使う', async () => {
		const summary = await summarizeWith(cveBody({
			metrics: { cvssMetricV30: [{ type: 'Primary', cvssData: { baseScore: 10, baseSeverity: 'CRITICAL' } }] },
		}));

		expect(summary?.title).toBe('CVE-2026-16478 (CRITICAL 10.0)');
	});

	test('V2 は深刻度を metric の直下から取り、深刻度がなければスコアだけを出す', async () => {
		const withSeverity = await summarizeWith(cveBody({
			metrics: { cvssMetricV2: [{ type: 'Primary', cvssData: { baseScore: 5 }, baseSeverity: 'MEDIUM' }] },
		}));
		const withoutSeverity = await summarizeWith(cveBody({
			metrics: { cvssMetricV2: [{ type: 'Primary', cvssData: { baseScore: 5 } }] },
		}));

		expect(withSeverity?.title).toBe('CVE-2026-16478 (MEDIUM 5.0)');
		expect(withoutSeverity?.title).toBe('CVE-2026-16478 (5.0)');
	});

	test('CVSS がないか baseScore がなければ title は ID だけ', async () => {
		expect((await summarizeWith(cveBody({ metrics: {} })))?.title).toBe('CVE-2026-16478');
		expect((await summarizeWith(cveBody({})))?.title).toBe('CVE-2026-16478');
		expect((await summarizeWith(cveBody({ metrics: { cvssMetricV31: [{ type: 'Primary', cvssData: { baseSeverity: 'HIGH' } }] } })))?.title).toBe('CVE-2026-16478');
	});

	test('description は en を優先し、300 文字で切る。説明がなければ null', async () => {
		const long = 'a'.repeat(310);
		const summary = await summarizeWith(cveBody({ descriptions: [{ lang: 'es', value: 'español' }, { lang: 'en', value: long }] }));
		const onlyEs = await summarizeWith(cveBody({ descriptions: [{ lang: 'es', value: 'español' }] }));
		const none = await summarizeWith(cveBody({ descriptions: [] }));

		expect(summary?.description).toBe('a'.repeat(300) + '...');
		expect(onlyEs?.description).toBe('español');
		expect(none?.description).toBeNull();
	});

	test('該当する CVE がなければ CVE not found', async () => {
		await expect(summarizeWith(JSON.stringify({ totalResults: 0, vulnerabilities: [] }))).rejects.toThrow('CVE not found');
	});

	test('API が 403 (レート制限) なら StatusError で失敗し、汎用の抽出には戻らない', async () => {
		const { ctx, received } = await loopback((_req, res) => {
			res.writeHead(403).end();
		});

		await expect(nvd.summarize(ctx, new URL('https://nvd.nist.gov/vuln/detail/CVE-2026-16478'))).rejects.toBeInstanceOf(StatusError);
		expect(received.map(r => r.host)).toEqual(['services.nvd.nist.gov']);
	});
});

describe('fromPlugin', () => {
	test('test() をそのまま使い、summarize() に本家と同じ GeneralScrapingOptions を渡す', async () => {
		let received: { url: URL; opts?: GeneralScrapingOptions } | undefined;
		const plugin: SummaryPlugin = {
			test: url => url.hostname === 'custom.example',
			summarize: async (url, opts) => {
				received = { url, opts };

				return null;
			},
		};
		const provider = fromPlugin(plugin);
		const ctx = createScrapeContext({
			lang: 'ja-JP',
			userAgent: 'test-ua',
			followRedirects: false,
			responseTimeout: 1000,
			operationTimeout: 2000,
			contentLengthLimit: 3000,
			contentLengthRequired: true,
		});

		expect(provider.test(new URL('https://custom.example/'))).toBe(true);
		expect(provider.test(new URL('https://other.example/'))).toBe(false);
		expect(await provider.summarize(ctx, new URL('https://custom.example/a'))).toBeNull();
		expect(received?.url.href).toBe('https://custom.example/a');
		expect(received?.opts).toEqual({
			lang: 'ja-JP',
			userAgent: 'test-ua',
			followRedirects: false,
			responseTimeout: 1000,
			operationTimeout: 2000,
			contentLengthLimit: 3000,
			contentLengthRequired: true,
		});
	});

	test('未指定の値は undefined のまま、lang は検証せずにそのまま渡す', async () => {
		let received: GeneralScrapingOptions | undefined;
		const provider = fromPlugin({
			test: () => true,
			summarize: async (_url, opts) => {
				received = opts;

				return null;
			},
		});

		await provider.summarize(createScrapeContext({ lang: 'not a valid lang!' }), new URL('https://custom.example/'));

		expect(received).toStrictEqual({
			lang: 'not a valid lang!',
			userAgent: undefined,
			followRedirects: undefined,
			responseTimeout: undefined,
			operationTimeout: undefined,
			contentLengthLimit: undefined,
			contentLengthRequired: undefined,
		});
	});
});
