import type * as http from 'node:http';
import type * as https from 'node:https';
import type { ProxyOptions, SummalyOptions } from '@/types.js';
import { type AddressGuard, createAddressGuard, isGuardDisabled } from './address-guard.js';

/** Per-call connection settings. Holds no global state. */
export type Transport = {
	/** Caller-supplied agents. When a slot is undefined, Node's default agent is used. */
	agents: { http?: http.Agent; https?: https.Agent };
	/** Private IP guard. null when blocking is left to the caller (agent given) or disabled for tests. */
	guard: AddressGuard | null;
	/** Outbound proxy settings. Ignored (null) when the caller supplies an agent. */
	proxy: ProxyOptions | null;
};

export function createTransport(
	opts: { agent?: SummalyOptions['agent']; allowedPrivateNetworks?: string[]; proxy?: ProxyOptions },
	env: NodeJS.ProcessEnv = process.env,
): Transport {
	const agents = { http: opts.agent?.http, https: opts.agent?.https };
	const hasAgent = agents.http != null || agents.https != null;
	return {
		agents: hasAgent ? agents : {},
		guard: isGuardDisabled(opts.agent, env) ? null : createAddressGuard(opts.allowedPrivateNetworks),
		proxy: hasAgent ? null : opts.proxy ?? null,
	};
}
