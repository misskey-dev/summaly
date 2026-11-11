// Derived from misskey-dev/summaly (MIT)
import { InProcessCoordinator } from '@/coalesce/in-process-coordinator.js';
import { buildRequestKey } from '@/coalesce/key.js';
import { MemorySummaryCache } from '@/coalesce/memory-cache.js';
import { type CoalesceDeps, runCoalesced } from '@/coalesce/run.js';
import { type ScrapeContext, createScrapeContext, fetchWithContext, fixOptions } from '@/context.js';
import { scrapeGeneral } from '@/extract/general.js';
import { privateIpAllowedByEnv } from '@/http/address-guard.js';
import { builtinProviders } from '@/providers/index.js';
import { fromPlugin } from '@/providers/provider.js';
import type { SummarizeOptions, SummaryResult } from '@/types.js';
import { VERSION } from '@/version.js';

export const version: string = VERSION;

export { InProcessCoordinator } from '@/coalesce/in-process-coordinator.js';
export { MemorySummaryCache } from '@/coalesce/memory-cache.js';
export type { MemorySummaryCacheOptions } from '@/coalesce/memory-cache.js';
export { StatusError } from '@/http/status-error.js';
export { default } from '@/fastify-plugin.js';
export type { FastifyLike } from '@/fastify-plugin.js';

export type {
	GeneralScrapingOptions,
	Player,
	ProxyOptions,
	Summary,
	SummarizeOptions,
	SummaryPlugin,
	SummaryResult,
	SummalyOptions,
	SummalyPlugin,
	SummalyResult,
} from '@/types.js';
export type {
	CacheEntry,
	InflightCoordinator,
	SerializedError,
	SummaryCache,
} from '@/coalesce/types.js';

/**
 * Defaults merged under the options of every call.
 */
export const defaultSummarizeOptions: SummarizeOptions = {
	lang: null,
	followRedirects: true,
	plugins: [],
};

/**
 * Alias of `defaultSummarizeOptions`, kept for summaly compatibility.
 */
export const summalyDefaultOptions: SummarizeOptions = defaultSummarizeOptions;

const DEFAULT_CACHE_TTL = 5 * 60 * 1000;
const DEFAULT_ERROR_CACHE_TTL = 30 * 1000;

/**
 * Creates a summarize function with its own result cache and in-flight sharing.
 * Options given per call are merged over `base`. `cache: false` / `coordinator: false` (in either) turns that part off.
 */
export function createSummarizer(base: SummarizeOptions = {}): (url: string, options?: SummarizeOptions) => Promise<SummaryResult> {
	const memoryCache = new MemorySummaryCache();
	const inProcessCoordinator = new InProcessCoordinator();

	return (url, options = {}) => {
		// Fixed when the call starts: the summary key, the transport and the favicon check keys are all built from
		// these, whatever the caller or the environment changes while the call runs.
		const opts = fixOptions({
			...defaultSummarizeOptions,
			...base,
			...options,
		});
		const allowPrivateIp = privateIpAllowedByEnv();
		const cache = options.cache ?? base.cache ?? memoryCache;
		const coordinator = options.coordinator ?? base.coordinator ?? inProcessCoordinator;
		const deps: CoalesceDeps = {
			cache: cache === false ? null : cache,
			coordinator: coordinator === false ? null : coordinator,
			cacheTtl: options.cacheTtl ?? base.cacheTtl ?? DEFAULT_CACHE_TTL,
			errorCacheTtl: options.errorCacheTtl ?? base.errorCacheTtl ?? DEFAULT_ERROR_CACHE_TTL,
		};
		return runCoalesced(
			deps,
			() => buildRequestKey(url, opts, allowPrivateIp),
			() => summarizeUncached(url, opts, deps, allowPrivateIp),
		);
	};
}

/**
 * Alias of `createSummarizer`, kept for summaly compatibility.
 */
export const createSummaly: (base?: SummarizeOptions) => (url: string, options?: SummarizeOptions) => Promise<SummaryResult> = createSummarizer;

/**
 * Summarize an web page
 */
export const summarize: (url: string, options?: SummarizeOptions) => Promise<SummaryResult> = createSummarizer();

/**
 * Alias of `summarize`, kept for summaly compatibility.
 */
export const summaly: (url: string, options?: SummarizeOptions) => Promise<SummaryResult> = summarize;

/**
 * The whole summary without caching or sharing it: final URL, provider match, scraping.
 * `deps` is handed on for the favicon checks, whose results are cached and shared across summaries.
 * `allowPrivateIp` is the value the summary key was built with, so the transport uses it too.
 */
async function summarizeUncached(
	url: string,
	opts: SummarizeOptions,
	deps: CoalesceDeps,
	allowPrivateIp: boolean,
): Promise<SummaryResult> {
	const ctx = createScrapeContext(opts, deps, allowPrivateIp);
	// The requests of this call share the transport's connections; none of them outlive the call.
	try {
		const actualUrl = opts.followRedirects ? await resolveFinalUrl(ctx, url) : url;
		const target = new URL(actualUrl);

		const providers = [...builtinProviders, ...(opts.plugins ?? []).map(fromPlugin)];
		const match = providers.find(provider => provider.test(target));

		const summary = match ? await match.summarize(ctx, target) : await scrapeGeneral(ctx, target);
		if (summary == null) {
			throw new Error('failed summarize');
		}

		return Object.assign(summary, {
			url: actualUrl,
		});
	} finally {
		ctx.transport.close();
	}
}

/**
 * Follows redirects with HEAD to find the page's final URL. Falls back to `url` on any failure, as upstream does.
 * Goes through the context's transport, so every hop is checked against the private IP guard.
 */
async function resolveFinalUrl(ctx: ScrapeContext, url: string): Promise<string> {
	try {
		const res = await fetchWithContext(ctx, {
			url,
			method: 'HEAD',
			headers: {
				'accept': 'text/html,application/xhtml+xml',
				'accept-language': ctx.options.lang ?? undefined,
			},
			followRedirects: true,
			// Like upstream's plain got.head(): no size or content-length checks (a HEAD has no body).
			contentLengthLimit: Number.POSITIVE_INFINITY,
			contentLengthRequired: false,
		});
		return res.url;
	} catch {
		return url;
	}
}
