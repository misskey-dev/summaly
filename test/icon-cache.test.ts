import http from 'node:http';
import https from 'node:https';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildIconKey, buildRequestKey } from '@/cache/key.js';
import { type InflightCoordinator, InProcessCoordinator, type SummaryCache } from '@/cache/index.js';
import { createSummaly, type SummalyOptions, type SummalyResult } from '@/index.js';
import { MemorySummaryCache } from '@/server/memory-cache.js';
import { JsonCache } from './helpers/json-cache.js';
import { startTestServer, type TestServer } from './helpers/test-server.js';

const allowedPrivateNetworks = ['127.0.0.0/8', '::1/128'];

const servers: TestServer[] = [];
const cleanups: (() => void)[] = [];
const ALLOW_PRIVATE_IP_VARS = ['SUMMALY_ALLOW_PRIVATE_IP'] as const;
const originalAllowPrivateIp = ALLOW_PRIVATE_IP_VARS.map(name => [name, process.env[name]] as const);

beforeEach(() => {
	// These tests decide for themselves whether the environment allows private IPs.
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

type Site = {
	/** Base URL such as `http://127.0.0.1:12345/`; every path other than `/favicon.png` is a page. */
	url: string;
	/** Absolute URL of the site's favicon */
	favicon: string;
	/** HEAD requests the favicon received */
	faviconHeads: () => number;
};

/**
 * Serves, at every path, a page whose `<link rel=icon>` points to `faviconHref` (default `/favicon.png`),
 * and answers `/favicon.png` with `faviconStatus` (default 200) after `faviconDelayMs`.
 */
async function site(opts: {
	faviconStatus?: number;
	faviconDelayMs?: number;
	faviconHref?: string;
	host?: string;
	/** Called when a page GET arrives, before it is answered. */
	onPageGet?: () => void;
} = {}): Promise<Site> {
	let faviconHeads = 0;
	const server = await startTestServer((req, res) => {
		if (new URL(req.url ?? '/', 'http://localhost').pathname === '/favicon.png') {
			if (req.method === 'HEAD') {
				faviconHeads++;
			}
			setTimeout(() => res.writeHead(opts.faviconStatus ?? 200, { 'content-type': 'image/png' }).end(), opts.faviconDelayMs ?? 0);

			return;
		}
		if (req.method === 'GET') {
			opts.onPageGet?.();
		}
		const page = Buffer.from(`<html><head><title>Page</title><link rel="icon" href="${opts.faviconHref ?? '/favicon.png'}"></head></html>`);

		res.writeHead(200, { 'content-type': 'text/html', 'content-length': page.byteLength });
		res.end(page);
	}, opts.host);

	servers.push(server);

	return { url: server.url, favicon: `${server.url}favicon.png`, faviconHeads: () => faviconHeads };
}

/**
 * A cache and a coordinator, which a summaly instance uses only when given them.
 * Spread first, so that a test's own `cache` / `coordinator` replaces them.
 */
function coalescing(): Pick<SummalyOptions, 'cache' | 'coordinator'> {
	return { cache: new MemorySummaryCache(), coordinator: new InProcessCoordinator() };
}

function newAgent(): http.Agent {
	const agent = new http.Agent();

	cleanups.push(() => agent.destroy());

	return agent;
}

const result: SummalyResult = {
	title: 'cached',
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

describe('favicon の確認結果のキャッシュ', () => {
	test('同じサイトの別ページを順に要約すると、favicon への HEAD は1回で、icon も同じ', async () => {
		const s = await site();
		const summaly = createSummaly({ ...coalescing(), allowedPrivateNetworks });

		const first = await summaly(`${s.url}a`);
		const second = await summaly(`${s.url}b`);

		expect(first.icon).toBe(s.favicon);
		expect(second.icon).toBe(s.favicon);
		expect(s.faviconHeads()).toBe(1);
	});

	test('成功した確認はキャッシュの ttl の間だけ使い、過ぎたら確認し直す', async () => {
		const s = await site();
		const summaly = createSummaly({ ...coalescing(), allowedPrivateNetworks, cache: new MemorySummaryCache({ ttl: 100 }) });

		await summaly(`${s.url}a`);
		await summaly(`${s.url}b`);
		expect(s.faviconHeads()).toBe(1);

		await sleep(150);
		expect((await summaly(`${s.url}c`)).icon).toBe(s.favicon);
		expect(s.faviconHeads()).toBe(2);
	});

	test('HEAD が 404 の icon は null で、キャッシュの errorTtl の間は確認し直さず、過ぎたら確認し直す', async () => {
		const s = await site({ faviconStatus: 404 });
		const summaly = createSummaly({ ...coalescing(), allowedPrivateNetworks, cache: new MemorySummaryCache({ errorTtl: 100 }) });

		expect((await summaly(`${s.url}a`)).icon).toBeNull();
		expect((await summaly(`${s.url}b`)).icon).toBeNull();
		expect(s.faviconHeads()).toBe(1);

		await sleep(150);
		expect((await summaly(`${s.url}c`)).icon).toBeNull();
		expect(s.faviconHeads()).toBe(2);
	});

	test('cache: false なら毎回確認する', async () => {
		const s = await site();
		const summaly = createSummaly({ ...coalescing(), allowedPrivateNetworks, cache: false });

		await summaly(`${s.url}a`);
		await summaly(`${s.url}b`);

		expect(s.faviconHeads()).toBe(2);
	});

	test('キャッシュの ttl が 0 なら成功した確認を保存しない', async () => {
		const s = await site();
		const summaly = createSummaly({ ...coalescing(), allowedPrivateNetworks, cache: new MemorySummaryCache({ ttl: 0 }) });

		expect((await summaly(`${s.url}a`)).icon).toBe(s.favicon);
		expect((await summaly(`${s.url}b`)).icon).toBe(s.favicon);

		expect(s.faviconHeads()).toBe(2);
	});

	test('キャッシュの errorTtl が 0 なら失敗した確認を保存しない', async () => {
		const s = await site({ faviconStatus: 404 });
		const summaly = createSummaly({ ...coalescing(), allowedPrivateNetworks, cache: new MemorySummaryCache({ errorTtl: 0 }) });

		await summaly(`${s.url}a`);
		await summaly(`${s.url}b`);

		expect(s.faviconHeads()).toBe(2);
	});

	test('同時の要約（別ページ、同じ favicon）は coordinator があれば HEAD を1本にする', async () => {
		const s = await site({ faviconDelayMs: 200 });
		const summaly = createSummaly({ ...coalescing(), allowedPrivateNetworks });

		const results = await Promise.all([summaly(`${s.url}a`), summaly(`${s.url}b`)]);

		expect(s.faviconHeads()).toBe(1);
		expect(results.map(r => r.icon)).toEqual([s.favicon, s.favicon]);
	});

	test('同時の要約（別ページ、同じ favicon）は coordinator: false なら HEAD を2本送る', async () => {
		const s = await site({ faviconDelayMs: 200 });
		const summaly = createSummaly({ ...coalescing(), allowedPrivateNetworks, coordinator: false });

		const results = await Promise.all([summaly(`${s.url}a`), summaly(`${s.url}b`)]);

		expect(s.faviconHeads()).toBe(2);
		expect(results.map(r => r.icon)).toEqual([s.favicon, s.favicon]);
	});

	test('JSON だけを保持するキャッシュでも働く', async () => {
		const s = await site();
		const cache = new JsonCache();
		const summaly = createSummaly({ ...coalescing(), allowedPrivateNetworks, cache });

		await summaly(`${s.url}a`);
		expect((await summaly(`${s.url}b`)).icon).toBe(s.favicon);

		expect(s.faviconHeads()).toBe(1);
		const iconKey = buildIconKey(s.favicon, { lang: null, followRedirects: true, allowedPrivateNetworks });

		expect(JSON.parse(cache.stored.get(iconKey) ?? 'null')).toEqual({ kind: 'icon', href: s.favicon });
	});

	test('userAgent が違えば共有しない', async () => {
		const s = await site();
		const summaly = createSummaly({ ...coalescing(), allowedPrivateNetworks });

		await summaly(`${s.url}a`, { userAgent: 'BotA/1.0' });
		await summaly(`${s.url}b`, { userAgent: 'BotB/1.0' });

		expect(s.faviconHeads()).toBe(2);
	});

	test('agent が違えば共有しない', async () => {
		const s = await site();
		const summaly = createSummaly(coalescing());

		await summaly(`${s.url}a`, { agent: { http: newAgent() } });
		await summaly(`${s.url}b`, { agent: { http: newAgent() } });

		expect(s.faviconHeads()).toBe(2);
	});

	test('allowedPrivateNetworks が違えば共有せず、許可した設定で得た icon を許可していない呼び出しに返さない', async () => {
		const icons = await site({ host: '127.0.0.2' });
		const pages = await site({ faviconHref: icons.favicon });
		const summaly = createSummaly(coalescing());

		const allowed = await summaly(`${pages.url}a`, { allowedPrivateNetworks: ['127.0.0.1/32', '127.0.0.2/32'] });
		const denied = await summaly(`${pages.url}b`, { allowedPrivateNetworks: ['127.0.0.1/32'] });

		expect(allowed.icon).toBe(icons.favicon);
		expect(denied.icon).toBeNull();
		// The denied call's HEAD is refused before it reaches the icon server.
		expect(icons.faviconHeads()).toBe(1);
	});

	test('プライベート IP 許可の環境変数が違えば共有せず、許可した設定で得た icon を許可していない呼び出しに返さない', async () => {
		const icons = await site({ host: '127.0.0.2' });
		const pages = await site({ faviconHref: icons.favicon });
		const summaly = createSummaly({ ...coalescing(), allowedPrivateNetworks: ['127.0.0.1/32'] });

		process.env.SUMMALY_ALLOW_PRIVATE_IP = 'true';
		const allowed = await summaly(`${pages.url}a`);

		delete process.env.SUMMALY_ALLOW_PRIVATE_IP;
		const denied = await summaly(`${pages.url}b`);

		expect(allowed.icon).toBe(icons.favicon);
		expect(denied.icon).toBeNull();
		expect(icons.faviconHeads()).toBe(1);
	});

	test('要約の途中でプライベート IP 許可の環境変数が変わっても、許可した設定で得た icon を許可していない呼び出しに返さない', async () => {
		const icons = await site({ host: '127.0.0.2' });
		// The variable is removed while the first call is fetching its page, after its transport was built.
		const pages = await site({ faviconHref: icons.favicon, onPageGet: () => delete process.env.SUMMALY_ALLOW_PRIVATE_IP });
		const summaly = createSummaly({ ...coalescing(), allowedPrivateNetworks: ['127.0.0.1/32'] });

		process.env.SUMMALY_ALLOW_PRIVATE_IP = 'true';
		const allowed = await summaly(`${pages.url}a`);
		const denied = await summaly(`${pages.url}b`);

		expect(allowed.icon).toBe(icons.favicon);
		expect(denied.icon).toBeNull();
	});

	test('要約の途中で allowedPrivateNetworks の配列が書き換えられても、許可した設定で得た icon を許可していない呼び出しに返さない', async () => {
		const icons = await site({ host: '127.0.0.2' });
		const networks = ['127.0.0.1/32', '127.0.0.2/32'];
		// The caller's array loses 127.0.0.2 while the first call is fetching its page, after its transport was built.
		const pages = await site({
			faviconHref: icons.favicon,
			onPageGet: () => {
				if (networks.length === 2) {
					networks.pop();
				}
			},
		});
		const summaly = createSummaly({ ...coalescing(), allowedPrivateNetworks: networks });

		const allowed = await summaly(`${pages.url}a`);
		const denied = await summaly(`${pages.url}b`);

		expect(allowed.icon).toBe(icons.favicon);
		expect(denied.icon).toBeNull();
	});

	test('要約の途中で agent のオブジェクトが書き換えられても、guard なしで得た icon を guard ありの呼び出しに返さない', async () => {
		const icons = await site({ host: '127.0.0.2' });
		const httpAgent = new http.Agent();
		const httpsAgent = new https.Agent();

		cleanups.push(() => httpAgent.destroy(), () => httpsAgent.destroy());
		// Both agents supplied: the caller takes over private IP blocking, so the first call reaches 127.0.0.2.
		const agent: { http?: http.Agent; https?: https.Agent } = { http: httpAgent, https: httpsAgent };
		// The caller drops its http agent while the first call is fetching its page, after its transport was built.
		const pages = await site({ faviconHref: icons.favicon, onPageGet: () => delete agent.http });
		const summaly = createSummaly({ ...coalescing(), allowedPrivateNetworks: ['127.0.0.1/32'] });

		const allowed = await summaly(`${pages.url}a`, { agent });
		const denied = await summaly(`${pages.url}b`, { agent: { https: httpsAgent } });

		expect(allowed.icon).toBe(icons.favicon);
		expect(denied.icon).toBeNull();
	});

	// The documented contract of InflightCoordinator: run is called again, with another key, from inside a task.
	test('coordinator.run は要約の task の中から icon のキーで呼ばれる（入れ子になる）', async () => {
		const s = await site();
		const inner = new InProcessCoordinator();
		const running: string[] = [];
		const nested: [string, string][] = [];
		const coordinator: InflightCoordinator = {
			run: async (key, task) => {
				for (const outer of running) {
					nested.push([outer, key]);
				}
				running.push(key);
				try {
					return await inner.run(key, task);
				} finally {
					running.splice(running.indexOf(key), 1);
				}
			},
		};
		const opts = { lang: null, followRedirects: true, allowedPrivateNetworks };
		const summaly = createSummaly({ ...coalescing(), allowedPrivateNetworks, coordinator });

		await summaly(`${s.url}a`);

		expect(nested).toEqual([[buildRequestKey(`${s.url}a`, opts), buildIconKey(s.favicon, opts)]]);
	});

	test('要約のキーに icon のエントリ、icon のキーに要約のエントリがあっても、取り直して正しい結果を返す', async () => {
		const s = await site();
		const cache = new MemorySummaryCache();
		const opts = { lang: null, followRedirects: true, allowedPrivateNetworks };
		const pageUrl = `${s.url}a`;
		const summaryKey = buildRequestKey(pageUrl, opts);
		const iconKey = buildIconKey(s.favicon, opts);

		await cache.set(summaryKey, { kind: 'icon', href: 'https://wrong.example/icon.png' });
		await cache.set(iconKey, { kind: 'ok', value: { ...result, icon: 'https://wrong.example/icon.png' } });
		const summaly = createSummaly({ ...coalescing(), allowedPrivateNetworks, cache });

		const summary = await summaly(pageUrl);

		expect(summary.title).toBe('Page');
		expect(summary.icon).toBe(s.favicon);
		expect(s.faviconHeads()).toBe(1);
		// The broken entries are replaced by ones of the right kind.
		expect((await cache.get(summaryKey))?.kind).toBe('ok');
		expect(await cache.get(iconKey)).toEqual({ kind: 'icon', href: s.favicon });
	});

	test('icon のキーでキャッシュが失敗しても要約は失敗せず、キャッシュなしで確認した icon を返す', async () => {
		const s = await site();
		const inner = new MemorySummaryCache();
		const iconKey = buildIconKey(s.favicon, { lang: null, followRedirects: true, allowedPrivateNetworks });
		const cache: SummaryCache = {
			get: async key => {
				if (key === iconKey) {
					throw new Error('cache is down');
				}

				return inner.get(key);
			},
			set: (key, entry) => inner.set(key, entry),
		};
		const summaly = createSummaly({ ...coalescing(), allowedPrivateNetworks, cache });

		const summary = await summaly(`${s.url}a`);

		expect(summary.title).toBe('Page');
		expect(summary.icon).toBe(s.favicon);
		expect(s.faviconHeads()).toBe(1);
	});

	test('icon のエントリの保存に失敗しても、その favicon に HEAD を送り直さない', async () => {
		const s = await site();
		const summaly = createSummaly({ ...coalescing(), allowedPrivateNetworks, cache: failingIconSet(new MemorySummaryCache()) });

		const summary = await summaly(`${s.url}a`);

		expect(summary.icon).toBe(s.favicon);
		expect(s.faviconHeads()).toBe(1);
	});

	test('icon のエントリの保存に失敗しても、同時に待っていた要約は HEAD を送らずに結果を受け取る', async () => {
		const s = await site({ faviconDelayMs: 200 });
		const summaly = createSummaly({ ...coalescing(), allowedPrivateNetworks, cache: failingIconSet(new MemorySummaryCache()) });

		const results = await Promise.all([summaly(`${s.url}a`), summaly(`${s.url}b`), summaly(`${s.url}c`)]);

		expect(results.map(r => r.icon)).toEqual([s.favicon, s.favicon, s.favicon]);
		expect(s.faviconHeads()).toBe(1);
	});

	test('coordinator が確認を済ませた後で失敗しても、その favicon に HEAD を送り直さない', async () => {
		const s = await site();
		const coordinator: InflightCoordinator = {
			// Runs every task, but fails to hand back the favicon check's outcome.
			run: async (_key, task) => {
				const value = await task();

				if ((value as { kind?: unknown }).kind === 'icon') {
					throw new Error('coordinator is down');
				}

				return value;
			},
		};
		const summaly = createSummaly({ ...coalescing(), allowedPrivateNetworks, coordinator });

		const summary = await summaly(`${s.url}a`);

		expect(summary.icon).toBe(s.favicon);
		expect(s.faviconHeads()).toBe(1);
	});
});

/** `inner`, except that storing an icon entry fails. */
function failingIconSet(inner: SummaryCache): SummaryCache {
	return {
		get: key => inner.get(key),
		set: async (key, entry) => {
			if (entry.kind === 'icon') {
				throw new Error('cache is down');
			}
			await inner.set(key, entry);
		},
	};
}
