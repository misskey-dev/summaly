import http from 'node:http';
import https from 'node:https';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, describe, expect, test } from 'vitest';
import { buildRequestKey, objectId } from '@/coalesce/key.js';
import { runCoalesced } from '@/coalesce/run.js';
import {
	type CacheEntry,
	createSummaly,
	InProcessCoordinator,
	MemorySummaryCache,
	StatusError,
	type SummalyPlugin,
	type SummalyOptions,
	type SummalyResult,
	type SummaryCache,
} from '@/index.js';
import { startTestServer, type TestServer } from './helpers/test-server.js';

const allowedPrivateNetworks = ['127.0.0.0/8', '::1/128'];

const servers: TestServer[] = [];
const cleanups: (() => void)[] = [];
const originalAllowPrivateIp = process.env.SUMMALY_ALLOW_PRIVATE_IP;

afterEach(async () => {
	if (originalAllowPrivateIp === undefined) delete process.env.SUMMALY_ALLOW_PRIVATE_IP;
	else process.env.SUMMALY_ALLOW_PRIVATE_IP = originalAllowPrivateIp;
	for (const cleanup of cleanups.splice(0)) cleanup();
	await Promise.all(servers.splice(0).map(s => s.close()));
});

const PAGE = Buffer.from([
	'<html><head>',
	'<title>Coalesced</title>',
	'<meta property="og:image" content="/image.png">',
	'</head></html>',
].join(''));

/**
 * Serves PAGE at `/` (404 elsewhere) after `delayMs`, and counts the GET requests it receives.
 * `status` replaces the 200 page with an empty response of that status.
 */
async function countingServer(opts: { delayMs?: number; status?: number } = {}): Promise<{ url: string; gets: () => number }> {
	let gets = 0;
	const server = await startTestServer((req, res) => {
		if (req.method === 'GET') gets++;
		setTimeout(() => {
			if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/') {
				res.writeHead(404).end();
			} else if (opts.status) {
				res.writeHead(opts.status).end();
			} else {
				res.writeHead(200, { 'content-type': 'text/html', 'content-length': PAGE.byteLength });
				res.end(PAGE);
			}
		}, opts.delayMs ?? 0);
	});
	servers.push(server);
	return { url: server.url, gets: () => gets };
}

function newAgent(): http.Agent {
	const agent = new http.Agent();
	cleanups.push(() => agent.destroy());
	return agent;
}

/** A SummaryCache that keeps only JSON strings, like a Redis-backed implementation would. */
class JsonCache implements SummaryCache {
	readonly stored = new Map<string, string>();
	async get(key: string): Promise<CacheEntry | undefined> {
		const raw = this.stored.get(key);
		return raw === undefined ? undefined : JSON.parse(raw) as CacheEntry;
	}
	async set(key: string, entry: CacheEntry, _ttlMs: number): Promise<void> {
		this.stored.set(key, JSON.stringify(entry));
	}
}

