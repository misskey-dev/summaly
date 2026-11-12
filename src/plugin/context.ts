import { type ScrapeContext, fetchWithContext } from '@/context.js';
import { fetchPage, scrapeGeneral, summarizePage } from '@/extract/general.js';
import type { FetchResult } from '@/http/request.js';
import type { Summary } from '@/types.js';
import type {
	SummalyPluginContext,
	SummalyPluginPage,
	SummalyPluginPageOptions,
	SummalyPluginResponse,
	SummalyPluginResult,
} from './define.js';

function toResponse(res: FetchResult): SummalyPluginResponse {
	const text = () => res.body.toString('utf-8');

	return {
		url: res.url,
		status: res.statusCode,
		headers: res.headers,
		body: res.body,
		text,
		json: () => JSON.parse(text()) as unknown,
	};
}

/** Header names lower-cased, so that a `User-Agent` given in any case cannot replace the summary's. */
function lowerCaseNames(headers: Record<string, string> | undefined): Record<string, string> {
	const result: Record<string, string> = {};

	for (const [name, value] of Object.entries(headers ?? {})) {
		result[name.toLowerCase()] = value;
	}

	return result;
}

/**
 * The context handed to a plugin's `summarize` for `url`. Every request goes through `ctx`, so the summary's
 * transport (private IP block, agents, proxy) and settings apply to it.
 */
export function createPluginContext(ctx: ScrapeContext, url: URL): SummalyPluginContext {
	const base = new URL(url.href);
	const resolve = (target: string | URL) => new URL(target, base);

	return {
		url: new URL(base.href),
		options: Object.freeze({ ...ctx.options }),

		async fetch(target, init = {}) {
			const res = await fetchWithContext(ctx, {
				url: resolve(target).href,
				method: init.method ?? 'GET',
				headers: { 'accept': '*/*', ...lowerCaseNames(init.headers), 'user-agent': ctx.options.userAgent },
				followRedirects: true,
				contentLengthRequired: false,
			});

			return toResponse(res);
		},

		async fetchPage(target, options: SummalyPluginPageOptions = {}): Promise<SummalyPluginPage> {
			const pageUrl = resolve(target);
			const page = await fetchPage({
				...ctx,
				options: {
					...ctx.options,
					followRedirects: options.followRedirects ?? ctx.options.followRedirects,
					contentLengthRequired: options.contentLengthRequired ?? ctx.options.contentLengthRequired,
				},
			}, pageUrl);

			return { url: pageUrl, finalUrl: page.url, html: page.html, headers: page.headers };
		},

		summarizePage: page => summarizePage(ctx, page.url, page),

		general: target => scrapeGeneral(ctx, target === undefined ? new URL(base.href) : resolve(target)),
	};
}

/** A plugin's result with the missing fields filled in. Fields the plugin added are kept as they are. */
export function completeSummary(result: Exclude<SummalyPluginResult, null>): Summary {
	return {
		...result,
		title: result.title ?? null,
		icon: result.icon ?? null,
		description: result.description ?? null,
		thumbnail: result.thumbnail ?? null,
		thumbnailStyle: result.thumbnailStyle ?? null,
		sitename: result.sitename ?? null,
		player: result.player ?? { url: null, width: null, height: null, allow: [] },
		sensitive: result.sensitive ?? false,
		activityPub: result.activityPub ?? null,
		fediverseCreator: result.fediverseCreator ?? null,
	};
}
