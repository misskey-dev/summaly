/**
 * Tests for the standalone server's in-process cache
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, test } from 'vitest';
import type { CacheEntry } from '@/cache.js';
import { MemorySummaryCache } from '@/server/memory-cache.js';

const errorEntry = (message: string): CacheEntry => ({ kind: 'error', error: { name: 'Error', message } });

/** Estimated bytes of one entry, as MemorySummaryCache accounts it. */
async function sizeOf(key: string, entry: CacheEntry): Promise<number> {
	const cache = new MemorySummaryCache();

	await cache.set(key, entry);

	return cache.estimatedBytes;
}

describe('MemorySummaryCache', () => {
	test('maxEntries を超えると古いものから捨てる', async () => {
		const cache = new MemorySummaryCache({ maxEntries: 2 });

		await cache.set('a', errorEntry('a'));
		await cache.set('b', errorEntry('b'));
		await cache.set('c', errorEntry('c'));

		expect(await cache.get('a')).toBeUndefined();
		expect(await cache.get('b')).toEqual(errorEntry('b'));
		expect(await cache.get('c')).toEqual(errorEntry('c'));

		// Setting an existing key again makes it the newest.
		await cache.set('b', errorEntry('b2'));
		await cache.set('d', errorEntry('d'));
		expect(await cache.get('c')).toBeUndefined();
		expect(await cache.get('b')).toEqual(errorEntry('b2'));
		expect(await cache.get('d')).toEqual(errorEntry('d'));
	});

	// A summary of a page usually stores two entries (the summary and its favicon check).
	test('既定で 2000 件まで持つ', async () => {
		const cache = new MemorySummaryCache();

		for (let i = 0; i <= 2000; i++) {
			await cache.set(`k${i}`, { kind: 'icon', href: null });
		}

		expect(cache.size).toBe(2000);
		expect(await cache.get('k0')).toBeUndefined();
		expect(await cache.get('k1')).toEqual({ kind: 'icon', href: null });
	});

	test('maxBytes を超えると古いものから捨てる', async () => {
		const one = await sizeOf('a', errorEntry('x'.repeat(100)));
		const cache = new MemorySummaryCache({ maxBytes: one * 2 });

		await cache.set('a', errorEntry('x'.repeat(100)));
		await cache.set('b', errorEntry('y'.repeat(100)));
		expect(cache.estimatedBytes).toBe(one * 2);
		await cache.set('c', errorEntry('z'.repeat(100)));

		expect(cache.estimatedBytes).toBe(one * 2);
		expect(await cache.get('a')).toBeUndefined();
		expect(await cache.get('b')).toEqual(errorEntry('y'.repeat(100)));
		expect(await cache.get('c')).toEqual(errorEntry('z'.repeat(100)));
	});

	test('maxEntryBytes を超えるものは保存しない', async () => {
		const cache = new MemorySummaryCache({ maxEntryBytes: 1000 });

		await cache.set('k', errorEntry('small'));
		// Re-setting the key with an entry too large to store also drops the old one.
		await cache.set('k', errorEntry('x'.repeat(1000)));

		expect(await cache.get('k')).toBeUndefined();
		expect(cache.size).toBe(0);
		expect(cache.estimatedBytes).toBe(0);
	});

	test('成功は ttl、失敗は errorTtl の間だけ返す', async () => {
		const cache = new MemorySummaryCache({ ttl: 200, errorTtl: 30 });
		const ok: CacheEntry = {
			kind: 'ok',
			value: {
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
			},
		};
		const iconFound: CacheEntry = { kind: 'icon', href: 'https://example.com/favicon.ico' };
		const iconMissing: CacheEntry = { kind: 'icon', href: null };

		await cache.set('ok', ok);
		await cache.set('icon-found', iconFound);
		await cache.set('error', errorEntry('x'));
		await cache.set('icon-missing', iconMissing);
		await sleep(60);

		expect(await cache.get('ok')).toEqual(ok);
		expect(await cache.get('icon-found')).toEqual(iconFound);
		expect(await cache.get('error')).toBeUndefined();
		expect(await cache.get('icon-missing')).toBeUndefined();

		await sleep(200);
		expect(await cache.get('ok')).toBeUndefined();
		expect(await cache.get('icon-found')).toBeUndefined();
	});

	test('ttl / errorTtl が 0 の種類は保存しない', async () => {
		const noErrors = new MemorySummaryCache({ errorTtl: 0 });
		const noSuccesses = new MemorySummaryCache({ ttl: 0 });

		await noErrors.set('error', errorEntry('x'));
		await noErrors.set('icon', { kind: 'icon', href: 'https://example.com/favicon.ico' });
		await noSuccesses.set('error', errorEntry('x'));
		await noSuccesses.set('icon', { kind: 'icon', href: 'https://example.com/favicon.ico' });

		expect(await noErrors.get('error')).toBeUndefined();
		expect(await noErrors.get('icon')).toBeDefined();
		expect(await noSuccesses.get('error')).toBeDefined();
		expect(await noSuccesses.get('icon')).toBeUndefined();
	});

	test('負の上限や TTL は RangeError', () => {
		expect(() => new MemorySummaryCache({ maxEntries: -1 })).toThrow(RangeError);
		expect(() => new MemorySummaryCache({ ttl: -1 })).toThrow(RangeError);
		expect(() => new MemorySummaryCache({ errorTtl: Number.NaN })).toThrow(RangeError);
	});
});
