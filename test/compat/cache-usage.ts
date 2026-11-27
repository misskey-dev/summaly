// How a host gives summaly a cache and in-flight sharing (@misskey-dev/summaly/cache), and closes its instance.
// Checked against built/cache.d.ts and built/index.d.ts by `pnpm typecheck:compat`.
import { InProcessCoordinator } from '../../built/cache.js';
import type { CacheEntry, SummaryCache } from '../../built/cache.js';
import { createSummaly } from '../../built/index.js';
import type { SummalyInstance, SummalyResult } from '../../built/index.js';

declare const redis: {
	get(key: string): Promise<string | null>;
	set(key: string, value: string, mode: 'PX', ttl: number): Promise<unknown>;
};

// A Redis-backed cache: it decides how long each kind of entry is kept.
class RedisSummaryCache implements SummaryCache {
	async get(key: string): Promise<CacheEntry | undefined> {
		const raw = await redis.get(`summaly:${key}`);

		return raw === null ? undefined : JSON.parse(raw) as CacheEntry;
	}

	async set(key: string, entry: CacheEntry): Promise<void> {
		const succeeded = entry.kind === 'ok' || (entry.kind === 'icon' && entry.href !== null);

		await redis.set(`summaly:${key}`, JSON.stringify(entry), 'PX', succeeded ? 10 * 60 * 1000 : 60 * 1000);
	}
}

export const summaly: SummalyInstance = createSummaly({
	cache: new RedisSummaryCache(),
	coordinator: new InProcessCoordinator(),
});

export async function summarizeOnce(url: string): Promise<SummalyResult> {
	await using instance = createSummaly();

	return instance(url, { cache: false });
}

export async function shutdown(): Promise<void> {
	await summaly.close();
}