describe('coalescing and caching', () => {
	test('同時に来た同じ要求は1回だけ取得する', async () => {
		const server = await countingServer({ delayMs: 100 });
		const summaly = createSummaly({ allowedPrivateNetworks });

		const results = await Promise.all(Array.from({ length: 10 }, () => summaly(server.url)));

		expect(server.gets()).toBe(1);
		expect(results[0].title).toBe('Coalesced');
		for (const result of results) expect(result).toEqual(results[0]);
		// Each caller gets its own copy.
		expect(new Set(results).size).toBe(10);
	});

	test('lang が違えば別々に取得する', async () => {
		const server = await countingServer({ delayMs: 100 });
		const summaly = createSummaly({ allowedPrivateNetworks });

		await Promise.all([
			summaly(server.url, { lang: 'ja-JP' }),
			summaly(server.url, { lang: 'en-US' }),
		]);

		expect(server.gets()).toBe(2);
	});

	test('agent が違えば別々に取得する', async () => {
		const server = await countingServer({ delayMs: 100 });
		const summaly = createSummaly();
		const agentA = newAgent();
		const agentB = newAgent();

		await Promise.all([
			summaly(server.url, { agent: { http: agentA } }),
			summaly(server.url, { agent: { http: agentB } }),
			summaly(server.url, { agent: { http: agentA } }),
		]);

		expect(server.gets()).toBe(2);
	});

	test('cacheTtl 内の再要求は取得しない、期限後は取得する', async () => {
		const server = await countingServer();
		const summaly = createSummaly({ allowedPrivateNetworks, cacheTtl: 50 });

		await summaly(server.url);
		await summaly(server.url);
		expect(server.gets()).toBe(1);

		await sleep(80);
		await summaly(server.url);
		expect(server.gets()).toBe(2);
	});

	test('失敗も errorCacheTtl の間はキャッシュされ、同じ statusCode の StatusError が投げられる', async () => {
		const server = await countingServer({ status: 404, delayMs: 50 });
		const summaly = createSummaly({ allowedPrivateNetworks, errorCacheTtl: 200 });

		// Concurrent callers sharing one failed fetch all get an equivalent StatusError.
		const concurrent = await Promise.all([
			summaly(server.url).catch((e: unknown) => e),
			summaly(server.url).catch((e: unknown) => e),
		]);
		expect(server.gets()).toBe(1);
		const first = concurrent[0] as StatusError;
		expect(first).toBeInstanceOf(StatusError);
		expect(first.statusCode).toBe(404);
		expect(concurrent[1]).toBeInstanceOf(StatusError);
		expect(concurrent[1]).toMatchObject({ name: first.name, message: first.message, statusCode: 404 });

		const cached = await summaly(server.url).catch((e: unknown) => e);
		expect(server.gets()).toBe(1);
		expect(cached).toBeInstanceOf(StatusError);
		expect(cached).toMatchObject({ name: 'StatusError', message: first.message, statusCode: 404, isPermanentError: true });

		await sleep(250);
		await expect(summaly(server.url)).rejects.toBeInstanceOf(StatusError);
		expect(server.gets()).toBe(2);
	});

	test('返された結果を書き換えても、同時の呼び出し側と次のキャッシュヒットに影響しない', async () => {
		const server = await countingServer({ delayMs: 50 });
		const summaly = createSummaly({ allowedPrivateNetworks });

		const [a, b] = await Promise.all([summaly(server.url), summaly(server.url)]);
		const original = structuredClone(b);
		expect(original.thumbnail).not.toBeNull();

		// The host app replaces icon and thumbnail on the result it receives.
		a.icon = 'https://proxy.example/icon';
		a.thumbnail = 'https://proxy.example/thumbnail';
		a.player.allow.push('autoplay');
		expect(b).toEqual(original);

		const hit = await summaly(server.url);
		expect(server.gets()).toBe(1);
		expect(hit).toEqual(original);

		hit.thumbnail = null;
		hit.player.allow.push('fullscreen');
		expect(await summaly(server.url)).toEqual(original);
		expect(server.gets()).toBe(1);
	});

	test('cache: false と coordinator: false で毎回取得する', async () => {
		const server = await countingServer({ delayMs: 50 });

		const disabled = createSummaly({ allowedPrivateNetworks, cache: false, coordinator: false });
		await Promise.all([disabled(server.url), disabled(server.url), disabled(server.url)]);
		await disabled(server.url);
		expect(server.gets()).toBe(4);

		// The same options per call disable them on an instance that has them enabled.
		const enabled = createSummaly({ allowedPrivateNetworks });
		const off = { cache: false, coordinator: false } as const;
		await Promise.all([enabled(server.url, off), enabled(server.url, off)]);
		await enabled(server.url, off);
		expect(server.gets()).toBe(7);
	});

	test('cache: false でも同時の要求は一本化され、coordinator: false でもキャッシュは効く', async () => {
		const server = await countingServer({ delayMs: 50 });

		const coordinatorOnly = createSummaly({ allowedPrivateNetworks, cache: false });
		await Promise.all([coordinatorOnly(server.url), coordinatorOnly(server.url)]);
		expect(server.gets()).toBe(1);
		await coordinatorOnly(server.url);
		expect(server.gets()).toBe(2);

		const cacheOnly = createSummaly({ allowedPrivateNetworks, coordinator: false });
		await cacheOnly(server.url);
		await cacheOnly(server.url);
		expect(server.gets()).toBe(3);
	});

	test('インスタンスごとにキャッシュを持つ', async () => {
		const server = await countingServer();

		await createSummaly({ allowedPrivateNetworks })(server.url);
		await createSummaly({ allowedPrivateNetworks })(server.url);

		expect(server.gets()).toBe(2);
	});

	test('MemorySummaryCache は maxEntries を超えると古いものから捨てる', async () => {
		const cache = new MemorySummaryCache({ maxEntries: 2 });
		const entry = (title: string): CacheEntry => ({ kind: 'error', error: { name: 'Error', message: title } });

		await cache.set('a', entry('a'), 60_000);
		await cache.set('b', entry('b'), 60_000);
		await cache.set('c', entry('c'), 60_000);

		expect(await cache.get('a')).toBeUndefined();
		expect(await cache.get('b')).toEqual(entry('b'));
		expect(await cache.get('c')).toEqual(entry('c'));

		// Setting an existing key again makes it the newest.
		await cache.set('b', entry('b2'), 60_000);
		await cache.set('d', entry('d'), 60_000);
		expect(await cache.get('c')).toBeUndefined();
		expect(await cache.get('b')).toEqual(entry('b2'));
		expect(await cache.get('d')).toEqual(entry('d'));
	});

	test('MemorySummaryCache は期限切れのものを返さない', async () => {
		const cache = new MemorySummaryCache();
		const entry: CacheEntry = { kind: 'error', error: { name: 'Error', message: 'x' } };

		await cache.set('k', entry, 30);
		expect(await cache.get('k')).toEqual(entry);
		await sleep(50);
		expect(await cache.get('k')).toBeUndefined();
	});

	test('CacheEntry は JSON.stringify → JSON.parse で往復しても同じ結果を返す', async () => {
		const ok = await countingServer();
		const notFound = await countingServer({ status: 404 });
		const cache = new JsonCache();
		const summaly = createSummaly({ allowedPrivateNetworks, cache });

		const fresh = await summaly(ok.url);
		const fromCache = await summaly(ok.url);
		expect(ok.gets()).toBe(1);
		expect(fromCache).toEqual(fresh);

		const freshError = await summaly(notFound.url).catch((e: unknown) => e) as StatusError;
		const cachedError = await summaly(notFound.url).catch((e: unknown) => e) as StatusError;
		expect(notFound.gets()).toBe(1);
		expect(cachedError).toBeInstanceOf(StatusError);
		expect(cachedError).toMatchObject({
			name: freshError.name,
			message: freshError.message,
			statusCode: freshError.statusCode,
			statusMessage: freshError.statusMessage,
			isPermanentError: freshError.isPermanentError,
		});

		expect(cache.stored.size).toBe(2);
	});
});

