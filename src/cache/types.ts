import type { SummalyResult } from '@/types.js';

/**
 * An error in a form that survives JSON, so that failures can be cached too.
 */
export type SerializedError = {
	name: string;
	message: string;
	statusCode?: number;
	statusMessage?: string;
};

/**
 * One cache entry. Only shapes that come back the same through JSON.
 *
 * - `ok`: a summary that succeeded
 * - `error`: a summary that failed
 * - `icon`: a favicon check: the icon URL when its HEAD succeeded, null when it failed
 *
 * Summaries and favicon checks share the cache under separate keys. An entry of the wrong kind for its key
 * (or anything else that is not an entry) counts as a miss.
 *
 * Success is `ok`, or `icon` with an `href`; failure is `error`, or `icon` with a null `href`.
 * A cache can use this to keep failures for a shorter time than successes.
 */
export type CacheEntry =
	| { kind: 'ok'; value: SummalyResult }
	| { kind: 'error'; error: SerializedError }
	| { kind: 'icon'; href: string | null };

/**
 * Where summaly keeps summaries and favicon checks. Whether and how long an entry is kept, and how much is kept
 * at all, is up to the cache.
 *
 * Keys are SHA-256 hex digests of the URL and every option that can change the result.
 * A failing `set` does not fail the summary (the result is just not kept); a failing `get` does.
 */
export interface SummaryCache {
	get(key: string): Promise<CacheEntry | undefined>;
	set(key: string, entry: CacheEntry): Promise<void>;
}

/**
 * Shares in-flight work: while a task for a key runs, `run` with the same key waits for it instead of starting
 * another.
 *
 * `run` is called again from inside a running task: a summary's task checks its favicon through `run` with another
 * key and waits for it. An implementation must therefore only make calls with the same key wait for each other;
 * one that makes calls with different keys wait (one task at a time, at most N tasks at once) blocks forever,
 * because the summary holds its slot while its favicon check waits for one. Limit concurrency around the summary
 * calls instead.
 */
export interface InflightCoordinator {
	run<T>(key: string, task: () => Promise<T>): Promise<T>;
}
