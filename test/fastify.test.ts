import Fastify, { type FastifyRegisterOptions } from 'fastify';
import { afterEach, describe, expect, test } from 'vitest';
import { fastifySummaly, type SummalyFastifyOptions } from '@/fastify/index.js';
import { parseQueryOptions, resolveRequestOptions } from '@/fastify/query.js';
import { DEFAULT_MAX_RESPONSE_SIZE, DEFAULT_OPERATION_TIMEOUT, DEFAULT_RESPONSE_TIMEOUT } from '@/options.js';
import { defineSummalyPlugin, type SummalyPlugin } from '@/plugin/index.js';
import { JsonCache } from './helpers/json-cache.js';
import { startTestServer, type TestServer } from './helpers/test-server.js';

const allowedPrivateNetworks = ['127.0.0.0/8', '::1/128'];

const servers: TestServer[] = [];
const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
	await Promise.all(apps.splice(0).map(a => a.close()));
	await Promise.all(servers.splice(0).map(s => s.close()));
});

async function setup(pluginOptions: SummalyFastifyOptions = {}, registerOptions: FastifyRegisterOptions<SummalyFastifyOptions> = {}) {
	const counts = new Map<string, number>();
	const server = await startTestServer((req, res) => {
		counts.set(req.url ?? '', (counts.get(req.url ?? '') ?? 0) + 1);
		if (req.url?.startsWith('/missing')) {
			res.statusCode = 404;
			res.end('not found');

			return;
		}
		if (req.url?.startsWith('/redir')) {
			res.statusCode = 302;
			res.setHeader('location', '/target-page');
			res.end();

			return;
		}
		if (req.url?.startsWith('/target-page')) {
			res.setHeader('content-type', 'text/html');
			res.end('<html><head><title>Redirect Target</title></head><body></body></html>');

			return;
		}
		if (req.url?.startsWith('/echo-lang')) {
			res.setHeader('content-type', 'text/html');
			res.end(`<html><head><title>lang:${req.headers['accept-language']}</title></head><body></body></html>`);

			return;
		}
		res.setHeader('content-type', 'text/html');
		res.end('<html><head><title>Plugin Title</title></head><body></body></html>');
	});

	servers.push(server);
	const app = Fastify();

	apps.push(app);
	await app.register(fastifySummaly, { allowedPrivateNetworks, ...pluginOptions, ...registerOptions });

	const origin = server.url.replace(/\/$/, '');

	return { app, origin, hits: (url: string) => counts.get(url.slice(origin.length)) ?? 0 };
}

