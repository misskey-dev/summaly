import type { ProxyOptions } from '@/types.js';
import { DEFAULT_PORTS } from './proxy-url.js';

/**
 * Returns the proxy URL to use for `target`, or null to connect directly.
 * The proxy is picked by the target's scheme; `noProxy` entries (comma separated) bypass it:
 * `*` (everything), a host name or IP (exact or domain suffix, with or without a leading dot),
 * and `host:port` (only that port; `[v6]:port` for IPv6).
 */
export function selectProxyUrl(target: URL, proxy: ProxyOptions): string | null {
	const proxyUrl = target.protocol === 'https:' ? proxy.https : target.protocol === 'http:' ? proxy.http : undefined;
	if (!proxyUrl) {
		return null;
	}
	if (proxy.noProxy && isBypassed(target, proxy.noProxy)) {
		return null;
	}
	return proxyUrl;
}

function isBypassed(target: URL, noProxy: string): boolean {
	const host = target.hostname.replace(/^\[|\]$/g, '');
	const port = target.port || DEFAULT_PORTS[target.protocol];
	return noProxy.split(',').some(raw => {
		const entry = raw.trim().toLowerCase();
		if (entry === '') {
			return false;
		}
		if (entry === '*') {
			return true;
		}
		const parsed = parseEntry(entry);
		if (parsed.port !== null && parsed.port !== port) {
			return false;
		}
		const domain = parsed.host.replace(/^\./, '');
		return domain !== '' && (host === domain || host.endsWith(`.${domain}`));
	});
}

function parseEntry(entry: string): { host: string; port: string | null } {
	const bracketed = /^\[([^\]]*)\](?::(\d+))?$/.exec(entry);
	if (bracketed) {
		// The port group is optional, so it can be undefined at runtime.
		const port = bracketed[2] as string | undefined;
		return { host: bracketed[1], port: port ?? null };
	}
	const colon = entry.indexOf(':');
	// More than one colon without brackets is a bare IPv6 address.
	if (colon === -1 || colon !== entry.lastIndexOf(':')) {
		return { host: entry, port: null };
	}
	return { host: entry.slice(0, colon), port: entry.slice(colon + 1) };
}
