/**
 * Reads summaly options from the query string of `GET /` (see fastifySummaly)
 */

import { DEFAULT_MAX_RESPONSE_SIZE, DEFAULT_OPERATION_TIMEOUT, DEFAULT_RESPONSE_TIMEOUT } from '@/options.js';
import type { SummalyOptions } from '@/types.js';
import { MAX_TIMEOUT, toNonNegativeInteger } from '@/util/integer.js';

/**
 * Builds the per-request options from the query and the options the plugin was registered with
 * (which the standalone server takes from environment variables).
 *
 * - lang, userAgent, followRedirects: the registered option wins over the query; followRedirects defaults to false.
 * - responseTimeout, operationTimeout, contentLengthLimit: the query may only tighten. The ceiling is the registered
 *   option when set, otherwise the lib default; a query value is used only when it is above 0 and not above the
 *   ceiling (0 would mean no timeout). Otherwise the ceiling applies. A timeout ceiling of 0 (no timeout) has no
 *   upper bound, so any timeout above 0 from the query tightens it and is used.
 * - contentLengthRequired: the query may only turn the check on.
 */
export function resolveRequestOptions(query: Record<string, unknown>, envOptions: SummalyOptions): SummalyOptions {
	const { responseTimeout, operationTimeout, contentLengthLimit, contentLengthRequired, ...fromQuery } = parseQueryOptions(query);

	const options: SummalyOptions = {
		followRedirects: false,
		...fromQuery,
		...envOptions,
		responseTimeout: tightenTimeout(responseTimeout, envOptions.responseTimeout ?? DEFAULT_RESPONSE_TIMEOUT),
		operationTimeout: tightenTimeout(operationTimeout, envOptions.operationTimeout ?? DEFAULT_OPERATION_TIMEOUT),
		contentLengthLimit: tighten(contentLengthLimit, envOptions.contentLengthLimit ?? DEFAULT_MAX_RESPONSE_SIZE),
	};

	if (contentLengthRequired === true) {
		options.contentLengthRequired = true;
	}

	return options;
}

function tighten(requested: number | undefined, ceiling: number): number {
	return requested != null && requested > 0 && requested <= ceiling ? requested : ceiling;
}

/** Like tighten, but a ceiling of 0 means no timeout, which any positive timeout tightens. */
function tightenTimeout(requested: number | undefined, ceiling: number): number {
	return ceiling === 0 && requested != null && requested > 0 ? requested : tighten(requested, ceiling);
}

/**
 * Picks the options the host app sends along with `url` (see UrlPreviewService.fetchSummaryFromProxy).
 *
 * A missing, malformed or repeated (array) value is left out, as if it had not been given.
 */
export function parseQueryOptions(query: Record<string, unknown>): Partial<SummalyOptions> {
	const options: Partial<SummalyOptions> = {};

	const lang = readString(query, 'lang');

	if (lang != null) {
		options.lang = lang;
	}

	const followRedirects = readBoolean(query, 'followRedirects');

	if (followRedirects != null) {
		options.followRedirects = followRedirects;
	}

	const userAgent = readString(query, 'userAgent');

	if (userAgent != null && userAgent !== '') {
		options.userAgent = userAgent;
	}

	const responseTimeout = readInteger(query, 'responseTimeout', MAX_TIMEOUT);

	if (responseTimeout != null) {
		options.responseTimeout = responseTimeout;
	}

	const operationTimeout = readInteger(query, 'operationTimeout', MAX_TIMEOUT);

	if (operationTimeout != null) {
		options.operationTimeout = operationTimeout;
	}

	const contentLengthLimit = readInteger(query, 'contentLengthLimit');

	if (contentLengthLimit != null) {
		options.contentLengthLimit = contentLengthLimit;
	}

	const contentLengthRequired = readBoolean(query, 'contentLengthRequired');

	if (contentLengthRequired != null) {
		options.contentLengthRequired = contentLengthRequired;
	}

	return options;
}

function readString(query: Record<string, unknown>, name: string): string | undefined {
	const value = query[name];

	return typeof value === 'string' ? value : undefined;
}

/** Only the exact strings the host sends (`String(true)` / `String(false)`) */
function readBoolean(query: Record<string, unknown>, name: string): boolean | undefined {
	switch (readString(query, name)) {
		case 'true':
			return true;
		case 'false':
			return false;
		default:
			return undefined;
	}
}

function readInteger(query: Record<string, unknown>, name: string, max?: number): number | undefined {
	const value = readString(query, name);

	return value != null ? toNonNegativeInteger(value, max) : undefined;
}