describe('fastifySummaly', () => {
	test('returns 400 without url', async () => {
		const { app } = await setup();
		const res = await app.inject({ method: 'GET', url: '/' });

		expect(res.statusCode).toBe(400);
		expect(res.json()).toEqual({ error: 'url is required' });
	});

	test('取得が HTTP エラーなら 500 で、name、message とステータスを返す', async () => {
		const { app, origin } = await setup();
		const res = await app.inject({ method: 'GET', url: '/', query: { url: `${origin}/missing-plugin` } });

		expect(res.statusCode).toBe(500);
		expect(res.json()).toEqual({
			error: { name: 'StatusError', message: '404 Not Found', statusCode: 404, statusMessage: 'Not Found', isPermanentError: true },
		});
	});

	test('接続できなければ、Node.js のエラーコードを返す', async () => {
		const closed = await startTestServer((_req, res) => res.end());
		const url = closed.url;

		await closed.close();
		const { app } = await setup();
		const res = await app.inject({ method: 'GET', url: '/', query: { url } });

		expect(res.statusCode).toBe(500);
		expect(res.json().error).toMatchObject({ code: 'ECONNREFUSED' });
		expect(res.json().error.message).toContain('ECONNREFUSED');
	});

	test('プラグインのエラーは name と message を返し、長いメッセージは切り詰め、スタックは返さない', async () => {
		const throwing = (thrown: unknown) => defineSummalyPlugin({ name: 'throws', test: () => true, summarize: async () => {
			throw thrown;
		} });
		const { app: typeError } = await setup({ plugins: [throwing(new TypeError('boom'))] });
		const { app: long } = await setup({ plugins: [throwing(new Error('x'.repeat(5000)))] });
		const { app: notError } = await setup({ plugins: [throwing('oops')] });
		const query = { url: 'https://example.com/' };

		expect((await typeError.inject({ method: 'GET', url: '/', query })).json()).toEqual({ error: { name: 'TypeError', message: 'boom' } });
		expect((await long.inject({ method: 'GET', url: '/', query })).json().error.message).toBe('x'.repeat(1024));
		expect((await notError.inject({ method: 'GET', url: '/', query })).json()).toEqual({ error: { name: 'Error', message: 'oops' } });
	});

	test('returns the summary', async () => {
		const { app, origin } = await setup();
		const res = await app.inject({ method: 'GET', url: '/', query: { url: `${origin}/ok-plugin` } });

		expect(res.statusCode).toBe(200);
		expect(res.json().title).toBe('Plugin Title');
	});

	test('成功した要約には既定の Cache-Control を付け、エラーには付けない', async () => {
		const { app, origin } = await setup();
		const ok = await app.inject({ method: 'GET', url: '/', query: { url: `${origin}/ok-cache-control` } });
		const failed = await app.inject({ method: 'GET', url: '/', query: { url: `${origin}/missing-cache-control` } });
		const noUrl = await app.inject({ method: 'GET', url: '/' });

		expect(ok.headers['cache-control']).toBe('public, max-age=86400, stale-while-revalidate=43200');
		expect(failed.statusCode).toBe(500);
		expect(failed.headers['cache-control']).toBeUndefined();
		expect(noUrl.headers['cache-control']).toBeUndefined();
	});

	test('cacheControl で Cache-Control を変えられ、false なら付けない', async () => {
		const custom = await setup({ cacheControl: 'no-store' });
		const none = await setup({ cacheControl: false });
		const customRes = await custom.app.inject({ method: 'GET', url: '/', query: { url: `${custom.origin}/ok-custom` } });
		const noneRes = await none.app.inject({ method: 'GET', url: '/', query: { url: `${none.origin}/ok-none` } });

		expect(customRes.headers['cache-control']).toBe('no-store');
		expect(noneRes.statusCode).toBe(200);
		expect(noneRes.headers['cache-control']).toBeUndefined();
	});

	test('does not follow redirects by default', async () => {
		const { app, origin } = await setup();
		const res = await app.inject({ method: 'GET', url: '/', query: { url: `${origin}/redir-default` } });

		expect(JSON.stringify(res.json())).not.toContain('Redirect Target');
	});

	test('forwards the lang query as accept-language', async () => {
		const { app, origin } = await setup();
		const res = await app.inject({ method: 'GET', url: '/', query: { url: `${origin}/echo-lang-1`, lang: 'ja-JP' } });

		expect(res.statusCode).toBe(200);
		expect(res.json().title).toContain('lang:ja-JP');
	});

	test('plugin options override the defaults', async () => {
		const { app, origin } = await setup({ followRedirects: true });
		const res = await app.inject({ method: 'GET', url: '/', query: { url: `${origin}/redir-follow` } });

		expect(res.statusCode).toBe(200);
		expect(res.json().title).toBe('Redirect Target');
	});

	test('Misskey が送るクエリの値を使うが、サイズの上限はクエリで厳しくできても緩められない', async () => {
		// The page is about 70 bytes.
		const limited = await setup({ contentLengthLimit: 10 });
		const loosened = await limited.app.inject({ method: 'GET', url: '/', query: { url: `${limited.origin}/ok-limit`, contentLengthLimit: '100000' } });

		expect(loosened.statusCode).toBe(500);

		const open = await setup();
		const tightened = await open.app.inject({ method: 'GET', url: '/', query: { url: `${open.origin}/ok-limit`, contentLengthLimit: '10' } });
		const followed = await open.app.inject({ method: 'GET', url: '/', query: { url: `${open.origin}/redir-query`, followRedirects: 'true' } });

		expect(tightened.statusCode).toBe(500);
		expect(followed.json().title).toBe('Redirect Target');
	});

	test('url が文字列でなければ 400', async () => {
		const { app, origin } = await setup();
		const res = await app.inject({ method: 'GET', url: `/?url=${encodeURIComponent(`${origin}/a`)}&url=${encodeURIComponent(`${origin}/b`)}` });

		expect(res.statusCode).toBe(400);
	});

	test('prefix を付けて登録できる', async () => {
		const { app, origin } = await setup({}, { prefix: '/summary' });
		const res = await app.inject({ method: 'GET', url: '/summary', query: { url: `${origin}/ok-prefix` } });

		expect(res.statusCode).toBe(200);
		expect(res.json().title).toBe('Plugin Title');
	});

	test('登録時に渡した cache を使い、登録ごとに別のインスタンスになる', async () => {
		const cache = new JsonCache();
		const { app, origin, hits } = await setup({ cache });
		const url = `${origin}/ok-cache`;

		await app.inject({ method: 'GET', url: '/', query: { url } });
		await app.inject({ method: 'GET', url: '/', query: { url } });
		expect(hits(url)).toBe(1);

		// Another registration without a cache fetches every time.
		const other = Fastify();

		apps.push(other);
		await other.register(fastifySummaly, { allowedPrivateNetworks });
		await other.inject({ method: 'GET', url: '/', query: { url } });
		await other.inject({ method: 'GET', url: '/', query: { url } });
		expect(hits(url)).toBe(3);
	});

	test('Fastify を閉じると summaly のインスタンスも閉じ、その後に来た要約は拒否される', async () => {
		const { app, origin } = await setup();
		const res = await app.inject({ method: 'GET', url: '/', query: { url: `${origin}/ok-close` } });

		expect(res.statusCode).toBe(200);
		await app.close();
		await expect(app.inject({ method: 'GET', url: '/', query: { url: `${origin}/ok-close` } })).rejects.toThrow();
	});

	test('defineSummalyPlugin で作っていないプラグインを渡すと登録に失敗する', async () => {
		const app = Fastify();

		apps.push(app);
		await expect(app.register(fastifySummaly, { plugins: [{ name: 'plain' } as unknown as SummalyPlugin] })).rejects.toThrow(TypeError);
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

describe('resolveRequestOptions', () => {
	const ceilings = {
		responseTimeout: DEFAULT_RESPONSE_TIMEOUT,
		operationTimeout: DEFAULT_OPERATION_TIMEOUT,
		contentLengthLimit: DEFAULT_MAX_RESPONSE_SIZE,
	};

	test('何もなければ followRedirects: false とライブラリ既定の上限になる', () => {
		expect(resolveRequestOptions({}, {})).toEqual({ followRedirects: false, ...ceilings });
	});

	test('登録時の値がなくても、上限を超える値と 0 は無視される', () => {
		expect(resolveRequestOptions({
			responseTimeout: '0',
			operationTimeout: '0',
			contentLengthLimit: String(Number.MAX_SAFE_INTEGER),
		}, {})).toEqual({ followRedirects: false, ...ceilings });
		expect(resolveRequestOptions({
			responseTimeout: String(DEFAULT_RESPONSE_TIMEOUT + 1),
			operationTimeout: String(DEFAULT_OPERATION_TIMEOUT + 1),
			contentLengthLimit: '0',
		}, {})).toEqual({ followRedirects: false, ...ceilings });
	});

	test('上限以下の正の値は適用される (上限ちょうども可)', () => {
		expect(resolveRequestOptions({ responseTimeout: '1000', operationTimeout: String(DEFAULT_OPERATION_TIMEOUT), contentLengthLimit: '1' }, {}))
			.toEqual({ followRedirects: false, responseTimeout: 1000, operationTimeout: DEFAULT_OPERATION_TIMEOUT, contentLengthLimit: 1 });
	});

	test('登録時の値があればそれが上限になる', () => {
		const env = { responseTimeout: 500, operationTimeout: 800, contentLengthLimit: 100 };

		expect(resolveRequestOptions({ responseTimeout: '501', operationTimeout: '0', contentLengthLimit: '1000' }, env))
			.toEqual({ followRedirects: false, ...env });
		expect(resolveRequestOptions({ responseTimeout: '499', operationTimeout: '1', contentLengthLimit: '100' }, env))
			.toEqual({ followRedirects: false, responseTimeout: 499, operationTimeout: 1, contentLengthLimit: 100 });
	});

	test('環境変数のタイムアウトが 0 (無制限) なら、クエリの正の値はどれも適用される', () => {
		const env = { responseTimeout: 0, operationTimeout: 0 };

		expect(resolveRequestOptions({ responseTimeout: '1000', operationTimeout: '2000' }, env))
			.toMatchObject({ responseTimeout: 1000, operationTimeout: 2000 });
		expect(resolveRequestOptions({ responseTimeout: '2147483647', operationTimeout: '2147483647' }, env))
			.toMatchObject({ responseTimeout: 2147483647, operationTimeout: 2147483647 });
		// Each timeout is resolved on its own.
		expect(resolveRequestOptions({ responseTimeout: '1000' }, env)).toMatchObject({ responseTimeout: 1000, operationTimeout: 0 });
		expect(resolveRequestOptions({ operationTimeout: '1000' }, env)).toMatchObject({ responseTimeout: 0, operationTimeout: 1000 });
	});

	test('環境変数のタイムアウトが 0 (無制限) のとき、クエリの 0 や不正な値では無制限のまま', () => {
		const env = { responseTimeout: 0, operationTimeout: 0 };

		expect(resolveRequestOptions({}, env)).toMatchObject(env);
		expect(resolveRequestOptions({ responseTimeout: '0', operationTimeout: '0' }, env)).toMatchObject(env);
		expect(resolveRequestOptions({ responseTimeout: '-1', operationTimeout: '2147483648' }, env)).toMatchObject(env);
	});

	test('contentLengthRequired はクエリで有効にできるだけ', () => {
		expect(resolveRequestOptions({ contentLengthRequired: 'false' }, { contentLengthRequired: true }).contentLengthRequired).toBe(true);
		expect(resolveRequestOptions({ contentLengthRequired: 'true' }, {}).contentLengthRequired).toBe(true);
		expect(resolveRequestOptions({ contentLengthRequired: 'true' }, { contentLengthRequired: false }).contentLengthRequired).toBe(true);
		expect(resolveRequestOptions({ contentLengthRequired: 'false' }, {}).contentLengthRequired).toBeUndefined();
		expect(resolveRequestOptions({}, { contentLengthRequired: false }).contentLengthRequired).toBe(false);
	});

	test('lang / userAgent / followRedirects は環境変数が優先、なければクエリ', () => {
		const query = { lang: 'ja-JP', userAgent: 'query-ua', followRedirects: 'true' };

		expect(resolveRequestOptions(query, {})).toMatchObject({ lang: 'ja-JP', userAgent: 'query-ua', followRedirects: true });
		expect(resolveRequestOptions(query, { lang: 'en-US', userAgent: 'env-ua', followRedirects: false }))
			.toMatchObject({ lang: 'en-US', userAgent: 'env-ua', followRedirects: false });
	});

	test('その他の環境変数由来のオプションはそのまま渡す', () => {
		const env = { allowedPrivateNetworks: ['10.0.0.0/8'], cacheTtl: 1000, proxy: { https: 'http://proxy.example:8080' } };

		expect(resolveRequestOptions({}, env)).toMatchObject(env);
	});
});
