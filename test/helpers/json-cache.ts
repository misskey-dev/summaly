import type { CacheEntry, SummaryCache } from '@/index.js';

/** A SummaryCache that keeps only JSON strings, like a Redis-backed implementation would. */
export class JsonCache implements SummaryCache {
	readonly stored = new Map<string, string>();
	async get(key: string): Promise<CacheEntry | undefined> {
		const raw = this.stored.get(key);
		return raw === undefined ? undefined : JSON.parse(raw) as CacheEntry;
	}
	async set(key: string, entry: CacheEntry, _ttlMs: number): Promise<void> {
		this.stored.set(key, JSON.stringify(entry));
	}
}
