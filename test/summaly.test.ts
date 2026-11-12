// Derived from misskey-dev/summaly (MIT)
import { readFileSync } from 'node:fs';
import http, { Agent as httpAgent } from 'node:http';
import { Agent as httpsAgent } from 'node:https';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createSummarizer, defaultSummarizeOptions } from '@/index.js';
import { StatusError } from '@/http/status-error.js';
import type { GeneralScrapingOptions, Summary, SummaryPlugin } from '@/types.js';
import { DEFAULT_BOT_UA } from '@/version.js';
import { loopbackAgents } from './helpers/loopback-agent.js';
import { startTestServer, type TestServer } from './helpers/test-server.js';

/** These tests serve different content at the same URL, so results must not be cached across calls. */
const summarize = createSummarizer({ cache: false });

/** Replaces upstream's SUMMALY_ALLOW_PRIVATE_IP=true for tests that do not exercise the env var itself. */
const allowedPrivateNetworks = ['127.0.0.0/8', '::1/128'];

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

const servers: TestServer[] = [];
const cleanups: (() => void)[] = [];
const ALLOW_PRIVATE_IP_VARS = ['CHIRAMISS_ALLOW_PRIVATE_IP', 'SUMMALY_ALLOW_PRIVATE_IP'] as const;
const originalAllowPrivateIp = ALLOW_PRIVATE_IP_VARS.map(name => [name, process.env[name]] as const);

beforeEach(() => {
	for (const name of ALLOW_PRIVATE_IP_VARS) {
		delete process.env[name];
	}
});

afterEach(async () => {
	for (const [name, value] of originalAllowPrivateIp) {
		if (value === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = value;
		}
	}
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
	await Promise.all(servers.splice(0).map(s => s.close()));
});

/** Starts a test server on an ephemeral port and returns its origin such as `http://127.0.0.1:12345`. */
async function serve(handler: Handler, host?: string): Promise<string> {
	const server = await startTestServer(handler, host);

	servers.push(server);

	return server.url.replace(/\/$/, '');
}

function fixture(path: string): Buffer {
	return readFileSync(new URL(`./fixtures/${path}`, import.meta.url));
}

/** Like the upstream fastify `app.get('/')` routes: `/` (GET and HEAD) gets `handler`, anything else is 404. */
function onlyRoot(handler: Handler): Handler {
	return (req, res) => {
		if (new URL(req.url ?? '/', 'http://localhost').pathname === '/') {
			handler(req, res);
		} else {
			res.writeHead(404).end();
		}
	};
}

function sendWithLength(res: http.ServerResponse, content: Buffer) {
	res.writeHead(200, { 'content-length': content.byteLength, 'content-type': 'text/html' });
	res.end(content);
}

/** Sends the body without content-length (chunked), like upstream's `reply.send(stream)`. */
function sendStream(res: http.ServerResponse, chunks: Buffer[]) {
	res.writeHead(200, { 'content-type': 'text/html' });
	for (const chunk of chunks) {
		res.write(chunk);
	}
	res.end();
}

/** An agent that records the port of every connection it opens. */
function hookedAgent(): { agent: http.Agent; ports: number[] } {
	const agent = new http.Agent();
	const ports: number[] = [];
	const original = agent.createConnection.bind(agent);

	agent.createConnection = ((...args: Parameters<typeof original>) => {
		ports.push(Number(args[0].port));

		return original(...args);
	}) as typeof agent.createConnection;
	cleanups.push(() => agent.destroy());

	return { agent, ports };
}

describe('network tests', () => {
	test('Should block localhost by default', async () => {
		const content = fixture('htmls/basic.html');
		const host = await serve((_req, res) => sendWithLength(res, content));

		const summary = await summarize(host).catch((e: StatusError) => e);

		if (summary instanceof StatusError) {
			expect(summary.name).toBe('StatusError');
			expect(summary.statusCode).toBe(400);
			expect(summary.message).toContain('Private IP rejected');
		} else {
			expect(summary).toBeInstanceOf(StatusError);
		}
	});
});

