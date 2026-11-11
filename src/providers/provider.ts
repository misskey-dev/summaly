// Derived from misskey-dev/summaly (MIT)
import type { ScrapeContext } from '@/context.js';
import type { GeneralScrapingOptions, Summary, SummalyOptions, SummalyPlugin } from '@/types.js';

/** Site-specific summarizer. Gets the per-call context so its requests go through the same transport and settings. */
export type Provider = {
	name: string;
	test(url: URL): boolean;
	summarize(ctx: ScrapeContext, url: URL): Promise<Summary | null>;
};

/**
 * Wraps a caller-supplied `SummalyPlugin`. The plugin gets the same `GeneralScrapingOptions` upstream passes:
 * the caller's raw values, not the context's effective settings.
 */
export function fromPlugin(plugin: SummalyPlugin): Provider {
	return {
		name: 'plugin',
		test: url => plugin.test(url),
		summarize: (ctx, url) => plugin.summarize(url, ctx.scrapingOptions),
	};
}

/**
 * Picks the `GeneralScrapingOptions` keys from the merged options as upstream index.ts does.
 * Unset keys stay undefined and `lang` is passed as given.
 */
export function toScrapingOptions(opts: SummalyOptions): GeneralScrapingOptions {
	return {
		lang: opts.lang,
		userAgent: opts.userAgent,
		responseTimeout: opts.responseTimeout,
		followRedirects: opts.followRedirects,
		operationTimeout: opts.operationTimeout,
		contentLengthLimit: opts.contentLengthLimit,
		contentLengthRequired: opts.contentLengthRequired,
	};
}
