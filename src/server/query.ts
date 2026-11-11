/**
 * Reads summaly options from the query string of `GET /`
 */

import type { SummalyOptions } from '@tiramiss-community/chiramiss';
import { MAX_TIMEOUT, toNonNegativeInteger } from './config.js';

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
