import http from 'node:http';
import https from 'node:https';
import type { ProxyOptions, SummarizeOptions } from '@/types.js';
import { type AddressGuard, createAddressGuard, createGuardedLookup, privateIpAllowedByEnv } from './address-guard.js';
import { assertProxyOptions, createProxyAgents, selectProxyUrl } from './proxy/index.js';

/**
 * Per-call connection settings. Holds no global state: one transport serves one summary call
 * (its requests may share connections) and is closed when that call ends.
 */
export type Transport = {
	/**
	 * Caller-supplied agents. A hop whose scheme has one uses it and leaves private IP blocking to it.
	 * A hop whose scheme has none uses `proxyAgents` or `guardedAgents` (or Node's default agent when the guard is off).
	 * Never holds agents the transport built itself: an entry here hands the guard off for its scheme.
	 */
	agents: { http?: http.Agent; https?: https.Agent };
	/**
	 * Private IP guard, applied per hop to schemes without a caller-supplied agent.
	 * null when the environment allows private IPs (see privateIpAllowedByEnv), or when the caller supplies agents for both schemes.
	 */
	guard: AddressGuard | null;
	/**
	 * Agents owned by this transport, built with the guarded lookup. Never shared with other pools or other calls,
	 * so every guarded connection runs the connect-time check (no reuse of unguarded sockets).
	 * They keep connections alive so the requests of one call (HEAD for the final URL, the page, favicon, oEmbed)
	 * can reuse a socket this transport opened and checked; `close` destroys them.
	 * null when `guard` is null.
	 */
	guardedAgents: { http: http.Agent; https: https.Agent } | null;
	/**
	 * Outbound proxy settings for the schemes without a caller-supplied agent
	 * (a caller agent replaces the proxy for its scheme). null when no such scheme has a proxy.
	 */
	proxy: ProxyOptions | null;
	/**
	 * Proxy agents owned by this transport, one per scheme in `proxy`. They resolve only the proxy host,
	 * so a proxied hop checks its target with `assertHostAllowed` before anything is sent to the proxy,
	 * and tunnels to an address that check validated (see `TUNNEL_TARGET`). While `guard` is set they refuse
	 * a request without validated addresses.
	 */
	proxyAgents: { http?: http.Agent; https?: https.Agent };
	/**
	 * Destroys every agent this transport owns (guarded and proxy agents) with their sockets, idle or not.
	 * Caller-supplied agents are left alone. Call it once the summary call is done, whatever its outcome.
	 */
	close(): void;
};

/**
 * `opts.allowPrivateIp` is whether the environment allows private IPs, as the caller already read it
 * (so that its keys and this transport use the same value); when omitted, it is read from `env`.
 */
export function createTransport(
	opts: { agent?: SummarizeOptions['agent']; allowedPrivateNetworks?: string[]; proxy?: ProxyOptions; allowPrivateIp?: boolean },
	env: NodeJS.ProcessEnv = process.env,
): Transport {
	// Public input: reject unusable proxy URLs (any scheme, even one a caller agent replaces) up front.
	if (opts.proxy) assertProxyOptions(opts.proxy);
	const agents = { http: opts.agent?.http, https: opts.agent?.https };
	const hasAgent = agents.http != null || agents.https != null;
	// The guard is handed off per scheme: only a scheme whose agent the caller supplied leaves blocking to the caller.
	const guardOff = (opts.allowPrivateIp ?? privateIpAllowedByEnv(env)) || (agents.http != null && agents.https != null);
	const guard = guardOff ? null : createAddressGuard(opts.allowedPrivateNetworks);
	const proxy = proxyWithoutCallerSchemes(opts.proxy, agents);
	const guardedAgents = guard ? createGuardedAgents(guard) : null;
	// A guarded transport never lets the proxy resolve a target name: its agents CONNECT only to validated addresses.
	const proxyAgents = proxy ? createProxyAgents(proxy, { requireAddress: guard != null }) : {};
	return {
		agents: hasAgent ? agents : {},
		guard,
		guardedAgents,
		proxy,
		proxyAgents,
		close() {
			guardedAgents?.http.destroy();
			guardedAgents?.https.destroy();
			proxyAgents.http?.destroy();
			proxyAgents.https?.destroy();
		},
	};
}

/** Drops the proxy of each scheme the caller supplied an agent for. */
function proxyWithoutCallerSchemes(
	proxy: ProxyOptions | undefined,
	agents: { http?: http.Agent; https?: https.Agent },
): ProxyOptions | null {
	if (!proxy) return null;
	const result: ProxyOptions = {};
	if (proxy.http && agents.http == null) result.http = proxy.http;
	if (proxy.https && agents.https == null) result.https = proxy.https;
	if (!result.http && !result.https) return null;
	if (proxy.noProxy) result.noProxy = proxy.noProxy;
	return result;
}

/**
 * The transport-owned agent for a hop whose scheme has no caller-supplied agent:
 * the proxy agent when the target goes through the proxy, otherwise the guarded agent.
 * undefined (Node's default agent) only when the guard is off and the target is not proxied.
 */
export function selectOwnedAgent(transport: Transport, url: URL): http.Agent | undefined {
	const isHttps = url.protocol === 'https:';
	if (transport.proxy && selectProxyUrl(url, transport.proxy) !== null) {
		const agent = isHttps ? transport.proxyAgents.https : transport.proxyAgents.http;
		if (!agent) throw new Error('Proxied transport has no proxy agent');
		return agent;
	}
	if (!transport.guard) return undefined;
	const agent = isHttps ? transport.guardedAgents?.https : transport.guardedAgents?.http;
	if (!agent) throw new Error('Guarded transport has no guarded agent');
	return agent;
}

function createGuardedAgents(guard: AddressGuard): { http: http.Agent; https: https.Agent } {
	const lookup = createGuardedLookup(guard);
	// keepAlive: a socket goes back to the pool only after a complete response, and the pool lives as long as the
	// transport (one call); Transport#close destroys it. A response dropped early (error, size limit, timeout)
	// destroys its socket, so it never returns to the pool.
	// Accepted risk, shared by every keep-alive client: a non-compliant server that sends a body after a HEAD response
	// (or past Content-Length) in a later segment can have those bytes read as the next response on the reused socket.
	// Node destroys an idle pooled socket that receives data, and sendRequest sends again when the bytes break the
	// response (HPE_*), but bytes that happen to parse as a body go unnoticed. Not reusing after a HEAD would give up
	// most of the gain (HEAD for the final URL, then the page).
	return {
		http: new http.Agent({ keepAlive: true, lookup }),
		https: new https.Agent({ keepAlive: true, lookup }),
	};
}
