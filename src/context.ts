import { buildIconKey } from '@/coalesce/key.js';
import type { CoalesceDeps } from '@/coalesce/run.js';
import { privateIpAllowedByEnv } from '@/http/address-guard.js';
import { type FetchRequest, type FetchResult, fetchResponse } from '@/http/request.js';
import { type Transport, createTransport } from '@/http/transport.js';
import { type ResolvedOptions, resolveOptions } from '@/options.js';
import { toScrapingOptions } from '@/providers/provider.js';
import type { GeneralScrapingOptions, SummarizeOptions } from '@/types.js';

/** Everything one summary needs to make requests. Built per call; holds no global state. */
export type ScrapeContext = {
	options: ResolvedOptions;
	/** The caller's raw values (no defaults filled in, lang not validated), as upstream hands them to plugins. */
	scrapingOptions: GeneralScrapingOptions;
	transport: Transport;
	/**
	 * The summarizer's cache and in-flight sharing, for results shared between summaries (favicon checks).
	 * Both are off in a context built without them.
	 */
	coalesce: CoalesceDeps;
	/** Key of a favicon check of `url` (absolute) under this call's options. */
	iconKey: (url: string) => string;
};

const NO_COALESCE: CoalesceDeps = Object.freeze({ cache: null, coordinator: null, cacheTtl: 0, errorCacheTtl: 0 });

/**
 * `opts` with its arrays and objects copied (`allowedPrivateNetworks`, `proxy`, `agent`, `plugins`), so a caller changing
 * them while a call runs does not reach the call. A call builds its transport and every key from one such copy
 * and one reading of the private IP environment variables, so the transport that sends a request and the key its
 * result is stored under always agree on what may be reached.
 */
export function fixOptions(opts: SummarizeOptions): SummarizeOptions {
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
 */
export function createScrapeContext(
	opts: SummarizeOptions,
	coalesce: CoalesceDeps = NO_COALESCE,
	allowPrivateIp: boolean = privateIpAllowedByEnv(),
): ScrapeContext {
	const fixed = fixOptions(opts);
	return {
		options: resolveOptions(fixed),
		scrapingOptions: toScrapingOptions(fixed),
		transport: createTransport({
			agent: fixed.agent,
			allowedPrivateNetworks: fixed.allowedPrivateNetworks,
			proxy: fixed.proxy,
			allowPrivateIp,
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
 * Like upstream's `get()` / `head()`: accepts any type, follows redirects, does not require content-length.
 * Unlike upstream, the context's transport, User-Agent, timeouts and size limit apply.
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
