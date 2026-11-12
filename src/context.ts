import { buildIconKey } from '@/coalesce/key.js';
import type { CoalesceDeps } from '@/coalesce/run.js';
import { privateIpAllowedByEnv } from '@/http/address-guard.js';
import type { GuardedAgentPool } from '@/http/agent-pool.js';
import { type FetchRequest, type FetchResult, fetchResponse } from '@/http/request.js';
import { type Transport, createTransport } from '@/http/transport.js';
import { type ResolvedOptions, resolveOptions } from '@/options.js';
import type { SummalyOptions } from '@/types.js';

/** Everything one summary needs to make requests. Built per call; holds no global state. */
export type ScrapeContext = {
	options: ResolvedOptions;
	transport: Transport;
	/**
	 * The summarizer's cache and in-flight sharing, for results shared between summaries (favicon checks).
	 * Both are off in a context built without them.
	 */
	coalesce: CoalesceDeps;
	/** Key of a favicon check of `url` (absolute) under this call's options. */
	iconKey: (url: string) => string;
};

const NO_COALESCE: CoalesceDeps = Object.freeze({ cache: null, coordinator: null });

/**
 * `opts` with its arrays and objects copied (`allowedPrivateNetworks`, `proxy`, `agent`, `plugins`), so a caller changing
 * them while a call runs does not reach the call. A call builds its transport and every key from one such copy
 * and one reading of the private IP environment variables, so the transport that sends a request and the key its
 * result is stored under always agree on what may be reached.
 */
export function fixOptions(opts: SummalyOptions): SummalyOptions {
	return {
		...opts,
		allowedPrivateNetworks: opts.allowedPrivateNetworks?.slice(),
		proxy: opts.proxy && { ...opts.proxy },
		agent: opts.agent && { ...opts.agent },
		plugins: opts.plugins?.slice(),
	};
}

/**
 * `allowPrivateIp` is whether the environment allows private IPs (see privateIpAllowedByEnv); a summarizer passes
 * the value its summary key was built with. The transport and the favicon check keys use the same value and the same
 * copy of `opts` (see fixOptions).
 * `agentPool` is the summarizer's pool of guarded agents, keyed by that copy's `allowedPrivateNetworks`; without it,
 * the transport builds its own agents and its close destroys them.
 */
export function createScrapeContext(
	opts: SummalyOptions,
	coalesce: CoalesceDeps = NO_COALESCE,
	allowPrivateIp: boolean = privateIpAllowedByEnv(),
	agentPool?: GuardedAgentPool,
): ScrapeContext {
	const fixed = fixOptions(opts);

	return {
		options: resolveOptions(fixed),
		transport: createTransport({
			agent: fixed.agent,
			allowedPrivateNetworks: fixed.allowedPrivateNetworks,
			proxy: fixed.proxy,
			allowPrivateIp,
			agentPool,
		}),
		coalesce,
		iconKey: url => buildIconKey(url, fixed, allowPrivateIp),
	};
}

type ContextRequest = Pick<FetchRequest, 'url' | 'method' | 'headers'> & Partial<FetchRequest>;

/**
 * Sends a request through the context's transport with its User-Agent, timeouts and size limits.
 * Fields given in `req` take precedence; `req.headers` are merged over the User-Agent.
 */
export function fetchWithContext(ctx: ScrapeContext, req: ContextRequest): Promise<FetchResult> {
	const { options } = ctx;

	return fetchResponse(ctx.transport, {
		followRedirects: options.followRedirects,
		responseTimeout: options.responseTimeout,
		operationTimeout: options.operationTimeout,
		contentLengthLimit: options.contentLengthLimit,
		contentLengthRequired: options.contentLengthRequired,
		...req,
		headers: { 'user-agent': options.userAgent, ...req.headers },
	});
}

/**
 * Fetches a resource referenced by a page (oEmbed endpoint, favicon).
 * Accepts any type, follows redirects and does not require content-length.
 * The context's transport, User-Agent, timeouts and size limit apply.
 */
export function fetchSubresource(ctx: ScrapeContext, url: string, method: 'GET' | 'HEAD'): Promise<FetchResult> {
	return fetchWithContext(ctx, {
		url,
		method,
		headers: { accept: '*/*' },
		followRedirects: true,
		contentLengthRequired: false,
	});
}
