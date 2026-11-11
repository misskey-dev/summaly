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

type SummaryEntry = Extract<CacheEntry, { kind: 'ok' | 'error' }>;
type IconEntry = Extract<CacheEntry, { kind: 'icon' }>;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/** Only what `settle` can turn back into a result: a cache may hand back another use's entry, or anything at all. */
function isSummaryEntry(entry: unknown): entry is SummaryEntry {
	if (!isObject(entry)) return false;
	if (entry.kind === 'ok') return isObject(entry.value);
	if (entry.kind === 'error') return isObject(entry.error);
	return false;
}

function isIconEntry(entry: unknown): entry is IconEntry {
	return isObject(entry) && entry.kind === 'icon' && (typeof entry.href === 'string' || entry.href === null);
}

/** Gives the caller its own copy: the host app rewrites results it receives (icon, thumbnail). */
function settle(entry: SummaryEntry): SummaryResult {
	if (entry.kind === 'error') throw restoreError(entry.error);
	return structuredClone(entry.value);
}

/**
 * Runs `task` and turns its outcome into a CacheEntry. Cloned before storing: a value structuredClone cannot copy
 * (e.g. a function from a plugin) becomes an error entry here instead of an 'ok' entry that would throw on every cache hit.
 */
async function runTask(task: () => Promise<SummaryResult>): Promise<SummaryEntry> {
	try {
		return { kind: 'ok', value: structuredClone(await task()) };
	} catch (error) {
		return { kind: 'error', error: serializeError(error) };
	}
}

/** One use of the cache: how its entries are made, recognized, timed and handed back. */
type Use<E extends CacheEntry, T> = {
	/** Does the work and returns its outcome as an entry. */
	run: () => Promise<E>;
	/** Whether a stored entry is this use's. Any other entry (another use's, or a broken one) counts as a miss. */
	accepts: (entry: unknown) => entry is E;
	/** Whether the entry is kept for `cacheTtl` (true) or `errorCacheTtl` (false). */
	succeeded: (entry: E) => boolean;
	/** The caller's result from the entry. */
	settle: (entry: E) => T;
};

/**
 * Runs `use.run` at most once per key at a time and caches the entry it returns, failures included.
 * Order: cache lookup → `use.run` through the coordinator → the entry stored in the cache → a result settled for each caller.
 * Every caller, including the one whose call ran the work, gets its result settled from the same entry.
 * A failing `cache.get` or coordinator rejects; a failing `cache.set` does not (the entry is just not stored).
 * `key` is called only when there is a cache or a coordinator to use it (building it hashes every option).
 */
async function coalesce<E extends CacheEntry, T>(deps: CoalesceDeps, key: () => string, use: Use<E, T>): Promise<T> {
	const { cache, coordinator } = deps;
	if (cache === null && coordinator === null) return use.settle(await use.run());
	const requestKey = key();

	const lookup = async (): Promise<E | undefined> => {
		const entry = await cache?.get(requestKey);
		return use.accepts(entry) ? entry : undefined;
	};

	const cached = await lookup();
	if (cached !== undefined) return use.settle(cached);

	const execute = async (): Promise<E> => {
		// With a coordinator, check again: work for this key may have finished between the lookup above
		// and getting the slot. Without one there is no slot to wait for, so the lookup above is enough.
		if (coordinator !== null) {
			const latest = await lookup();
			if (latest !== undefined) return latest;
		}

		const entry = await use.run();
		const ttl = use.succeeded(entry) ? deps.cacheTtl : deps.errorCacheTtl;
		if (cache !== null && ttl > 0) {
			// Storing is best effort: a failed set must not throw away work already done, nor make the callers
			// sharing it (or the favicon check's fallback) do it again.
			try {
				await cache.set(requestKey, entry, ttl);
			} catch {
				// Not stored; the callers still get the entry.
			}
		}
		return entry;
	};

	return use.settle(coordinator === null ? await execute() : await coordinator.run(requestKey, execute));
}

/**
 * Runs a summary `task` at most once per key at a time and caches the outcome, failures included.
 * The stored entry is a structuredClone copy, and each caller gets a separate copy (or the error rebuilt from it).
 */
export function runCoalesced(
	deps: CoalesceDeps,
	key: () => string,
	task: () => Promise<SummaryResult>,
): Promise<SummaryResult> {
	return coalesce(deps, key, {
		run: () => runTask(task),
		accepts: isSummaryEntry,
		succeeded: entry => entry.kind === 'ok',
		settle,
	});
}

/**
 * Runs a favicon `check` at most once per key at a time and caches its outcome: the href to return as the icon,
 * kept for `cacheTtl`, or null (the check failed), kept for `errorCacheTtl`. Only that outcome is stored.
 */
export function runCoalescedIcon(
	deps: CoalesceDeps,
	key: () => string,
	check: () => Promise<string | null>,
): Promise<string | null> {
	return coalesce(deps, key, {
		run: async () => ({ kind: 'icon', href: await check() }),
		accepts: isIconEntry,
		succeeded: entry => entry.href !== null,
		settle: entry => entry.href,
	});
}
