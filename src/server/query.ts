/**
 * Reads summaly options from the query string of `GET /`
 */

import type { SummalyOptions } from '@tiramiss-community/chiramiss';
import { MAX_TIMEOUT, toNonNegativeInteger } from './config.js';

// Mirrors DEFAULT_RESPONSE_TIMEOUT / DEFAULT_OPERATION_TIMEOUT / DEFAULT_MAX_RESPONSE_SIZE in
// packages/chiramiss/src/options.ts, which the lib's public entry does not export. test/app.test.ts checks they match.
export const LIB_DEFAULT_RESPONSE_TIMEOUT = 20 * 1000;
export const LIB_DEFAULT_OPERATION_TIMEOUT = 60 * 1000;
export const LIB_DEFAULT_CONTENT_LENGTH_LIMIT = 10 * 1024 * 1024;

/**
 * Builds the per-request options from the query and the options set by environment variables.
 *
 * - lang, userAgent, followRedirects: the environment variable wins over the query; followRedirects defaults to false
 *   like upstream's server.
 * - responseTimeout, operationTimeout, contentLengthLimit: the query may only tighten. The ceiling is the environment
 *   variable when set, otherwise the lib default; a query value is used only when it is above 0 and not above the
 *   ceiling (0 would mean no timeout). Otherwise the ceiling applies.
 * - contentLengthRequired: the query may only turn the check on.
 */
export function resolveRequestOptions(query: Record<string, unknown>, envOptions: SummalyOptions): SummalyOptions {
	const { responseTimeout, operationTimeout, contentLengthLimit, contentLengthRequired, ...fromQuery } = parseQueryOptions(query);

	const options: SummalyOptions = {
		followRedirects: false,
		...fromQuery,
		...envOptions,
		responseTimeout: tighten(responseTimeout, envOptions.responseTimeout ?? LIB_DEFAULT_RESPONSE_TIMEOUT),
		operationTimeout: tighten(operationTimeout, envOptions.operationTimeout ?? LIB_DEFAULT_OPERATION_TIMEOUT),
		contentLengthLimit: tighten(contentLengthLimit, envOptions.contentLengthLimit ?? LIB_DEFAULT_CONTENT_LENGTH_LIMIT),
	};
	if (contentLengthRequired === true) options.contentLengthRequired = true;

	return options;
}

function tighten(requested: number | undefined, ceiling: number): number {
	return requested != null && requested > 0 && requested <= ceiling ? requested : ceiling;
}

/**
 * Picks the options the host app sends along with `url` (see UrlPreviewService.fetchSummaryFromProxy).
 *
 * A missing, malformed or repeated (array) value is left out, as if it had not been given:
 * upstream's server ignored all of these but `lang`, so dropping a value keeps its behavior.
 */
export function parseQueryOptions(query: Record<string, unknown>): Partial<SummalyOptions> {
	const options: Partial<SummalyOptions> = {};

	const lang = readString(query, 'lang');
	if (lang != null) options.lang = lang;

	const followRedirects = readBoolean(query, 'followRedirects');
	if (followRedirects != null) options.followRedirects = followRedirects;

	const userAgent = readString(query, 'userAgent');
	if (userAgent != null && userAgent !== '') options.userAgent = userAgent;

	const responseTimeout = readInteger(query, 'responseTimeout', MAX_TIMEOUT);
	if (responseTimeout != null) options.responseTimeout = responseTimeout;

	const operationTimeout = readInteger(query, 'operationTimeout', MAX_TIMEOUT);
	if (operationTimeout != null) options.operationTimeout = operationTimeout;

	const contentLengthLimit = readInteger(query, 'contentLengthLimit');
	if (contentLengthLimit != null) options.contentLengthLimit = contentLengthLimit;

	const contentLengthRequired = readBoolean(query, 'contentLengthRequired');
	if (contentLengthRequired != null) options.contentLengthRequired = contentLengthRequired;

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
