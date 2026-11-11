import { buildIconKey } from '@/coalesce/key.js';
import type { CoalesceDeps } from '@/coalesce/run.js';
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

export function createScrapeContext(opts: SummarizeOptions, coalesce: CoalesceDeps = NO_COALESCE): ScrapeContext {
	return {
		options: resolveOptions(opts),
		scrapingOptions: toScrapingOptions(opts),
		transport: createTransport({
			agent: opts.agent,
			allowedPrivateNetworks: opts.allowedPrivateNetworks,
			proxy: opts.proxy,
		}),
		coalesce,
		iconKey: url => buildIconKey(url, opts),
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
