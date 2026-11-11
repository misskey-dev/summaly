import type { ScrapeContext } from '@/context.js';
import type { GeneralScrapingOptions, Summary, SummalyPlugin } from '@/types.js';

/** Site-specific summarizer. Gets the per-call context so its requests go through the same transport and settings. */
export type Provider = {
	name: string;
	test(url: URL): boolean;
	summarize(ctx: ScrapeContext, url: URL): Promise<Summary | null>;
};

/**
 * Wraps a caller-supplied `SummalyPlugin`. The plugin gets the same `GeneralScrapingOptions` keys upstream passes,
 * filled from the context's effective settings.
 */
export function fromPlugin(plugin: SummalyPlugin): Provider {
	return {
		name: 'plugin',
		test: url => plugin.test(url),
		summarize: (ctx, url) => plugin.summarize(url, toScrapingOptions(ctx)),
	};
}

function toScrapingOptions(ctx: ScrapeContext): GeneralScrapingOptions {
	const { options } = ctx;
	return {
		lang: options.lang,
		userAgent: options.userAgent,
		responseTimeout: options.responseTimeout,
		followRedirects: options.followRedirects,
		operationTimeout: options.operationTimeout,
		contentLengthLimit: options.contentLengthLimit,
		contentLengthRequired: options.contentLengthRequired,
	};
}
