import type http from 'node:http';
import type https from 'node:https';
import type { ProxyOptions, SummalyOptions } from '@/types.js';
import { type AddressGuard, createAddressGuard, privateIpAllowedByEnv } from './address-guard.js';
import { type GuardedAgentPool, type GuardedAgentSet, createGuardedAgents } from './agent-pool.js';
import { assertProxyOptions, createProxyAgents, selectProxyUrl } from './proxy/index.js';

/**
 * Per-call connection settings. Holds no global state: one transport serves one summary call and is closed when that
 * call ends. Its requests share connections; with an agent pool (owned by the summarizer), so do the calls that use
 * the same pool and the same guard setting.
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
	 * Keep-alive agents built with the guarded lookup of `guard` (see createGuardedAgents), so every guarded connection
	 * runs the connect-time check and none is shared with agents of another guard setting (no reuse of sockets
	 * checked under another policy). The requests of one call (HEAD for the final URL, the page, favicon, oEmbed)
	 * reuse their sockets.
	 * - With an agent pool, they come from the pool and are shared with the other calls of the pool's summarizer that
	 *   have the same guard setting; `close` leaves them (and their idle sockets, closed on their idle timeout) alone.
	 * - Without one, this transport builds its own and `close` destroys them.
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
	 * Destroys every agent this transport owns with their sockets, idle or not: the proxy agents, and the guarded agents
	 * unless they come from an agent pool. Caller-supplied agents are left alone.
	 * Call it once the summary call is done, whatever its outcome.
	 */
	close(): void;
};

/**
 * `opts.allowPrivateIp` is whether the environment allows private IPs, as the caller already read it
 * (so that its keys and this transport use the same value); when omitted, it is read from `env`.
 * `opts.agentPool` supplies the guarded agents (and the guard) for `opts.allowedPrivateNetworks`; without it, this
 * transport builds its own. Unused when the guard is off.
 */
export function createTransport(
	opts: {
		agent?: SummalyOptions['agent'];
		allowedPrivateNetworks?: string[];
		proxy?: ProxyOptions;
		allowPrivateIp?: boolean;
		agentPool?: GuardedAgentPool;
	},
	env: NodeJS.ProcessEnv = process.env,
): Transport {
	// Public input: reject unusable proxy URLs (any scheme, even one a caller agent replaces) up front.
	if (opts.proxy) {
		assertProxyOptions(opts.proxy);
	}
	const agents = { http: opts.agent?.http, https: opts.agent?.https };
	const hasAgent = agents.http != null || agents.https != null;
	// The guard is handed off per scheme: only a scheme whose agent the caller supplied leaves blocking to the caller.
	const guardOff = (opts.allowPrivateIp ?? privateIpAllowedByEnv(env)) || (agents.http != null && agents.https != null);
	const guarded = guardOff ? null : (opts.agentPool?.acquire(opts.allowedPrivateNetworks) ?? ownGuardedAgents(opts.allowedPrivateNetworks));
	const ownsGuardedAgents = opts.agentPool == null;
	const guard = guarded?.guard ?? null;
	const guardedAgents = guarded?.agents ?? null;
	const proxy = proxyWithoutCallerSchemes(opts.proxy, agents);
	// A guarded transport never lets the proxy resolve a target name: its agents CONNECT only to validated addresses.
	const proxyAgents = proxy ? createProxyAgents(proxy, { requireAddress: guard != null }) : {};

	return {
		agents: hasAgent ? agents : {},
		guard,
		guardedAgents,
		proxy,
		proxyAgents,
		close() {
			if (ownsGuardedAgents) {
				guardedAgents?.http.destroy();
				guardedAgents?.https.destroy();
			}
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
	if (!proxy) {
		return null;
	}
	const result: ProxyOptions = {};

	if (proxy.http && agents.http == null) {
		result.http = proxy.http;
	}
	if (proxy.https && agents.https == null) {
		result.https = proxy.https;
	}
	if (!result.http && !result.https) {
		return null;
	}
	if (proxy.noProxy) {
		result.noProxy = proxy.noProxy;
	}

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

		if (!agent) {
			throw new Error('Proxied transport has no proxy agent');
		}

		return agent;
	}
	if (!transport.guard) {
		return undefined;
	}
	const agent = isHttps ? transport.guardedAgents?.https : transport.guardedAgents?.http;

	if (!agent) {
		throw new Error('Guarded transport has no guarded agent');
	}

	return agent;
}

/** A guard and agents built for one transport, destroyed by its close. */
function ownGuardedAgents(allowedNetworks: string[] | undefined): GuardedAgentSet {
	const guard = createAddressGuard(allowedNetworks);

	return { guard, agents: createGuardedAgents(guard) };
}
