import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import type { ProxyOptions } from '@/types.js';

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

/**
 * Returns the proxy URL to use for `target`, or null to connect directly.
 * The proxy is picked by the target's scheme; `noProxy` entries (comma separated) bypass it:
 * `*` (everything), a host name or IP (exact or domain suffix, with or without a leading dot),
 * and `host:port` (only that port; `[v6]:port` for IPv6).
 */
export function selectProxyUrl(target: URL, proxy: ProxyOptions): string | null {
	const proxyUrl = target.protocol === 'https:' ? proxy.https : target.protocol === 'http:' ? proxy.http : undefined;
	if (!proxyUrl) return null;
	if (proxy.noProxy && isBypassed(target, proxy.noProxy)) return null;
	return proxyUrl;
}

function isBypassed(target: URL, noProxy: string): boolean {
	const host = target.hostname.replace(/^\[|\]$/g, '');
	const port = target.port || DEFAULT_PORTS[target.protocol];
	return noProxy.split(',').some(raw => {
		const entry = raw.trim().toLowerCase();
		if (entry === '') return false;
		if (entry === '*') return true;
		const parsed = parseEntry(entry);
		if (parsed.port !== null && parsed.port !== port) return false;
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
	if (colon === -1 || colon !== entry.lastIndexOf(':')) return { host: entry, port: null };
	return { host: entry.slice(0, colon), port: entry.slice(colon + 1) };
}

/**
 * Checks the proxy URLs of a public `ProxyOptions`: each non-empty URL must be `http:` or `https:` with a host name.
 * Throws a TypeError naming the bad value (with any password masked).
 */
export function assertProxyOptions(proxy: ProxyOptions): void {
	for (const scheme of ['http', 'https'] as const) {
		const value = proxy[scheme];
		if (value) parseProxyUrl(value, scheme);
	}
}

function parseProxyUrl(value: string, scheme: 'http' | 'https'): URL {
	let url: URL | undefined;
	try {
		url = new URL(value);
	} catch {
		// Reported below
	}
	if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '') {
		throw new TypeError(`Invalid ${scheme} proxy URL (only http: and https: URLs with a host are supported): ${maskPassword(value, url)}`);
	}
	return url;
}

function maskPassword(value: string, url: URL | undefined): string {
	if (!url?.password) return value;
	const masked = new URL(url.href);
	masked.password = '***';
	return masked.href;
}

/**
 * Per-request data for the tunneling agents, put in the request options under `TUNNEL_TARGET`.
 * Node passes request options through to `Agent#createConnection`.
 */
export type TunnelTarget = {
	/** Address to CONNECT to: the address the guard validated. When absent, the target host name is sent and the proxy resolves it. */
	address?: string;
	/** Aborts a pending CONNECT (the request's own signal is not passed on to the agent) */
	signal?: AbortSignal;
};

export const TUNNEL_TARGET = Symbol('chiramiss.tunnelTarget');

type TunnelRequestOptions = http.ClientRequestArgs & { [TUNNEL_TARGET]?: TunnelTarget };
type ConnectionCallback = (err: Error | null, stream: Duplex) => void;

/** Reports a failure to Node's agent callback, which takes no stream on error (@types/node types it as required). */
function callbackError(callback: ConnectionCallback | undefined, err: Error): void {
	(callback as ((err: Error) => void) | undefined)?.(err);
}

/**
 * Plain HTTP over a CONNECT tunnel (the same scheme hpagent, the host app's library, uses for http targets).
 * The CONNECT authority is the validated address from `TUNNEL_TARGET`, so the proxy never resolves the name itself;
 * the request line and Host header still carry the original host.
 */
export class TunnelingHttpAgent extends http.Agent {
	readonly proxy: URL;

	constructor(proxy: URL) {
		// keepAlive off: the transport has no close hook, so idle pooled sockets would outlive the call.
		super({ keepAlive: false });
		this.proxy = proxy;
	}

	override createConnection(options: TunnelRequestOptions, callback?: ConnectionCallback): undefined {
		openTunnel(this.proxy, options, (err, socket) => {
			if (err || !socket) callbackError(callback, err ?? new Error('Proxy tunnel failed'));
			else callback?.(null, socket);
		});
		return undefined;
	}
}

/**
 * TLS over a CONNECT tunnel to the validated address. The TLS session (SNI and certificate verification)
 * uses the original host name, as Node's https agent does for a direct connection.
 */
export class TunnelingHttpsAgent extends https.Agent {
	readonly proxy: URL;

	constructor(proxy: URL) {
		super({ keepAlive: false });
		this.proxy = proxy;
	}

	override createConnection(options: TunnelRequestOptions, callback?: ConnectionCallback): undefined {
		openTunnel(this.proxy, options, (err, socket) => {
			if (err || !socket) {
				callbackError(callback, err ?? new Error('Proxy tunnel failed'));
				return;
			}
			let tlsSocket: Duplex | null | undefined;
			try {
				// https.Agent#createConnection runs tls.connect with the request's servername, ca, etc.
				tlsSocket = super.createConnection({ ...options, socket } as https.RequestOptions);
			} catch (e) {
				socket.destroy();
				callbackError(callback, e as Error);
				return;
			}
			if (tlsSocket) callback?.(null, tlsSocket);
			else {
				socket.destroy();
				callbackError(callback, new Error('TLS connection over the proxy tunnel failed'));
			}
		});
		return undefined;
	}
}

/**
 * Opens a CONNECT tunnel through `proxy` to the request's target. The handshake (TCP connect to the proxy
 * and the CONNECT reply) is bounded by the request's `timeout` and aborted by the target's signal;
 * on failure the socket to the proxy is destroyed.
 */
function openTunnel(proxy: URL, options: TunnelRequestOptions, callback: (err: Error | null, socket?: net.Socket) => void): void {
	const target = options[TUNNEL_TARGET];
	const signal = target?.signal;
	if (signal?.aborted) {
		callback(abortReason(signal));
		return;
	}
	const host = target?.address ?? options.host ?? '';
	const authority = `${host.includes(':') ? `[${host}]` : host}:${options.port}`;
	const headers: http.OutgoingHttpHeaders = { host: authority, connection: 'close' };
	if (proxy.username || proxy.password) {
		const credentials = `${safeDecode(proxy.username)}:${safeDecode(proxy.password)}`;
		headers['proxy-authorization'] = `Basic ${Buffer.from(credentials).toString('base64')}`;
	}
	const proxyHost = proxy.hostname.replace(/^\[|\]$/g, '');
	const isHttpsProxy = proxy.protocol === 'https:';
	const requestOptions: https.RequestOptions = {
		method: 'CONNECT',
		host: proxyHost,
		port: proxy.port || DEFAULT_PORTS[proxy.protocol],
		path: authority,
		setHost: false,
		headers,
		agent: false,
	};
	if (isHttpsProxy && !net.isIP(proxyHost)) requestOptions.servername = proxyHost;
	const request = (isHttpsProxy ? https : http).request(requestOptions);

	let settled = false;
	const timeout = options.timeout ?? 0;
	const timer = timeout > 0
		? setTimeout(() => fail(new Error(`Timeout awaiting 'connect' for ${timeout}ms`)), timeout)
		: undefined;
	const onAbort = () => fail(abortReason(signal));
	signal?.addEventListener('abort', onAbort, { once: true });

	function settle(): boolean {
		if (settled) return false;
		settled = true;
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
		return true;
	}

	function fail(err: Error) {
		if (!settle()) return;
		request.destroy();
		callback(err);
	}

	request.once('connect', (res: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
		const status = res.statusCode ?? 0;
		if (settled || status < 200 || status > 299) {
			socket.destroy();
			fail(new Error(`Bad response: ${status}`));
			return;
		}
		settle();
		if (head.length > 0) socket.unshift(head);
		callback(null, socket);
	});
	// Stays attached: errors after settling (e.g. from destroy) must not go unhandled.
	request.on('error', err => fail(err));
	request.end();
}

/** Percent-decodes URL userinfo; a malformed escape is sent as written instead of throwing inside the agent. */
function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function abortReason(signal: AbortSignal | undefined): Error {
	const reason: unknown = signal?.reason;
	return reason instanceof Error ? reason : new Error('The operation was aborted');
}

/**
 * Builds the tunneling agents for the schemes that have a proxy URL.
 * The proxy host is trusted configuration and is resolved without the private IP guard;
 * callers must check each target with `assertHostAllowed` and pass the validated address in `TUNNEL_TARGET`.
 */
export function createProxyAgents(proxy: ProxyOptions): { http?: http.Agent; https?: https.Agent } {
	const agents: { http?: http.Agent; https?: https.Agent } = {};
	if (proxy.http) agents.http = new TunnelingHttpAgent(parseProxyUrl(proxy.http, 'http'));
	if (proxy.https) agents.https = new TunnelingHttpsAgent(parseProxyUrl(proxy.https, 'https'));
	return agents;
}
