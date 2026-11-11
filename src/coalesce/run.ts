import type { CacheEntry, InflightCoordinator, SerializedError, SummaryCache } from '@/coalesce/types.js';
import { StatusError } from '@/http/status-error.js';
import type { SummaryResult } from '@/types.js';

export type CoalesceDeps = {
	cache: SummaryCache | null;
	coordinator: InflightCoordinator | null;
	/** How long a success is kept (ms). 0 or less does not store it. */
	cacheTtl: number;
	/** How long a failure is kept (ms). 0 or less does not store it. */
	errorCacheTtl: number;
};

/** Longest error message kept (characters). A message can quote remote content, and every cached entry stays in memory. */
const MAX_ERROR_MESSAGE_LENGTH = 1024;

function clip(message: string): string {
	return message.length > MAX_ERROR_MESSAGE_LENGTH ? message.slice(0, MAX_ERROR_MESSAGE_LENGTH) : message;
}

/** The message is clipped to MAX_ERROR_MESSAGE_LENGTH; every caller gets the error rebuilt from this form. */
function serializeError(error: unknown): SerializedError {
	if (!(error instanceof Error)) {
		return { name: 'Error', message: clip(String(error)) };
	}
	const serialized: SerializedError = { name: error.name, message: clip(error.message) };
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
function settle(entry: CacheEntry): SummaryResult {
	if (entry.kind === 'error') throw restoreError(entry.error);
	return structuredClone(entry.value);
}

/**
 * Runs `task` at most once per key at a time and caches the outcome, failures included.
 * Order: cache lookup → `task` through the coordinator → a structuredClone copy stored in the cache → a separate copy for each caller.
 * Every caller, including the one whose call ran `task`, gets its result or error rebuilt from the same CacheEntry.
 */
export async function runCoalesced(
	deps: CoalesceDeps,
	key: string,
	task: () => Promise<SummaryResult>,
): Promise<SummaryResult> {
	const { cache, coordinator } = deps;

	const cached = await cache?.get(key);
	if (cached !== undefined) return settle(cached);

	const execute = async (): Promise<CacheEntry> => {
		// With a coordinator, check again: a task for this key may have finished between the lookup above
		// and getting the slot. Without one there is no slot to wait for, so the lookup above is enough.
		if (coordinator !== null) {
			const latest = await cache?.get(key);
			if (latest !== undefined) return latest;
		}

		let entry: CacheEntry;
		try {
			// Clone before storing: a value structuredClone cannot copy (e.g. a function from a plugin)
			// becomes an error entry here instead of an 'ok' entry that would throw on every cache hit.
			entry = { kind: 'ok', value: structuredClone(await task()) };
		} catch (error) {
			entry = { kind: 'error', error: serializeError(error) };
		}
		const ttl = entry.kind === 'ok' ? deps.cacheTtl : deps.errorCacheTtl;
		if (cache !== null && ttl > 0) await cache.set(key, entry, ttl);
		return entry;
	};

	return settle(coordinator === null ? await execute() : await coordinator.run(key, execute));
}
