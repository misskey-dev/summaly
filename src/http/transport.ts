import http from 'node:http';
import https from 'node:https';
import type { ProxyOptions, SummalyOptions } from '@/types.js';
import { type AddressGuard, createAddressGuard, createGuardedLookup, isGuardDisabled } from './address-guard.js';

/** Per-call connection settings. Holds no global state. */
export type Transport = {
	/**
	 * Caller-supplied agents. A hop whose scheme has one uses it and leaves private IP blocking to it.
	 * A hop whose scheme has none uses `guardedAgents` (or Node's default agent when the guard is off).
	 */
	agents: { http?: http.Agent; https?: https.Agent };
	/**
	 * Private IP guard, applied per hop to schemes without a caller-supplied agent.
	 * null when SUMMALY_ALLOW_PRIVATE_IP=true, or when the caller supplies agents for both schemes.
	 */
	guard: AddressGuard | null;
	/**
	 * Agents owned by this transport, built with the guarded lookup. Never shared with other pools,
	 * so every guarded connection runs the connect-time check (no reuse of unguarded sockets).
	 * null when `guard` is null.
	 */
	guardedAgents: { http: http.Agent; https: https.Agent } | null;
	/** Outbound proxy settings. Ignored (null) when the caller supplies an agent. */
	proxy: ProxyOptions | null;
};

export function createTransport(
	opts: { agent?: SummalyOptions['agent']; allowedPrivateNetworks?: string[]; proxy?: ProxyOptions },
	env: NodeJS.ProcessEnv = process.env,
): Transport {
	const agents = { http: opts.agent?.http, https: opts.agent?.https };
	const hasAgent = agents.http != null || agents.https != null;
	// The guard is handed off per scheme: only a scheme whose agent the caller supplied leaves blocking to the caller.
	const guardOff = isGuardDisabled(undefined, env) || (agents.http != null && agents.https != null);
	const guard = guardOff ? null : createAddressGuard(opts.allowedPrivateNetworks);
	return {
		agents: hasAgent ? agents : {},
		guard,
		guardedAgents: guard ? createGuardedAgents(guard) : null,
		proxy: hasAgent ? null : opts.proxy ?? null,
	};
}

function createGuardedAgents(guard: AddressGuard): { http: http.Agent; https: https.Agent } {
	const lookup = createGuardedLookup(guard);
	// keepAlive off: the transport has no close hook, so idle pooled sockets would outlive the call.
	return {
		http: new http.Agent({ keepAlive: false, lookup }),
		https: new https.Agent({ keepAlive: false, lookup }),
	};
}
