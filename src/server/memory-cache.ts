import type { CacheEntry, SummaryCache } from '@/cache/types.js';

/**
 * A summary of a page usually stores two entries (the summary and its favicon check), so this keeps about
 * 1000 summaries. Memory stays bounded by DEFAULT_MAX_BYTES.
 */
const DEFAULT_MAX_ENTRIES = 2000;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_BYTES = 256 * 1024;
export const DEFAULT_TTL = 5 * 60 * 1000;
export const DEFAULT_ERROR_TTL = 30 * 1000;

type StoredEntry = { entry: CacheEntry; expiresAt: number; bytes: number };

export type MemorySummaryCacheOptions = {
	/** Most entries kept at once, summaries and favicon checks together. Default 2000. */
	maxEntries?: number;
	/** Most estimated bytes kept at once, over all entries. Default 64 MiB. */
	maxBytes?: number;
	/** An entry estimated larger than this is not stored (the caller still gets its result). Default 256 KiB. */
	maxEntryBytes?: number;
	/** How long successes (summaries, favicon checks that succeeded) are kept, in ms. 0 does not keep them. Default 5 minutes. */
	ttl?: number;
	/** How long failures (summaries, favicon checks that failed) are kept, in ms. 0 does not keep them. Default 30 seconds. */
	errorTtl?: number;
};

function nonNegative(name: string, value: number): number {
	if (!(value >= 0)) {
		throw new RangeError(`${name} must be a non-negative number: ${value}`);
	}

	return value;
}

/** Whether `entry` is a success (see CacheEntry). */
function succeeded(entry: CacheEntry): boolean {
	return entry.kind === 'ok' || (entry.kind === 'icon' && entry.href !== null);
}

/**
 * Estimated memory an entry takes: 2 bytes per UTF-16 code unit of its key and JSON form.
 * Returns null when the entry has no JSON form (e.g. a BigInt or a cycle from a plugin), so its size is unknown.
 */
function estimateBytes(key: string, entry: CacheEntry): number | null {
	try {
		return (key.length + JSON.stringify(entry).length) * 2;
	} catch {
		return null;
	}
}

/**
 * In-process SummaryCache of the standalone server. Successes are kept for `ttl`, failures for `errorTtl`.
 * Expired entries are dropped when read. Entries estimated larger than `maxEntryBytes` are not stored;
 * past `maxEntries` or `maxBytes`, the oldest set entries go first.
 */
export class MemorySummaryCache implements SummaryCache {
	readonly #maxEntries: number;
	readonly #maxBytes: number;
	readonly #maxEntryBytes: number;
	readonly #ttl: number;
	readonly #errorTtl: number;
	/** Map iteration order is insertion order, so the first key is always the oldest. */
	readonly #entries = new Map<string, StoredEntry>();
	#bytes = 0;

	constructor(opts: MemorySummaryCacheOptions = {}) {
		this.#maxEntries = nonNegative('maxEntries', opts.maxEntries ?? DEFAULT_MAX_ENTRIES);
		this.#maxBytes = nonNegative('maxBytes', opts.maxBytes ?? DEFAULT_MAX_BYTES);
		this.#maxEntryBytes = nonNegative('maxEntryBytes', opts.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES);
		this.#ttl = nonNegative('ttl', opts.ttl ?? DEFAULT_TTL);
		this.#errorTtl = nonNegative('errorTtl', opts.errorTtl ?? DEFAULT_ERROR_TTL);
	}

	/** Number of entries held, expired ones not yet dropped included. */
	get size(): number {
		return this.#entries.size;
	}

	/** Estimated bytes of all entries held, expired ones not yet dropped included. Never above `maxBytes`. */
	get estimatedBytes(): number {
		return this.#bytes;
	}

	async get(key: string): Promise<CacheEntry | undefined> {
		const stored = this.#entries.get(key);

		if (stored === undefined) {
			return undefined;
		}
		if (performance.now() >= stored.expiresAt) {
			this.#delete(key);

			return undefined;
		}

		return stored.entry;
	}

	async set(key: string, entry: CacheEntry): Promise<void> {
		// Delete first so a re-set key moves to the newest position (and an entry too large to store
		// does not leave the previous one behind).
		this.#delete(key);
		const ttl = succeeded(entry) ? this.#ttl : this.#errorTtl;

		if (ttl === 0) {
			return;
		}
		const bytes = estimateBytes(key, entry);

		if (bytes === null || bytes > this.#maxEntryBytes || bytes > this.#maxBytes) {
			return;
		}

		this.#entries.set(key, { entry, expiresAt: performance.now() + ttl, bytes });
		this.#bytes += bytes;
		for (const oldest of this.#entries.keys()) {
			if (this.#entries.size <= this.#maxEntries && this.#bytes <= this.#maxBytes) {
				break;
			}
			this.#delete(oldest);
		}
	}

	#delete(key: string): void {
		const stored = this.#entries.get(key);

		if (stored === undefined) {
			return;
		}
		this.#entries.delete(key);
		this.#bytes -= stored.bytes;
	}
}
