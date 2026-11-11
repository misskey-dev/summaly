// Derived from misskey-dev/summaly (MIT)
import { InProcessCoordinator } from '@/coalesce/in-process-coordinator.js';
import { buildRequestKey } from '@/coalesce/key.js';
import { MemorySummaryCache } from '@/coalesce/memory-cache.js';
import { runCoalesced } from '@/coalesce/run.js';
import { type ScrapeContext, createScrapeContext, fetchWithContext } from '@/context.js';
import { scrapeGeneral } from '@/extract/general.js';
import { builtinProviders } from '@/providers/index.js';
import { fromPlugin } from '@/providers/provider.js';
import type { SummalyOptions, SummalyResult } from '@/types.js';
import { VERSION } from '@/version.js';

export const version: string = VERSION;

export { InProcessCoordinator } from '@/coalesce/in-process-coordinator.js';
export { MemorySummaryCache } from '@/coalesce/memory-cache.js';
export { StatusError } from '@/http/status-error.js';

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

export const summalyDefaultOptions: SummalyOptions = {
	lang: null,
	followRedirects: true,
	plugins: [],
};

const DEFAULT_CACHE_TTL = 5 * 60 * 1000;
const DEFAULT_ERROR_CACHE_TTL = 30 * 1000;

/**
 * Creates a summaly function with its own result cache and in-flight sharing.
 * Options given per call are merged over `base`. `cache: false` / `coordinator: false` (in either) turns that part off.
 */
export function createSummaly(base: SummalyOptions = {}): (url: string, options?: SummalyOptions) => Promise<SummalyResult> {
	const memoryCache = new MemorySummaryCache();
	const inProcessCoordinator = new InProcessCoordinator();

	return (url, options = {}) => {
		const opts: SummalyOptions = {
			...summalyDefaultOptions,
			...base,
			...options,
		};
		const cache = options.cache ?? base.cache ?? memoryCache;
		const coordinator = options.coordinator ?? base.coordinator ?? inProcessCoordinator;
		const deps = {
			cache: cache === false ? null : cache,
			coordinator: coordinator === false ? null : coordinator,
			cacheTtl: options.cacheTtl ?? base.cacheTtl ?? DEFAULT_CACHE_TTL,
			errorCacheTtl: options.errorCacheTtl ?? base.errorCacheTtl ?? DEFAULT_ERROR_CACHE_TTL,
		};
		return runCoalesced(deps, buildRequestKey(url, opts), () => summarizeUncached(url, opts));
	};
}

/**
 * Summarize an web page
 */
export const summaly: (url: string, options?: SummalyOptions) => Promise<SummalyResult> = createSummaly();

/**
 * The whole summary without caching or sharing: final URL, provider match, scraping.
 */
async function summarizeUncached(url: string, opts: SummalyOptions): Promise<SummalyResult> {
	const ctx = createScrapeContext(opts);

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
