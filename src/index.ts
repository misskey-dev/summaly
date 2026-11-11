// Derived from misskey-dev/summaly (MIT)
import { type ScrapeContext, createScrapeContext, fetchWithContext } from '@/context.js';
import { scrapeGeneral } from '@/extract/general.js';
import { builtinProviders } from '@/providers/index.js';
import { fromPlugin } from '@/providers/provider.js';
import type { SummalyOptions, SummalyResult } from '@/types.js';
import { VERSION } from '@/version.js';

export const version: string = VERSION;

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

/**
 * Summarize an web page
 */
export const summaly = async (url: string, options?: SummalyOptions): Promise<SummalyResult> => {
	const opts: SummalyOptions = {
		...summalyDefaultOptions,
		...options,
	};
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
};

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
