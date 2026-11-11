import type { CacheEntry, InflightCoordinator, SerializedError, SummaryCache } from '@/coalesce/types.js';
import { StatusError } from '@/http/status-error.js';
import type { SummalyResult } from '@/types.js';

export type CoalesceDeps = {
	cache: SummaryCache | null;
	coordinator: InflightCoordinator | null;
	/** How long a success is kept (ms). 0 or less does not store it. */
	cacheTtl: number;
	/** How long a failure is kept (ms). 0 or less does not store it. */
	errorCacheTtl: number;
};

function serializeError(error: unknown): SerializedError {
	if (!(error instanceof Error)) {
		return { name: 'Error', message: String(error) };
	}
	const serialized: SerializedError = { name: error.name, message: error.message };
	const { statusCode, statusMessage } = error as Partial<StatusError>;
	if (typeof statusCode === 'number') serialized.statusCode = statusCode;
	if (typeof statusMessage === 'string') serialized.statusMessage = statusMessage;
	return serialized;
}

function restoreError(serialized: SerializedError): Error {
	const error = serialized.statusCode === undefined
		? new Error(serialized.message)
		: new StatusError(serialized.message, serialized.statusCode, serialized.statusMessage);
	error.name = serialized.name;
	return error;
}

/** Gives the caller its own copy: the host app rewrites results it receives (icon, thumbnail). */
function settle(entry: CacheEntry): SummalyResult {
	if (entry.kind === 'error') throw restoreError(entry.error);
	return structuredClone(entry.value);
}

/**
 * Runs `task` at most once per key at a time and caches the outcome, failures included.
 * Order: cache lookup → `task` through the coordinator → store in the cache → a separate copy for each caller.
 * Every caller, including the one whose call ran `task`, gets its result or error rebuilt from the same CacheEntry.
 */
export async function runCoalesced(
	deps: CoalesceDeps,
	key: string,
	task: () => Promise<SummalyResult>,
): Promise<SummalyResult> {
	const { cache, coordinator } = deps;

	const cached = await cache?.get(key);
	if (cached !== undefined) return settle(cached);

	const execute = async (): Promise<CacheEntry> => {
		// Check again: a task for this key may have finished between the lookup above and getting here.
		const latest = await cache?.get(key);
		if (latest !== undefined) return latest;

		let entry: CacheEntry;
		try {
			entry = { kind: 'ok', value: await task() };
		} catch (error) {
			entry = { kind: 'error', error: serializeError(error) };
		}
		const ttl = entry.kind === 'ok' ? deps.cacheTtl : deps.errorCacheTtl;
		if (cache !== null && ttl > 0) await cache.set(key, entry, ttl);
		return entry;
	};

	return settle(coordinator === null ? await execute() : await coordinator.run(key, execute));
}
