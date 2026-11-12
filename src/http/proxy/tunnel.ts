import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import type { ProxyOptions } from '@/types.js';
import { DEFAULT_PORTS, parseProxyUrl } from './proxy-url.js';

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

export const TUNNEL_TARGET = Symbol('summaly.tunnelTarget');

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
		// keepAlive off: each socket is a tunnel to the address its own hop validated. The pool key (host and port)
		// does not carry that address, so reuse could send a request through a tunnel its hop never checked.
		super({ keepAlive: false });
		this.proxy = proxy;
		this.requireAddress = requireAddress;
	}

	override createConnection(options: TunnelRequestOptions, callback?: ConnectionCallback): undefined {
		openTunnel(this, options, (err, socket) => {
			if (err || !socket) {
				callbackError(callback, err ?? new Error('Proxy tunnel failed'));
			} else {
				callback?.(null, socket);
			}
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
			if (tlsSocket) {
				callback?.(null, tlsSocket);
			} else {
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
			if (signal?.aborted || index >= hosts.length) {
				callback(err);
			} else {
				attempt();
			}
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

	if (isHttpsProxy && !net.isIP(proxyHost)) {
		requestOptions.servername = proxyHost;
	}
	const request = (isHttpsProxy ? https : http).request(requestOptions);

	let settled = false;
	const timeout = options.timeout ?? 0;
	const timer = timeout > 0
		? setTimeout(() => fail(new Error(`Timeout awaiting 'connect' for ${timeout}ms`)), timeout)
		: undefined;
	const onAbort = () => fail(abortReason(signal));

	signal?.addEventListener('abort', onAbort, { once: true });

	function settle(): boolean {
		if (settled) {
			return false;
		}
		settled = true;
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);

		return true;
	}

	function fail(err: Error) {
		if (!settle()) {
			return;
		}
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
		if (head.length > 0) {
			socket.unshift(head);
		}
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

	if (proxy.http) {
		agents.http = new TunnelingHttpAgent(parseProxyUrl(proxy.http, 'http'), options);
	}
	if (proxy.https) {
		agents.https = new TunnelingHttpsAgent(parseProxyUrl(proxy.https, 'https'), options);
	}

	return agents;
}
