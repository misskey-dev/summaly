import type { CacheEntry, SummaryCache } from '@/coalesce/types.js';

const DEFAULT_MAX_ENTRIES = 1000;

type StoredEntry = { entry: CacheEntry; expiresAt: number };

/**
 * In-process SummaryCache. Expired entries are dropped when read; past `maxEntries`, the oldest set entries go first.
 */
export class MemorySummaryCache implements SummaryCache {
	readonly #maxEntries: number;
	/** Map iteration order is insertion order, so the first key is always the oldest. */
	readonly #entries = new Map<string, StoredEntry>();

	constructor(opts: { maxEntries?: number } = {}) {
		const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
		if (!(maxEntries >= 0)) {
			throw new RangeError(`maxEntries must be a non-negative number: ${maxEntries}`);
		}
		this.#maxEntries = maxEntries;
	}

	async get(key: string): Promise<CacheEntry | undefined> {
		const stored = this.#entries.get(key);
		if (stored === undefined) return undefined;
		if (performance.now() >= stored.expiresAt) {
			this.#entries.delete(key);
			return undefined;
		}
		return stored.entry;
	}

	async set(key: string, entry: CacheEntry, ttlMs: number): Promise<void> {
		// Delete first so a re-set key moves to the newest position.
		this.#entries.delete(key);
		this.#entries.set(key, { entry, expiresAt: performance.now() + ttlMs });
		for (const oldest of this.#entries.keys()) {
			if (this.#entries.size <= this.#maxEntries) break;
			this.#entries.delete(oldest);
		}
	}
}