describe('runCoalesced', () => {
	const result: SummalyResult = {
		title: 't',
		icon: null,
		description: null,
		thumbnail: null,
		thumbnailStyle: null,
		sitename: null,
		player: { url: null, width: null, height: null, allow: [] },
		activityPub: null,
		fediverseCreator: null,
		url: 'https://example.com/',
	};

	test('ステータスのないエラーは name を保った Error として復元される', async () => {
		const deps = { cache: new MemorySummaryCache(), coordinator: null, cacheTtl: 1000, errorCacheTtl: 1000 };
		const failure = Object.assign(new Error('boom'), { name: 'TypeError' });
		let calls = 0;
		const task = async () => {
			calls++;
			throw failure;
		};

		const first = await runCoalesced(deps, 'k', task).catch((e: unknown) => e);
		const second = await runCoalesced(deps, 'k', task).catch((e: unknown) => e);

		expect(calls).toBe(1);
		for (const error of [first, second]) {
			expect(error).toBeInstanceOf(Error);
			expect(error).not.toBeInstanceOf(StatusError);
			expect(error).toMatchObject({ name: 'TypeError', message: 'boom' });
		}
	});

	test('TTL が 0 なら保存しない', async () => {
		const cache = new JsonCache();
		await runCoalesced({ cache, coordinator: null, cacheTtl: 0, errorCacheTtl: 0 }, 'ok', async () => result);
		await runCoalesced({ cache, coordinator: null, cacheTtl: 0, errorCacheTtl: 0 }, 'ng', async () => {
			throw new Error('x');
		}).catch(() => {});

		expect(cache.stored.size).toBe(0);
	});

	test('InProcessCoordinator は完了したら key を手放す', async () => {
		const coordinator = new InProcessCoordinator();
		let calls = 0;
		const task = async () => ++calls;

		expect(await Promise.all([coordinator.run('k', task), coordinator.run('k', task)])).toEqual([1, 1]);
		expect(await coordinator.run('k', task)).toBe(2);
		await expect(coordinator.run('k', async () => {
			throw new Error('fail');
		})).rejects.toThrow('fail');
		expect(await coordinator.run('k', task)).toBe(3);
	});
});

