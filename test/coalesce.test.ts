import http from 'node:http';
import https from 'node:https';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildIconKey, buildRequestKey, objectId } from '@/coalesce/key.js';
import { runCoalesced } from '@/coalesce/run.js';
import {
	type CacheEntry,
	createSummarizer,
	InProcessCoordinator,
	MemorySummaryCache,
	StatusError,
	defaultSummarizeOptions,
	type SummaryPlugin,
	type SummarizeOptions,
	type SummaryResult,
	type SummaryCache,
} from '@/index.js';
import { JsonCache } from './helpers/json-cache.js';
import { startTestServer, type TestServer } from './helpers/test-server.js';

const allowedPrivateNetworks = ['127.0.0.0/8', '::1/128'];

const servers: TestServer[] = [];
const cleanups: (() => void)[] = [];
const ALLOW_PRIVATE_IP_VARS = ['CHIRAMISS_ALLOW_PRIVATE_IP', 'SUMMALY_ALLOW_PRIVATE_IP'] as const;
const originalAllowPrivateIp = ALLOW_PRIVATE_IP_VARS.map(name => [name, process.env[name]] as const);

afterEach(async () => {
	for (const [name, value] of originalAllowPrivateIp) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
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

/** A MemorySummaryCache that counts reads and records the kind of every entry stored. */
function recordingCache(): SummaryCache & { gets: () => number; storedKinds: CacheEntry['kind'][] } {
	const inner = new MemorySummaryCache();
	let gets = 0;
	const storedKinds: CacheEntry['kind'][] = [];
	return {
		get: key => {
			gets++;
			return inner.get(key);
		},
		set: (key, entry, ttlMs) => {
			storedKinds.push(entry.kind);
			return inner.set(key, entry, ttlMs);
		},
		gets: () => gets,
		storedKinds,
	};
}

/** A plugin that answers for `hostname` with a fixed summary plus `extra` fields, and counts its calls. */
function fixedPlugin(hostname: string, extra: Record<string, unknown> = {}): SummaryPlugin & { calls: () => number } {
	let calls = 0;
	return {
		test: url => url.hostname === hostname,
		summarize: async () => {
			calls++;
			return {
				title: 't',
				icon: null,
				description: null,
				thumbnail: null,
				thumbnailStyle: null,
				sitename: null,
				player: { url: null, width: null, height: null, allow: [] },
				activityPub: null,
				fediverseCreator: null,
				...extra,
			};
		},
		calls: () => calls,
	};
}

/** Estimated bytes of one entry, as MemorySummaryCache accounts it. */
async function sizeOf(key: string, entry: CacheEntry): Promise<number> {
	const cache = new MemorySummaryCache();
	await cache.set(key, entry, 60_000);
	return cache.estimatedBytes;
}

describe('coalescing and caching', () => {
	test('同時に来た同じ要求は1回だけ取得する', async () => {
		const server = await countingServer({ delayMs: 100 });
		const summarize = createSummarizer({ allowedPrivateNetworks });

		const results = await Promise.all(Array.from({ length: 10 }, () => summarize(server.url)));

		expect(server.gets()).toBe(1);
		expect(results[0].title).toBe('Coalesced');
		for (const result of results) expect(result).toEqual(results[0]);
		// Each caller gets its own copy.
		expect(new Set(results).size).toBe(10);
	});

	test('lang が違えば別々に取得する', async () => {
		const server = await countingServer({ delayMs: 100 });
		const summarize = createSummarizer({ allowedPrivateNetworks });

		await Promise.all([
			summarize(server.url, { lang: 'ja-JP' }),
			summarize(server.url, { lang: 'en-US' }),
		]);

		expect(server.gets()).toBe(2);
	});

	test('agent が違えば別々に取得する', async () => {
		const server = await countingServer({ delayMs: 100 });
		const summarize = createSummarizer();
		const agentA = newAgent();
		const agentB = newAgent();

		await Promise.all([
			summarize(server.url, { agent: { http: agentA } }),
			summarize(server.url, { agent: { http: agentB } }),
			summarize(server.url, { agent: { http: agentA } }),
		]);

		expect(server.gets()).toBe(2);
	});

	test('cacheTtl 内の再要求は取得しない、期限後は取得する', async () => {
		const server = await countingServer();
		const summarize = createSummarizer({ allowedPrivateNetworks, cacheTtl: 50 });

		await summarize(server.url);
		await summarize(server.url);
		expect(server.gets()).toBe(1);

		await sleep(80);
		await summarize(server.url);
		expect(server.gets()).toBe(2);
	});

	test('失敗も errorCacheTtl の間はキャッシュされ、同じ statusCode の StatusError が投げられる', async () => {
		const server = await countingServer({ status: 404, delayMs: 50 });
		const summarize = createSummarizer({ allowedPrivateNetworks, errorCacheTtl: 200 });

		// Concurrent callers sharing one failed fetch all get an equivalent StatusError.
		const concurrent = await Promise.all([
			summarize(server.url).catch((e: unknown) => e),
			summarize(server.url).catch((e: unknown) => e),
		]);
		expect(server.gets()).toBe(1);
		const first = concurrent[0] as StatusError;
		expect(first).toBeInstanceOf(StatusError);
		expect(first.statusCode).toBe(404);
		expect(concurrent[1]).toBeInstanceOf(StatusError);
		expect(concurrent[1]).toMatchObject({ name: first.name, message: first.message, statusCode: 404 });

		const cached = await summarize(server.url).catch((e: unknown) => e);
		expect(server.gets()).toBe(1);
		expect(cached).toBeInstanceOf(StatusError);
		expect(cached).toMatchObject({ name: 'StatusError', message: first.message, statusCode: 404, isPermanentError: true });

		await sleep(250);
		await expect(summarize(server.url)).rejects.toBeInstanceOf(StatusError);
		expect(server.gets()).toBe(2);
	});

	test('返された結果を書き換えても、同時の呼び出し側と次のキャッシュヒットに影響しない', async () => {
		const server = await countingServer({ delayMs: 50 });
		const summarize = createSummarizer({ allowedPrivateNetworks });

		const [a, b] = await Promise.all([summarize(server.url), summarize(server.url)]);
		const original = structuredClone(b);
		expect(original.thumbnail).not.toBeNull();

		// The host app replaces icon and thumbnail on the result it receives.
		a.icon = 'https://proxy.example/icon';
		a.thumbnail = 'https://proxy.example/thumbnail';
		a.player.allow.push('autoplay');
		expect(b).toEqual(original);

		const hit = await summarize(server.url);
		expect(server.gets()).toBe(1);
		expect(hit).toEqual(original);

		hit.thumbnail = null;
		hit.player.allow.push('fullscreen');
		expect(await summarize(server.url)).toEqual(original);
		expect(server.gets()).toBe(1);
	});

	test('cache: false と coordinator: false で毎回取得する', async () => {
		const server = await countingServer({ delayMs: 50 });

		const disabled = createSummarizer({ allowedPrivateNetworks, cache: false, coordinator: false });
		await Promise.all([disabled(server.url), disabled(server.url), disabled(server.url)]);
		await disabled(server.url);
		expect(server.gets()).toBe(4);

		// The same options per call disable them on an instance that has them enabled.
		const enabled = createSummarizer({ allowedPrivateNetworks });
		const off = { cache: false, coordinator: false } as const;
		await Promise.all([enabled(server.url, off), enabled(server.url, off)]);
		await enabled(server.url, off);
		expect(server.gets()).toBe(7);
	});

	test('cache: false でも同時の要求は一本化され、coordinator: false でもキャッシュは効く', async () => {
		const server = await countingServer({ delayMs: 50 });

		const coordinatorOnly = createSummarizer({ allowedPrivateNetworks, cache: false });
		await Promise.all([coordinatorOnly(server.url), coordinatorOnly(server.url)]);
		expect(server.gets()).toBe(1);
		await coordinatorOnly(server.url);
		expect(server.gets()).toBe(2);

		const cacheOnly = createSummarizer({ allowedPrivateNetworks, coordinator: false });
		await cacheOnly(server.url);
		await cacheOnly(server.url);
		expect(server.gets()).toBe(3);
	});

	test('インスタンスごとにキャッシュを持つ', async () => {
		const server = await countingServer();

		await createSummarizer({ allowedPrivateNetworks })(server.url);
		await createSummarizer({ allowedPrivateNetworks })(server.url);

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

	test('MemorySummaryCache は maxBytes を超えると古いものから捨てる', async () => {
		const entry = (message: string): CacheEntry => ({ kind: 'error', error: { name: 'Error', message } });
		const one = await sizeOf('a', entry('x'.repeat(100)));
		const cache = new MemorySummaryCache({ maxBytes: one * 2 });

		await cache.set('a', entry('x'.repeat(100)), 60_000);
		await cache.set('b', entry('y'.repeat(100)), 60_000);
		expect(cache.estimatedBytes).toBe(one * 2);
		await cache.set('c', entry('z'.repeat(100)), 60_000);

		expect(cache.estimatedBytes).toBe(one * 2);
		expect(await cache.get('a')).toBeUndefined();
		expect(await cache.get('b')).toEqual(entry('y'.repeat(100)));
		expect(await cache.get('c')).toEqual(entry('z'.repeat(100)));
	});

	test('MemorySummaryCache は maxEntryBytes を超えるものを保存しない', async () => {
		const small: CacheEntry = { kind: 'error', error: { name: 'Error', message: 'small' } };
		const large: CacheEntry = { kind: 'error', error: { name: 'Error', message: 'x'.repeat(1000) } };
		const cache = new MemorySummaryCache({ maxEntryBytes: 1000 });

		await cache.set('k', small, 60_000);
		// Re-setting the key with an entry too large to store also drops the old one.
		await cache.set('k', large, 60_000);

		expect(await cache.get('k')).toBeUndefined();
		expect(cache.size).toBe(0);
		expect(cache.estimatedBytes).toBe(0);
	});

	test('maxEntryBytes を超える結果は保存されず、次の呼び出しで取り直す', async () => {
		const plugin = fixedPlugin('large.example', { sitename: 'x'.repeat(10_000) });
		const cache = new MemorySummaryCache({ maxEntryBytes: 10_000 });
		const summarize = createSummarizer({ plugins: [plugin], followRedirects: false, cache });

		const first = await summarize('https://large.example/');
		const second = await summarize('https://large.example/');

		expect(second).toEqual(first);
		expect(plugin.calls()).toBe(2);
		expect(cache.size).toBe(0);
	});

	/** Serves `page` as text/html at every path. */
	async function pageServer(page: Buffer): Promise<TestServer> {
		const server = await startTestServer((_req, res) => {
			res.writeHead(200, { 'content-type': 'text/html', 'content-length': page.byteLength });
			res.end(page);
		});
		servers.push(server);
		return server;
	}

	test('og:site_name が約 1 MB のページを 50 件取っても maxBytes を超えない', async () => {
		// A site name this long makes the title cleanup fail (as upstream does) with an error whose message
		// quotes the whole site name; the stored copy of that message is clipped.
		const server = await pageServer(Buffer.from(`<html><head><title>t</title><meta property="og:site_name" content="${'s'.repeat(1024 * 1024)}"></head></html>`));
		const maxBytes = 64 * 1024 * 1024;
		const cache = new MemorySummaryCache({ maxBytes });
		const summarize = createSummarizer({ allowedPrivateNetworks, cache });

		for (let i = 0; i < 50; i++) {
			await summarize(`${server.url}page/${i}`).catch(() => {});
			expect(cache.estimatedBytes).toBeLessThanOrEqual(maxBytes);
		}
		expect(cache.size).toBe(50);
		expect(cache.estimatedBytes).toBeLessThanOrEqual(50 * 4 * 1024);
	}, 60_000);

	test('大きな結果を保存し続けても maxBytes を超えず、古いものから捨てる', async () => {
		const server = await pageServer(Buffer.from(`<html><head><title>t</title><meta property="og:image" content="/${'i'.repeat(256 * 1024)}"></head></html>`));
		const maxBytes = 2 * 1024 * 1024;
		// maxEntryBytes is raised so these entries (about 512 KiB each) are stored and the byte budget is what limits them.
		const cache = new MemorySummaryCache({ maxBytes, maxEntryBytes: 1024 * 1024 });
		const summarize = createSummarizer({ allowedPrivateNetworks, cache });

		for (let i = 0; i < 20; i++) {
			const result = await summarize(`${server.url}page/${i}`);
			expect(result.thumbnail?.length).toBeGreaterThan(256 * 1024);
			expect(cache.estimatedBytes).toBeLessThanOrEqual(maxBytes);
		}
		expect(cache.size).toBeGreaterThan(0);
		expect(cache.size).toBeLessThan(20);
		// The newest stays; the oldest went first.
		const keyOf = (i: number) => buildRequestKey(`${server.url}page/${i}`, { ...defaultSummarizeOptions, allowedPrivateNetworks });
		expect(await cache.get(keyOf(19))).toBeDefined();
		expect(await cache.get(keyOf(0))).toBeUndefined();
	});

	test('既定の MemorySummaryCache は約 1 MB の結果を保存しない', async () => {
		const plugin = fixedPlugin('huge.example', { sitename: 's'.repeat(1024 * 1024) });
		const cache = new MemorySummaryCache();
		const summarize = createSummarizer({ plugins: [plugin], followRedirects: false, cache });

		await summarize('https://huge.example/');

		expect(cache.size).toBe(0);
		expect(cache.estimatedBytes).toBe(0);
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
		const summarize = createSummarizer({ allowedPrivateNetworks, cache });

		const fresh = await summarize(ok.url);
		const fromCache = await summarize(ok.url);
		expect(ok.gets()).toBe(1);
		expect(fromCache).toEqual(fresh);

		const freshError = await summarize(notFound.url).catch((e: unknown) => e) as StatusError;
		const cachedError = await summarize(notFound.url).catch((e: unknown) => e) as StatusError;
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

	test('複製できない結果は ok として保存せず、エラーとしてキャッシュする', async () => {
		// A function cannot go through structuredClone; storing it as 'ok' would make every cache hit throw.
		const plugin = fixedPlugin('uncloneable.example', { extra: () => 'not cloneable' });
		const cache = recordingCache();
		const summarize = createSummarizer({ plugins: [plugin], followRedirects: false, cache });
		const url = 'https://uncloneable.example/';

		const first = await summarize(url).catch((e: unknown) => e) as Error;
		const second = await summarize(url).catch((e: unknown) => e) as Error;

		expect(first).toBeInstanceOf(Error);
		expect(second).toBeInstanceOf(Error);
		expect(second).toMatchObject({ name: first.name, message: first.message });
		expect(plugin.calls()).toBe(1);
		expect(cache.storedKinds).toEqual(['error']);
	});

	test('coordinator: false ならキャッシュを1回だけ読む', async () => {
		const plugin = fixedPlugin('plugin.example');
		const cache = recordingCache();
		const summarize = createSummarizer({ plugins: [plugin], followRedirects: false, cache, coordinator: false });

		await summarize('https://plugin.example/');
		expect(plugin.calls()).toBe(1);
		expect(cache.gets()).toBe(1);
		expect(cache.storedKinds).toEqual(['ok']);
	});
});

describe('runCoalesced', () => {
	const result: SummaryResult = {
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

		const first = await runCoalesced(deps, () => 'k', task).catch((e: unknown) => e);
		const second = await runCoalesced(deps, () => 'k', task).catch((e: unknown) => e);

		expect(calls).toBe(1);
		for (const error of [first, second]) {
			expect(error).toBeInstanceOf(Error);
			expect(error).not.toBeInstanceOf(StatusError);
			expect(error).toMatchObject({ name: 'TypeError', message: 'boom' });
		}
	});

	test('保存するエラーのメッセージは 1024 文字に切り詰める', async () => {
		const cache = new JsonCache();
		const deps = { cache, coordinator: null, cacheTtl: 1000, errorCacheTtl: 1000 };

		const thrown = await runCoalesced(deps, () => 'k', async () => {
			throw new StatusError('x'.repeat(5000), 500, 'Internal Server Error');
		}).catch((e: unknown) => e) as StatusError;

		const stored = await cache.get('k');
		expect(stored).toMatchObject({ kind: 'error', error: { statusCode: 500, statusMessage: 'Internal Server Error' } });
		expect(stored?.kind === 'error' && stored.error.message).toBe('x'.repeat(1024));
		// The caller whose call ran the task gets the same clipped error as later callers.
		expect(thrown.message).toBe('x'.repeat(1024));
		expect(thrown.statusCode).toBe(500);
	});

	// The key (canonical serialization + SHA-256) is only read by the cache and the coordinator.
	test('キャッシュも coordinator もなければ key を作らない', async () => {
		const key = vi.fn(() => 'k');
		const deps = { cache: null, coordinator: null, cacheTtl: 1000, errorCacheTtl: 1000 };
		const value = await runCoalesced(deps, key, async () => result);
		expect(value).toEqual(result);
		expect(value).not.toBe(result);
		await expect(runCoalesced(deps, key, async () => {
			throw new StatusError('gone', 410, 'Gone');
		})).rejects.toMatchObject({ message: 'gone', statusCode: 410 });
		// A value structuredClone cannot copy still becomes an error.
		await expect(runCoalesced(deps, key, async () => ({ ...result, extra: () => {} }))).rejects.toThrow();
		expect(key).not.toHaveBeenCalled();
	});

	test('TTL が 0 なら保存しない', async () => {
		const cache = new JsonCache();
		await runCoalesced({ cache, coordinator: null, cacheTtl: 0, errorCacheTtl: 0 }, () => 'ok', async () => result);
		await runCoalesced({ cache, coordinator: null, cacheTtl: 0, errorCacheTtl: 0 }, () => 'ng', async () => {
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
		const plugin: SummaryPlugin = { test: () => false, summarize: async () => null };
		const variants: SummarizeOptions[] = [
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
		for (const name of ALLOW_PRIVATE_IP_VARS) delete process.env[name];
		const unset = buildRequestKey(url, {});
		process.env.SUMMALY_ALLOW_PRIVATE_IP = 'true';
		const enabled = buildRequestKey(url, {});

		expect(enabled).not.toBe(unset);
	});

	test('プライベート IP の許可はどちらの変数名で指定しても同じ key になり、CHIRAMISS_ALLOW_PRIVATE_IP が優先される', () => {
		for (const name of ALLOW_PRIVATE_IP_VARS) delete process.env[name];
		const unset = buildRequestKey(url, {});

		process.env.SUMMALY_ALLOW_PRIVATE_IP = 'true';
		const bySummaly = buildRequestKey(url, {});

		delete process.env.SUMMALY_ALLOW_PRIVATE_IP;
		process.env.CHIRAMISS_ALLOW_PRIVATE_IP = 'true';
		const byChiramiss = buildRequestKey(url, {});

		process.env.CHIRAMISS_ALLOW_PRIVATE_IP = 'false';
		process.env.SUMMALY_ALLOW_PRIVATE_IP = 'true';
		const overridden = buildRequestKey(url, {});

		expect(bySummaly).not.toBe(unset);
		expect(byChiramiss).toBe(bySummaly);
		expect(overridden).toBe(unset);
	});

	test('agent と plugin の同一性はプロセスごとの値を含み、別のプロセスとは key が重ならない', async () => {
		// Fresh copies of the module stand in for two processes: in each, object numbers start at 1,
		// so the first agent (or plugin) in each gets the same number.
		vi.resetModules();
		const first = await import('@/coalesce/key.js');
		vi.resetModules();
		const second = await import('@/coalesce/key.js');
		const agents = [new http.Agent(), new http.Agent()];
		cleanups.push(() => agents.forEach(a => a.destroy()));
		const plugin = (): SummaryPlugin => ({ test: () => false, summarize: async () => null });

		expect(first.objectId(agents[0])).toBe(second.objectId(agents[1]));
		expect(first.buildRequestKey(url, { agent: { http: agents[0] } })).not.toBe(second.buildRequestKey(url, { agent: { http: agents[1] } }));
		expect(first.buildRequestKey(url, { plugins: [plugin()] })).not.toBe(second.buildRequestKey(url, { plugins: [plugin()] }));
		// Keys without objects are the same in every process.
		expect(first.buildRequestKey(url, { lang: 'ja' })).toBe(second.buildRequestKey(url, { lang: 'ja' }));
	});

	test('objectId は同じオブジェクトに同じ番号、違うオブジェクトに違う番号を返す', () => {
		const a = {};
		const b = {};

		expect(objectId(a)).toBe(objectId(a));
		expect(objectId(a)).not.toBe(objectId(b));
	});
});

describe('buildIconKey', () => {
	const url = 'https://example.com/favicon.ico';

	test('SHA-256 の16進表記で、プロキシの認証情報をそのまま含まない', () => {
		const key = buildIconKey(url, { proxy: { https: 'http://user:secret@proxy.example:8080' } });

		expect(key).toMatch(/^[0-9a-f]{64}$/);
		expect(key).not.toContain('secret');
	});

	test('同じ URL と設定でも、要約のキーとは重ならない', () => {
		const variants: SummarizeOptions[] = [{}, { ...defaultSummarizeOptions }, { allowedPrivateNetworks }, { userAgent: 'ua' }];
		for (const opts of variants) {
			expect(buildIconKey(url, opts)).not.toBe(buildRequestKey(url, opts));
		}
	});

	test('HEAD の結果を変えうる設定が違えば key も違う', () => {
		const agent = new http.Agent();
		cleanups.push(() => agent.destroy());
		const variants: SummarizeOptions[] = [
			{},
			{ userAgent: 'ua' },
			{ responseTimeout: 1 },
			{ operationTimeout: 1 },
			{ contentLengthLimit: 1 },
			{ allowedPrivateNetworks: ['10.0.0.0/8'] },
			{ proxy: { https: 'http://proxy.example:8080' } },
			{ proxy: { https: 'http://proxy.example:8080', noProxy: 'example.com' } },
			{ agent: { http: agent } },
			{ agent: { http: new http.Agent() } },
		];
		const keys = variants.map(opts => buildIconKey(url, opts));

		expect(new Set(keys).size).toBe(variants.length);
		expect(buildIconKey('https://example.com/other.ico', {})).not.toBe(keys[0]);
		expect(buildIconKey(url, { agent: { http: agent } })).toBe(keys[8]);
	});

	test('プライベート IP 許可の環境変数が違えば key も違う', () => {
		for (const name of ALLOW_PRIVATE_IP_VARS) delete process.env[name];
		const unset = buildIconKey(url, {});
		process.env.SUMMALY_ALLOW_PRIVATE_IP = 'true';

		expect(buildIconKey(url, {})).not.toBe(unset);
	});

	test('HEAD に使わない設定（lang、plugins、followRedirects、contentLengthRequired）と cache / coordinator / TTL は含めない', () => {
		const plugin: SummaryPlugin = { test: () => false, summarize: async () => null };
		const base = buildIconKey(url, {});

		expect(buildIconKey(url, {
			lang: 'ja-JP',
			plugins: [plugin],
			followRedirects: false,
			contentLengthRequired: true,
			cache: false,
			coordinator: false,
			cacheTtl: 1,
			errorCacheTtl: 2,
		})).toBe(base);
	});
});