describe('local tests', () => {
	describe('Private IP blocking', () => {
		let host: string;

		beforeEach(async () => {
			process.env.SUMMALY_ALLOW_PRIVATE_IP = 'false';
			const content = fixture('htmls/og-title.html');

			host = await serve((_req, res) => sendWithLength(res, content));
		});

		test('private ipなサーバーの情報を取得できない', async () => {
			const summary = await summarize(host).catch((e: StatusError) => e);

			if (summary instanceof StatusError) {
				expect(summary.name).toBe('StatusError');
			} else {
				expect(summary).toBeInstanceOf(StatusError);
			}
		});

		test('agentが指定されている場合はprivate ipを許可', async () => {
			const agent = {
				http: new httpAgent({ keepAlive: true }),
				https: new httpsAgent({ keepAlive: true }),
			};

			cleanups.push(() => {
				agent.http.destroy();
				agent.https.destroy();
			});
			const summary = await summarize(host, { agent });

			expect(summary.title).toBe('Strawberry Pasta');
		});

		test('agentが空のオブジェクトの場合はprivate ipを許可しない', async () => {
			const summary = await summarize(host, { agent: {} }).catch((e: StatusError) => e);

			if (summary instanceof StatusError) {
				expect(summary.name).toBe('StatusError');
			} else {
				expect(summary).toBeInstanceOf(StatusError);
			}
		});
	});

	describe('UserAgent', () => {
		test('UA設定が反映されていること', async () => {
			const content = fixture('htmls/basic.html');
			let ua: string | undefined = undefined;

			const host = await serve(onlyRoot((req, res) => {
				ua = req.headers['user-agent'];
				sendWithLength(res, content);
			}));

			await summarize(host, { userAgent: 'test-ua', allowedPrivateNetworks });

			expect(ua).toBe('test-ua');
		});
	});

	describe('options', () => {
		test('指定したオプションが以降の呼び出しに引き継がれないこと', async () => {
			const content = fixture('htmls/basic.html');
			const defaults = { ...defaultSummarizeOptions };

			const host = await serve(onlyRoot((_req, res) => sendWithLength(res, content)));

			await expect(summarize(host, { contentLengthLimit: content.byteLength - 1, userAgent: 'test-ua', allowedPrivateNetworks })).rejects.toThrow();
			expect(defaultSummarizeOptions).toEqual(defaults);
			expect(await summarize(host, { allowedPrivateNetworks })).toBeDefined();
		});
	});

	describe('content-length limit', () => {
		test('content-lengthの上限以内であればエラーが起こらないこと', async () => {
			const content = fixture('htmls/basic.html');
			const host = await serve(onlyRoot((_req, res) => sendWithLength(res, content)));

			expect(await summarize(host, { contentLengthLimit: content.byteLength, allowedPrivateNetworks })).toBeDefined();
		});

		test('content-lengthの上限を超えているとエラーになる事', async () => {
			const content = fixture('htmls/basic.html');
			const host = await serve(onlyRoot((_req, res) => sendWithLength(res, content)));

			await expect(summarize(host, { contentLengthLimit: content.byteLength - 1, allowedPrivateNetworks })).rejects.toThrow();
		});

		test('content-lengthなしのストリーム受信中に上限を超えるとエラーになること', async () => {
			const chunk = Buffer.alloc(32, 'a');
			const host = await serve(onlyRoot((_req, res) => sendStream(res, [chunk, chunk])));

			await expect(summarize(host, { contentLengthLimit: 16, allowedPrivateNetworks })).rejects.toThrow(/maxSize exceeded \(\d+ > 16\) on response/);
		});
	});

	describe('content-length required', () => {
		test('[オプション有効化時] content-lengthが返された場合はエラーとならないこと', async () => {
			const content = fixture('htmls/basic.html');
			const host = await serve(onlyRoot((_req, res) => sendWithLength(res, content)));

			expect(await summarize(host, { contentLengthRequired: true, contentLengthLimit: content.byteLength, allowedPrivateNetworks })).toBeDefined();
		});

		test('[オプション有効化時] content-lengthが返されない場合はエラーとなること', async () => {
			const content = fixture('htmls/basic.html');
			const host = await serve(onlyRoot((_req, res) => sendStream(res, [content])));

			await expect(summarize(host, { contentLengthRequired: true, allowedPrivateNetworks })).rejects.toThrow();
		});

		test('[オプション無効化時] content-lengthが返された場合はエラーとならないこと', async () => {
			const content = fixture('htmls/basic.html');
			const host = await serve(onlyRoot((_req, res) => sendWithLength(res, content)));

			expect(await summarize(host, { contentLengthRequired: false, contentLengthLimit: content.byteLength, allowedPrivateNetworks })).toBeDefined();
		});

		test('[オプション無効化時] content-lengthが返されなくてもエラーとならないこと', async () => {
			const content = fixture('htmls/basic.html');
			const host = await serve(onlyRoot((_req, res) => sendStream(res, [content])));

			expect(await summarize(host, { contentLengthRequired: false, allowedPrivateNetworks })).toBeDefined();
		});
	});
});

