import { InProcessCoordinator } from '@/coalesce/in-process-coordinator.js';
import { buildRequestKey } from '@/coalesce/key.js';
import { MemorySummaryCache } from '@/coalesce/memory-cache.js';
import { type CoalesceDeps, runCoalesced } from '@/coalesce/run.js';
import { type ScrapeContext, createScrapeContext, fetchWithContext, fixOptions } from '@/context.js';
import { scrapeGeneral } from '@/extract/general.js';
import { privateIpAllowedByEnv } from '@/http/address-guard.js';
import { GuardedAgentPool } from '@/http/agent-pool.js';
import { builtinProviders } from '@/providers/index.js';
import { fromPlugin } from '@/providers/provider.js';
import type { SummalyOptions, SummalyResult } from '@/types.js';
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
export const summalyDefaultOptions: SummalyOptions = {
	lang: null,
	followRedirects: true,
	plugins: [],
};

const DEFAULT_CACHE_TTL = 5 * 60 * 1000;
const DEFAULT_ERROR_CACHE_TTL = 30 * 1000;

/**
 * Creates a summaly function with its own result cache, in-flight sharing and connection pool.
 * Options given per call are merged over `base`. `cache: false` / `coordinator: false` (in either) turns that part off.
 * Its calls with the same `allowedPrivateNetworks` reuse each other's idle connections for a short time
 * (see GuardedAgentPool); separate summarizers never share connections.
 */
export function createSummaly(base: SummalyOptions = {}): (url: string, options?: SummalyOptions) => Promise<SummalyResult> {
	const memoryCache = new MemorySummaryCache();
	const inProcessCoordinator = new InProcessCoordinator();
	const agentPool = new GuardedAgentPool();

	return (url, options = {}) => {
		// Fixed when the call starts: the summary key, the transport and the favicon check keys are all built from
		// these, whatever the caller or the environment changes while the call runs.
		const opts = fixOptions({
			...summalyDefaultOptions,
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
			() => summarizeUncached(url, opts, deps, allowPrivateIp, agentPool),
		);
	};
}

/**
 * Summarize an web page
 */
export const summaly: (url: string, options?: SummalyOptions) => Promise<SummalyResult> = createSummaly();

/**
 * The whole summary without caching or sharing it: final URL, provider match, scraping.
 * `deps` is handed on for the favicon checks, whose results are cached and shared across summaries.
 * `allowPrivateIp` is the value the summary key was built with, so the transport uses it too.
 * `agentPool` is the summarizer's connection pool.
 */
async function summarizeUncached(
	url: string,
	opts: SummalyOptions,
	deps: CoalesceDeps,
	allowPrivateIp: boolean,
	agentPool: GuardedAgentPool,
): Promise<SummalyResult> {
	const ctx = createScrapeContext(opts, deps, allowPrivateIp, agentPool);

	// The requests of this call share the transport's connections. Guarded connections that completed their responses
	// stay idle in the summarizer's pool for later calls; proxy connections end with the call (see Transport#close).
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
 * Follows redirects with HEAD to find the page's final URL. Falls back to `url` on any failure.
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
			// No size or content-length checks: a HEAD has no body.
			contentLengthLimit: Number.POSITIVE_INFINITY,
			contentLengthRequired: false,
		});

		return res.url;
	} catch {
		return url;
	}
}
