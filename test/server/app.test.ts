// Derived from misskey-dev/summaly (MIT)
/**
 * Tests for the standalone server's HTTP endpoints
 */

import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import fastify, { type FastifyInstance } from 'fastify';
import { MemorySummaryCache, type CacheEntry, type InflightCoordinator, type SummaryCache } from '@tiramiss-community/chiramiss';
import { buildApp } from '../src/app.js';
import { loadServerConfig } from '../src/config.js';
import { parseQueryOptions } from '../src/query.js';

const content = fs.readFileSync(new URL('../../chiramiss/test/fixtures/htmls/basic.html', import.meta.url));

/** The page to be summarized is served on loopback, so the private IP block must let it through. */
const LOOPBACK_ENV = { SUMMALY_ALLOWED_PRIVATE_NETWORKS: '127.0.0.0/8' };

describe('環境変数で設定したサーバーの動作', () => {
	let app: FastifyInstance | null = null;
	let target: FastifyInstance | null = null;
	let targetUrl = '';
	let received: { userAgent?: string; acceptLanguage?: string } = {};
	let countedHits = 0;

	beforeEach(async () => {
		received = {};
		countedHits = 0;

		target = fastify();
		target.get('/', (request, reply) => {
			received = {
				userAgent: request.headers['user-agent'],
				acceptLanguage: request.headers['accept-language'],
			};
			reply.header('content-length', content.byteLength);
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		target.get('/redirect', (_request, reply) => {
			reply.code(302);
			reply.header('location', '/');
			reply.header('content-type', 'text/html');
			return reply.send('<html><head><title>Redirect Source</title></head><body></body></html>');
		});
		target.get('/counted', (_request, reply) => {
			countedHits++;
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		await target.listen({ host: '127.0.0.1', port: 0 });
		targetUrl = `http://127.0.0.1:${(target.server.address() as AddressInfo).port}/`;
	});

	afterEach(async () => {
		await app?.close();
		await target?.close();
		app = null;
		target = null;
	});

	async function createApp(env: NodeJS.ProcessEnv, deps?: Parameters<typeof buildApp>[1]): Promise<FastifyInstance> {
		const instance = buildApp(loadServerConfig({ ...LOOPBACK_ENV, ...env }), deps);
		await instance.ready();
		return instance;
	}

	test('url が指定されていない場合は 400 になる', async () => {
		app = await createApp({});
		const res = await app.inject({ method: 'GET', url: '/' });
		expect(res.statusCode).toBe(400);
		expect(res.json()).toEqual({ error: 'url is required' });
	});

	test('環境変数で指定したオプションがプラグインに渡される', async () => {
		app = await createApp({
			SUMMALY_USER_AGENT: 'env-ua/1.0',
			SUMMALY_LANG: 'en-US',
		});
		const res = await app.inject({ method: 'GET', url: '/', query: { url: targetUrl } });

		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({ title: 'KISS principle', url: targetUrl });
		expect(received.userAgent).toBe('env-ua/1.0');
		expect(received.acceptLanguage).toBe('en-US');
	});

	test('SUMMALY_LANG が未設定の場合、lang クエリパラメータが上書きされない', async () => {
		app = await createApp({ SUMMALY_USER_AGENT: 'env-ua/1.0' });
		const res = await app.inject({ method: 'GET', url: '/', query: { url: targetUrl, lang: 'ja-JP' } });

		expect(res.statusCode).toBe(200);
		expect(received.acceptLanguage).toBe('ja-JP');
		expect(received.userAgent).toBe('env-ua/1.0');
	});

	test('SUMMALY_LANG が空文字の場合、lang クエリパラメータが上書きされない', async () => {
		app = await createApp({ SUMMALY_LANG: '' });
		const res = await app.inject({ method: 'GET', url: '/', query: { url: targetUrl, lang: 'ja-JP' } });

		expect(res.statusCode).toBe(200);
		expect(received.acceptLanguage).toBe('ja-JP');
	});

	test('SUMMALY_CONTENT_LENGTH_LIMIT が適用される', async () => {
		app = await createApp({ SUMMALY_CONTENT_LENGTH_LIMIT: String(content.byteLength - 1) });
		const res = await app.inject({ method: 'GET', url: '/', query: { url: targetUrl } });

		expect(res.statusCode).toBe(500);
	});

	// chiramiss additions below

	test('GET /healthz は 200 {status:"ok"}', async () => {
		app = await createApp({});
		const res = await app.inject({ method: 'GET', url: '/healthz' });
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ status: 'ok' });
	});

	test('SUMMALY_ALLOWED_PRIVATE_NETWORKS がなければループバックは拒否される', async () => {
		app = buildApp(loadServerConfig({}));
		const res = await app.inject({ method: 'GET', url: '/', query: { url: targetUrl } });

		expect(res.statusCode).toBe(500);
		expect(res.json().error.statusCode).toBe(400);
		expect(received).toEqual({});
	});

	test('クエリの contentLengthLimit が反映される', async () => {
		app = await createApp({});
		const res = await app.inject({ method: 'GET', url: '/', query: { url: targetUrl, contentLengthLimit: String(content.byteLength - 1) } });

		expect(res.statusCode).toBe(500);
	});

	test('同じ項目は環境変数がクエリより優先される', async () => {
		app = await createApp({ SUMMALY_CONTENT_LENGTH_LIMIT: String(content.byteLength * 10), SUMMALY_USER_AGENT: 'env-ua/1.0' });
		const res = await app.inject({
			method: 'GET',
			url: '/',
			query: { url: targetUrl, contentLengthLimit: String(content.byteLength - 1), userAgent: 'query-ua/1.0' },
		});

		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({ title: 'KISS principle' });
		expect(received.userAgent).toBe('env-ua/1.0');
	});

	test('クエリの userAgent が反映される', async () => {
		app = await createApp({});
		const res = await app.inject({ method: 'GET', url: '/', query: { url: targetUrl, userAgent: 'query-ua/1.0' } });

		expect(res.statusCode).toBe(200);
		expect(received.userAgent).toBe('query-ua/1.0');
	});

	test('不正なクエリ値は無視される', async () => {
		app = await createApp({});
		const res = await app.inject({
			method: 'GET',
			url: `/?url=${encodeURIComponent(targetUrl)}&contentLengthLimit=abc&responseTimeout=-1&operationTimeout=1.5`
				+ '&contentLengthRequired=yes&followRedirects=1&contentLengthLimit=1',
		});

		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({ title: 'KISS principle' });
	});

	test('followRedirects はクエリで true を指定したときだけリダイレクトを追う', async () => {
		app = await createApp({});
		const redirectUrl = new URL('/redirect', targetUrl).href;

		const byDefault = await app.inject({ method: 'GET', url: '/', query: { url: redirectUrl } });
		expect(byDefault.statusCode).toBe(200);
		expect(byDefault.json()).toMatchObject({ title: 'Redirect Source', url: redirectUrl });

		const disabled = await app.inject({ method: 'GET', url: '/', query: { url: redirectUrl, followRedirects: 'false' } });
		expect(disabled.statusCode).toBe(200);
		expect(disabled.json()).toMatchObject({ title: 'Redirect Source', url: redirectUrl });

		const enabled = await app.inject({ method: 'GET', url: '/', query: { url: redirectUrl, followRedirects: 'true' } });
		expect(enabled.statusCode).toBe(200);
		expect(enabled.json()).toMatchObject({ title: 'KISS principle', url: targetUrl });
	});

	test('本体の fetchSummaryFromProxy と同じクエリ形式で呼んで成功する', async () => {
		app = await createApp({});
		// Same as the host's UrlPreviewService.fetchSummaryFromProxy and its query() helper
		const params: Record<string, unknown> = {
			url: targetUrl,
			lang: 'ja-JP',
			followRedirects: true,
			userAgent: 'SummalyBot/0.0.0 (https://misskey.example; +https://github.com/misskey-dev/summaly/blob/master/README.md)',
			operationTimeout: 10000,
			// A bigint column, which the host receives as a string
			contentLengthLimit: '10485760',
			contentLengthRequired: false,
		};
		const queryStr = Object.entries(params)
			.filter(([, v]) => Array.isArray(v) ? v.length : v !== undefined)
			.map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
			.join('&');

		const res = await app.inject({ method: 'GET', url: `/?${queryStr}` });

		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({ title: 'KISS principle', url: targetUrl });
		expect(received.userAgent).toBe(params.userAgent);
		expect(received.acceptLanguage).toBe('ja-JP');
	});

	test('同じ要求の2回目はキャッシュから返る', async () => {
		app = await createApp({});
		const url = new URL('/counted', targetUrl).href;

		const first = await app.inject({ method: 'GET', url: '/', query: { url } });
		const second = await app.inject({ method: 'GET', url: '/', query: { url } });

		expect(first.json()).toEqual(second.json());
		expect(countedHits).toBe(1);
	});

	test('deps で渡した cache と coordinator が使われる', async () => {
		const sets: CacheEntry[] = [];
		const memory = new MemorySummaryCache();
		const cache: SummaryCache = {
			get: key => memory.get(key),
			set: async (key, entry, ttl) => {
				sets.push(entry);
				await memory.set(key, entry, ttl);
			},
		};
		let runs = 0;
		const coordinator: InflightCoordinator = {
			run: (_key, task) => {
				runs++;
				return task();
			},
		};

		app = await createApp({}, { cache, coordinator });
		const res = await app.inject({ method: 'GET', url: '/', query: { url: targetUrl } });

		expect(res.statusCode).toBe(200);
		expect(runs).toBe(1);
		expect(sets).toHaveLength(1);
		expect(sets[0]).toMatchObject({ kind: 'ok', value: { title: 'KISS principle' } });
	});
});

describe('parseQueryOptions', () => {
	test('本体が送るクエリを読む', () => {
		expect(parseQueryOptions({
			url: 'https://example.com/',
			lang: 'ja-JP',
			followRedirects: 'true',
			userAgent: 'MyBot/1.0',
			responseTimeout: '1000',
			operationTimeout: '0',
			contentLengthLimit: '10485760',
			contentLengthRequired: 'false',
		})).toEqual({
			lang: 'ja-JP',
			followRedirects: true,
			userAgent: 'MyBot/1.0',
			responseTimeout: 1000,
			operationTimeout: 0,
			contentLengthLimit: 10485760,
			contentLengthRequired: false,
		});
	});

	test('何もなければ空になる', () => {
		expect(parseQueryOptions({})).toEqual({});
		expect(parseQueryOptions({ url: 'https://example.com/', other: 'x' })).toEqual({});
	});

	test('不正な値と配列は捨てる', () => {
		expect(parseQueryOptions({
			lang: ['ja-JP', 'en-US'],
			followRedirects: '1',
			userAgent: '',
			responseTimeout: '2147483648',
			operationTimeout: '-1',
			contentLengthLimit: '1e3',
			contentLengthRequired: 'TRUE',
		})).toEqual({});
		expect(parseQueryOptions({ contentLengthLimit: ['1', '2'], followRedirects: ['true'] })).toEqual({});
	});
});