describe('chiramiss additions', () => {
	test('SUMMALY_ALLOW_PRIVATE_IP=true なら allowedPrivateNetworks や agent なしでもローカルサーバーを要約できる (本家互換)', async () => {
		// The top-level afterEach restores the original value.
		process.env.SUMMALY_ALLOW_PRIVATE_IP = 'true';
		const content = fixture('htmls/og-title.html');
		const host = await serve((_req, res) => sendWithLength(res, content));

		const summary = await summarize(host);

		expect(summary.title).toBe('Strawberry Pasta');
	});

	test('CHIRAMISS_ALLOW_PRIVATE_IP=true でも allowedPrivateNetworks や agent なしでローカルサーバーを要約できる', async () => {
		// The top-level afterEach restores the original values.
		process.env.CHIRAMISS_ALLOW_PRIVATE_IP = 'true';
		const content = fixture('htmls/og-title.html');
		const host = await serve((_req, res) => sendWithLength(res, content));

		const summary = await summarize(host);

		expect(summary.title).toBe('Strawberry Pasta');
	});

	test('CHIRAMISS_ALLOW_PRIVATE_IP=false と SUMMALY_ALLOW_PRIVATE_IP=true が両方あれば CHIRAMISS_ALLOW_PRIVATE_IP が優先され、ローカルサーバーは拒否される', async () => {
		// The top-level afterEach restores the original values.
		process.env.CHIRAMISS_ALLOW_PRIVATE_IP = 'false';
		process.env.SUMMALY_ALLOW_PRIVATE_IP = 'true';
		const content = fixture('htmls/og-title.html');
		const host = await serve((_req, res) => sendWithLength(res, content));

		await expect(summarize(host)).rejects.toThrow(StatusError);
	});

	test('Amazon のページ取得は followRedirects: false / contentLengthRequired: true を指定しても本家と同じくリダイレクトに従い content-length を要求しない', async () => {
		const page = fixture('amazon.html');
		const requests: string[] = [];
		const server = await serve((req, res) => {
			requests.push(`${req.method} ${req.headers.host}${req.url}`);
			if (req.url === '/dp/OLD') {
				res.writeHead(301, { location: '/dp/B000000000' });
				res.end();
			} else if (req.url === '/dp/B000000000') {
				sendStream(res, [page]);
			} else {
				res.writeHead(404).end();
			}
		});
		const agents = loopbackAgents(Number(new URL(server).port));

		cleanups.push(() => agents.destroy());

		const summary = await summarize('https://www.amazon.co.jp/dp/OLD', {
			followRedirects: false,
			contentLengthRequired: true,
			agent: { http: agents.http, https: agents.https },
		});

		expect(summary).toMatchObject({
			title: 'KISS 原則の本',
			sitename: 'Amazon',
			url: 'https://www.amazon.co.jp/dp/OLD',
		});
		expect(requests).toEqual(['GET www.amazon.co.jp/dp/OLD', 'GET www.amazon.co.jp/dp/B000000000']);
	});

	test('設定の違う agent を並行に渡しても互いに干渉しない', async () => {
		const pageA = Buffer.from('<html><head><title>A</title></head></html>');
		const pageB = Buffer.from('<html><head><title>B</title></head></html>');
		const hostA = await serve(onlyRoot((_req, res) => sendWithLength(res, pageA)));
		const hostB = await serve(onlyRoot((_req, res) => sendWithLength(res, pageB)));
		const portA = Number(new URL(hostA).port);
		const portB = Number(new URL(hostB).port);
		const a = hookedAgent();
		const b = hookedAgent();

		const [summaryA, summaryB] = await Promise.all([
			summarize(hostA, { agent: { http: a.agent }, userAgent: 'ua-a' }),
			summarize(hostB, { agent: { http: b.agent }, userAgent: 'ua-b' }),
		]);

		expect(summaryA.title).toBe('A');
		expect(summaryB.title).toBe('B');
		// HEAD (final URL), GET (page) and HEAD (/favicon.ico) each went through the caller's own agent only.
		expect(a.ports.length).toBeGreaterThanOrEqual(3);
		expect(b.ports.length).toBeGreaterThanOrEqual(3);
		expect(a.ports.every(port => port === portA)).toBe(true);
		expect(b.ports.every(port => port === portB)).toBe(true);
	});

	test('最終 URL 解決の HEAD もリダイレクト先がプライベート IP なら拒否される', async ({ skip }) => {
		let targetHits = 0;
		const target = await serve((_req, res) => {
			targetHits++;
			sendWithLength(res, Buffer.from('<html><head><title>secret</title></head></html>'));
		}, '127.0.0.1');
		const methods: string[] = [];
		const origin = await serve((req, res) => {
			methods.push(`${req.method} ${req.url}`);
			if (req.method === 'HEAD' && req.url === '/') {
				res.writeHead(302, { location: `${target}/` });
				res.end();
			} else if (req.url === '/') {
				sendWithLength(res, Buffer.from('<html><head><title>origin</title></head></html>'));
			} else {
				res.writeHead(404).end();
			}
		}, '127.0.0.2').catch((e: NodeJS.ErrnoException) => {
			if (e.code === 'EADDRNOTAVAIL') {
				skip('cannot bind 127.0.0.2 on this host (e.g. macOS has no 127.0.0.0/8 loopback aliases); covered on Linux CI');
			}
			throw e;
		});

		const summary = await summarize(`${origin}/`, { allowedPrivateNetworks: ['127.0.0.2/32'] });

		// The HEAD's redirect to 127.0.0.1 is rejected before connecting, so the original URL is used (as upstream does on HEAD failure).
		expect(methods[0]).toBe('HEAD /');
		expect(targetHits).toBe(0);
		expect(summary.url).toBe(`${origin}/`);
		expect(summary.title).toBe('origin');
	});

	test('既定 UA は DEFAULT_BOT_UA', async () => {
		const content = fixture('htmls/basic.html');
		const uas: (string | undefined)[] = [];
		const host = await serve(onlyRoot((req, res) => {
			uas.push(req.headers['user-agent']);
			sendWithLength(res, content);
		}));

		await summarize(host, { allowedPrivateNetworks });

		expect(DEFAULT_BOT_UA).toMatch(/^ChiramissBot\//);
		expect(uas.length).toBeGreaterThanOrEqual(2);
		expect(uas.every(ua => ua === DEFAULT_BOT_UA)).toBe(true);
	});

	test('カスタムプラグインは組み込みより後に評価され、GeneralScrapingOptions を受け取る', async () => {
		const pluginSummary: Summary = {
			title: 'from plugin',
			icon: null,
			description: null,
			thumbnail: null,
			thumbnailStyle: null,
			player: { url: null, width: null, height: null, allow: [] },
			sitename: null,
			activityPub: null,
			fediverseCreator: null,
		};
		const calls: { url: string; opts?: GeneralScrapingOptions }[] = [];
		const plugin: SummaryPlugin = {
			test: () => true,
			summarize: async (url, opts) => {
				calls.push({ url: url.href, opts });

				return { ...pluginSummary };
			},
		};

		// A URL no builtin matches goes to the plugin, with the GeneralScrapingOptions upstream builds:
		// the caller's raw values merged over defaultSummarizeOptions, so unset keys stay undefined and lang is not validated.
		const host = await serve(onlyRoot((_req, res) => sendWithLength(res, Buffer.from('<html></html>'))));
		const custom = await summarize(host, { plugins: [plugin], lang: 'not a valid lang!', allowedPrivateNetworks });

		expect(custom).toEqual({ ...pluginSummary, url: `${host}/` });
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(`${host}/`);
		expect(calls[0].opts).toStrictEqual({
			lang: 'not a valid lang!',
			userAgent: undefined,
			followRedirects: true,
			responseTimeout: undefined,
			operationTimeout: undefined,
			contentLengthLimit: undefined,
			contentLengthRequired: undefined,
		});

		// Values the caller does give are passed through as given.
		const given = await summarize(host, {
			plugins: [plugin],
			lang: 'ja',
			userAgent: 'test-ua',
			followRedirects: false,
			responseTimeout: 1000,
			operationTimeout: 2000,
			contentLengthLimit: 3000,
			contentLengthRequired: true,
			allowedPrivateNetworks,
		});

		expect(given).toEqual({ ...pluginSummary, url: host });
		expect(calls).toHaveLength(2);
		expect(calls[1].opts).toStrictEqual({
			lang: 'ja',
			userAgent: 'test-ua',
			followRedirects: false,
			responseTimeout: 1000,
			operationTimeout: 2000,
			contentLengthLimit: 3000,
			contentLengthRequired: true,
		});

		// A URL a builtin matches goes to the builtin even though the plugin matches too.
		const wikiBody = Buffer.from(JSON.stringify({ query: { pages: { 1: { title: 'Wiki', extract: 'text' } } } }));
		const wiki = await serve((_req, res) => {
			res.writeHead(200, { 'content-type': 'application/json', 'content-length': wikiBody.byteLength });
			res.end(wikiBody);
		});
		const agents = loopbackAgents(Number(new URL(wiki).port));

		cleanups.push(() => agents.destroy());
		const builtin = await summarize('https://ja.wikipedia.org/wiki/Wiki', { plugins: [plugin], agent: { http: agents.http, https: agents.https } });

		expect(builtin).toMatchObject({ title: 'Wiki', description: 'text', sitename: 'Wikipedia', url: 'https://ja.wikipedia.org/wiki/Wiki' });
		expect(calls).toHaveLength(2);
	});
});