describe('buildRequestKey', () => {
	const url = 'https://example.com/';

	test('SHA-256 の16進表記で、プロキシの認証情報をそのまま含まない', () => {
		const key = buildRequestKey(url, { proxy: { https: 'http://user:secret@proxy.example:8080' } });

		expect(key).toMatch(/^[0-9a-f]{64}$/);
		expect(key).not.toContain('secret');
	});

	test('結果を変えうるオプションが違えば key も違う', () => {
		const agent = new http.Agent();
		const plugin: SummalyPlugin = { test: () => false, summarize: async () => null };
		const variants: SummalyOptions[] = [
			{},
			{ lang: 'ja' },
			{ lang: null },
			{ userAgent: 'ua' },
			{ followRedirects: false },
			{ responseTimeout: 1 },
			{ operationTimeout: 1 },
			{ contentLengthLimit: 1 },
			{ contentLengthLimit: Number.POSITIVE_INFINITY },
			{ contentLengthLimit: Number.NaN },
			{ contentLengthRequired: true },
			{ allowedPrivateNetworks: ['10.0.0.0/8'] },
			{ proxy: { https: 'http://proxy.example:8080' } },
			{ proxy: { http: 'http://proxy.example:8080' } },
			{ proxy: { https: 'http://proxy.example:8080', noProxy: 'example.com' } },
			{ agent: { http: agent } },
			// The same agent object in the other slot is a different key.
			{ agent: { https: agent as unknown as https.Agent } },
			{ agent: { http: new http.Agent() } },
			{ plugins: [plugin] },
			{ plugins: [{ ...plugin }] },
		];
		const keys = variants.map(opts => buildRequestKey(url, opts));

		expect(new Set(keys).size).toBe(variants.length);
		expect(buildRequestKey('https://example.com/other', {})).not.toBe(keys[0]);
		expect(buildRequestKey(url, { agent: { http: agent } })).toBe(keys[15]);
		expect(buildRequestKey(url, { plugins: [plugin] })).toBe(keys[18]);
	});

	test('cache / coordinator / TTL は key に含めない', () => {
		const base = buildRequestKey(url, {});

		expect(buildRequestKey(url, { cache: false, coordinator: false, cacheTtl: 1, errorCacheTtl: 2 })).toBe(base);
		expect(buildRequestKey(url, { cache: new MemorySummaryCache(), coordinator: new InProcessCoordinator() })).toBe(base);
	});

	test('SUMMALY_ALLOW_PRIVATE_IP が違えば key も違う', () => {
		delete process.env.SUMMALY_ALLOW_PRIVATE_IP;
		const unset = buildRequestKey(url, {});
		process.env.SUMMALY_ALLOW_PRIVATE_IP = 'true';
		const enabled = buildRequestKey(url, {});

		expect(enabled).not.toBe(unset);
	});

	test('objectId は同じオブジェクトに同じ番号、違うオブジェクトに違う番号を返す', () => {
		const a = {};
		const b = {};

		expect(objectId(a)).toBe(objectId(a));
		expect(objectId(a)).not.toBe(objectId(b));
	});
});
