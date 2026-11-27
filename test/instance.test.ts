/**
 * Tests for summaly instances: createSummaly's close(), and the default instance behind summaly()
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { startTestServer, type TestServer } from './helpers/test-server.js';

const allowedPrivateNetworks = ['127.0.0.0/8', '::1/128'];
const servers: TestServer[] = [];

afterEach(async () => {
	vi.doUnmock('@/http/agent-pool.js');
	vi.resetModules();
	await Promise.all(servers.splice(0).map(s => s.close()));
});

/** Serves a small page after `delayMs`. */
async function pageServer(delayMs = 0): Promise<string> {
	const page = Buffer.from('<html><head><title>Page</title></head></html>');
	const server = await startTestServer((_req, res) => {
		setTimeout(() => {
			res.writeHead(200, { 'content-type': 'text/html', 'content-length': page.byteLength });
			res.end(page);
		}, delayMs);
	});

	servers.push(server);

	return server.url;
}

/** Imports src/index.ts fresh, with GuardedAgentPool replaced by a spy that records each pool it builds. */
async function importWithPoolSpy() {
	const pools: { destroy: ReturnType<typeof vi.fn> }[] = [];

	vi.resetModules();
	vi.doMock('@/http/agent-pool.js', async importOriginal => {
		const original = await importOriginal<typeof import('@/http/agent-pool.js')>();

		class SpiedPool extends original.GuardedAgentPool {
			constructor() {
				super();
				const destroy = vi.fn(() => super.destroy());

				this.destroy = destroy;
				pools.push({ destroy });
			}
		}

		return { ...original, GuardedAgentPool: SpiedPool };
	});

	return { lib: await import('@/index.js'), pools };
}

describe('summaly()', () => {
	test('import しただけでは既定のインスタンスを作らず、最初の呼び出しで1回だけ作る', async () => {
		const { lib, pools } = await importWithPoolSpy();

		expect(pools).toHaveLength(0);

		const url = await pageServer();

		await lib.summaly(url, { allowedPrivateNetworks });
		await lib.summaly(url, { allowedPrivateNetworks });
		expect(pools).toHaveLength(1);
	});
});

describe('createSummaly().close()', () => {
	test('実行中の呼び出しが終わるのを待ってから接続を破棄し、以降の呼び出しを拒否する', async () => {
		const { lib, pools } = await importWithPoolSpy();
		const summaly = lib.createSummaly({ allowedPrivateNetworks });
		const url = await pageServer(100);

		const inFlight = summaly(url);
		const closed = summaly.close();

		await expect(summaly(url)).rejects.toThrow('closed');
		expect(pools[0].destroy).not.toHaveBeenCalled();

		expect((await inFlight).title).toBe('Page');
		await closed;
		expect(pools[0].destroy).toHaveBeenCalledTimes(1);

		// Closing again returns the same promise and destroys nothing more.
		expect(summaly.close()).toBe(closed);
		await summaly[Symbol.asyncDispose]();
		expect(pools[0].destroy).toHaveBeenCalledTimes(1);
	});

	test('失敗した呼び出しも待ち、close() 自体は reject しない', async () => {
		const { lib } = await importWithPoolSpy();
		const summaly = lib.createSummaly();

		// Not allowed to reach the loopback server, so the call fails.
		const failing = summaly(await pageServer(50)).catch((e: unknown) => e);

		await expect(summaly.close()).resolves.toBeUndefined();
		expect(await failing).toBeInstanceOf(Error);
	});

	test('await using で抜けると close() される', async () => {
		const { lib, pools } = await importWithPoolSpy();
		const url = await pageServer();

		{
			await using summaly = lib.createSummaly({ allowedPrivateNetworks });

			expect((await summaly(url)).title).toBe('Page');
		}
		expect(pools[0].destroy).toHaveBeenCalledTimes(1);
	});
});
