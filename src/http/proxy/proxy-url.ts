import type { ProxyOptions } from '@/types.js';

/** Port used when a URL leaves it out, by scheme. */
export const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

/**
 * Checks the proxy URLs of a public `ProxyOptions`: each non-empty URL must be `http:` or `https:` with a host name.
 * Throws a TypeError naming the bad value, with any userinfo (user name and password) redacted.
 */
export function assertProxyOptions(proxy: ProxyOptions): void {
	for (const scheme of ['http', 'https'] as const) {
		const value = proxy[scheme];

		if (value) {
			parseProxyUrl(value, scheme);
		}
	}
}

/** Parses one proxy URL; throws the TypeError described in assertProxyOptions. */
export function parseProxyUrl(value: string, scheme: 'http' | 'https'): URL {
	let url: URL | undefined;

	try {
		url = new URL(value);
	} catch {
		// Reported below
	}
	if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '') {
		throw new TypeError(`Invalid ${scheme} proxy URL (only http: and https: URLs with a host are supported): ${redactUserinfo(value)}`);
	}

	return url;
}

/**
 * Replaces everything between the scheme separator (`scheme://`, or the start when there is none) and the last `@`
 * with `***`. Works on the raw text, so it also covers values `new URL()` cannot parse (where the parsed
 * user name and password are unavailable) and a user name used alone as a token.
 *
 * The standalone server keeps a copy for its startup errors (packages/server/src/config.ts); change both together.
 */
function redactUserinfo(value: string): string {
	const at = value.lastIndexOf('@');

	if (at === -1) {
		return value;
	}
	const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(value);
	const start = scheme && scheme[0].length <= at ? scheme[0].length : 0;

	return `${value.slice(0, start)}***${value.slice(at)}`;
}
