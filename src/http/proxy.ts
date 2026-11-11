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
 * Throws a TypeError naming the bad value, with any userinfo (user name and password) redacted.
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
		throw new TypeError(`Invalid ${scheme} proxy URL (only http: and https: URLs with a host are supported): ${redactUserinfo(value)}`);
	}
	return url;
}

/**
 * Replaces everything between the scheme separator (`scheme://`, or the start when there is none) and the last `@`
 * with `***`. Works on the raw text, so it also covers values `new URL()` cannot parse (where the parsed
 * user name and password are unavailable) and a user name used alone as a token.
 */
function redactUserinfo(value: string): string {
	const at = value.lastIndexOf('@');
	if (at === -1) return value;
	const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(value);
	const start = scheme && scheme[0].length <= at ? scheme[0].length : 0;
	return `${value.slice(0, start)}***${value.slice(at)}`;
}

/**
 * Per-request data for the tunneling agents, put in the request options under `TUNNEL_TARGET`.
 * Node passes request options through to `Agent#createConnection`.
 */
export type TunnelTarget = {
	/**
	 * Addresses to CONNECT to: the addresses the guard validated, tried in order until the proxy opens a tunnel.
	 * Required by agents built with `requireAddress` (a guarded transport). Only an unguarded transport may leave
	 * it out, in which case the target host name is sent and the proxy resolves it.
	 */
	addresses?: string[];
	/** Aborts a pending CONNECT, including the remaining addresses (the request's own signal is not passed on to the agent) */
	signal?: AbortSignal;
};

export type TunnelingAgentOptions = {
	/**
	 * Refuse to CONNECT unless the request carries validated addresses in `TUNNEL_TARGET` (default true).
	 * Must be true whenever the transport is guarded: CONNECT by name would let the proxy resolve the target again.
	 */
	requireAddress?: boolean;
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
	readonly requireAddress: boolean;

	constructor(proxy: URL, { requireAddress = true }: TunnelingAgentOptions = {}) {
		// keepAlive off: the transport has no close hook, so idle pooled sockets would outlive the call.
		super({ keepAlive: false });
		this.proxy = proxy;
		this.requireAddress = requireAddress;
	}

	override createConnection(options: TunnelRequestOptions, callback?: ConnectionCallback): undefined {
		openTunnel(this, options, (err, socket) => {
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
	readonly requireAddress: boolean;

	constructor(proxy: URL, { requireAddress = true }: TunnelingAgentOptions = {}) {
		super({ keepAlive: false });
		this.proxy = proxy;
		this.requireAddress = requireAddress;
	}

	override createConnection(options: TunnelRequestOptions, callback?: ConnectionCallback): undefined {
		openTunnel(this, options, (err, socket) => {
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

type TunnelCallback = (err: Error | null, socket?: net.Socket) => void;

/**
 * Opens a CONNECT tunnel through the agent's proxy to the request's target, trying each validated address in
 * order until the proxy accepts one (a non-2xx reply, an error or the per-attempt timeout moves on to the next).
 * The target's signal (the operation timeout) aborts the whole sequence.
 * A guarded agent (`requireAddress`) fails without contacting the proxy when no validated address is attached.
 */
function openTunnel(
	agent: { proxy: URL; requireAddress: boolean },
	options: TunnelRequestOptions,
	callback: TunnelCallback,
): void {
	const target = options[TUNNEL_TARGET];
	const signal = target?.signal;
	const addresses = target?.addresses ?? [];
	if (addresses.length === 0 && agent.requireAddress) {
		callback(new Error('Proxy tunnel refused: no validated address for the target (guarded transport)'));
		return;
	}
	// Only an unguarded transport gets here without addresses: the proxy resolves the name.
	const hosts = addresses.length > 0 ? addresses : [options.host ?? ''];
	let index = 0;
	const attempt = () => {
		connectOnce(agent.proxy, hosts[index], options, signal, (err, socket) => {
			if (!err) {
				callback(null, socket);
				return;
			}
			index++;
			if (signal?.aborted || index >= hosts.length) callback(err);
			else attempt();
		});
	};
	attempt();
}

/**
 * Sends one CONNECT for `host` (an address, or the target name when unguarded). The handshake (TCP connect to
 * the proxy and the CONNECT reply) is bounded by the request's `timeout` and aborted by `signal`;
 * on failure the socket to the proxy is destroyed.
 */
function connectOnce(proxy: URL, host: string, options: TunnelRequestOptions, signal: AbortSignal | undefined, callback: TunnelCallback): void {
	if (signal?.aborted) {
		callback(abortReason(signal));
		return;
	}
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
 * callers must check each target with `assertHostAllowed` and pass the validated addresses in `TUNNEL_TARGET`.
 * `requireAddress` (default true) makes the agents refuse a request without them; pass false only when unguarded.
 */
export function createProxyAgents(proxy: ProxyOptions, options: TunnelingAgentOptions = {}): { http?: http.Agent; https?: https.Agent } {
	const agents: { http?: http.Agent; https?: https.Agent } = {};
	if (proxy.http) agents.http = new TunnelingHttpAgent(parseProxyUrl(proxy.http, 'http'), options);
	if (proxy.https) agents.https = new TunnelingHttpsAgent(parseProxyUrl(proxy.https, 'https'), options);
	return agents;
}
