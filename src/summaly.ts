import { buildRequestKey } from '@/cache/key.js';
import { type CoalesceDeps, runCoalesced } from '@/cache/run.js';
import { type ScrapeContext, createScrapeContext, fetchWithContext, fixOptions } from '@/context.js';
import { scrapeGeneral } from '@/extract/general.js';
import { privateIpAllowedByEnv } from '@/http/address-guard.js';
import { GuardedAgentPool } from '@/http/agent-pool.js';
import { completeSummary, createPluginContext } from '@/plugin/context.js';
import { assertPlugins } from '@/plugin/define.js';
import { builtinPluginNames, builtinPlugins } from '@/builtin-plugins/list.js';
import type { Summary, SummalyOptions, SummalyResult } from '@/types.js';

/**
 * A summaly function with its own connection pool (see createSummaly).
 */
export type SummalyInstance = {
	(url: string, options?: SummalyOptions): Promise<SummalyResult>;
	/**
	 * Refuses new calls, waits for the calls in progress to settle, then destroys the instance's connections.
	 * The `cache` and `coordinator` it was given are left alone. Calling it again returns the same promise.
	 */
	close(): Promise<void>;
	/** Same as `close()`, for `await using`. */
	[Symbol.asyncDispose](): Promise<void>;
};

/** Merged under the options of every call. Not exported: changing it would change every later call. */
const DEFAULT_OPTIONS: Readonly<SummalyOptions> = Object.freeze({
	lang: null,
	followRedirects: true,
});

/**
 * Creates a summaly function with its own connection pool. Options given per call are merged over `base`.
 * Calls of one instance with the same `allowedPrivateNetworks` reuse each other's idle connections for a short time
 * (see GuardedAgentPool); separate instances never share connections. `close()` destroys them.
 *
 * Results are cached and in-flight calls shared only through a `cache` / `coordinator` given in `base` or per call
 * (`false` per call turns off the one in `base`).
 * @throws {TypeError} when `base.plugins` holds something not made by defineSummalyPlugin, or two plugins with one name
 */
export function createSummaly(base: SummalyOptions = {}): SummalyInstance {
	assertPlugins(base.plugins, builtinPluginNames);
	const agentPool = new GuardedAgentPool();
	const inFlight = new Set<Promise<unknown>>();
	let closing: Promise<void> | undefined;

	const summarize = (url: string, options: SummalyOptions = {}): Promise<SummalyResult> => {
		if (closing !== undefined) {
			return Promise.reject(new Error('This summaly instance is closed'));
		}
		// Fixed when the call starts: the summary key, the transport and the favicon check keys are all built from
		// these, whatever the caller or the environment changes while the call runs.
		const opts = fixOptions({
			...DEFAULT_OPTIONS,
			...base,
			...options,
		});

		try {
			assertPlugins(opts.plugins, builtinPluginNames);
		} catch (error) {
			return Promise.reject(error);
		}
		const allowPrivateIp = privateIpAllowedByEnv();
		const cache = options.cache ?? base.cache;
		const coordinator = options.coordinator ?? base.coordinator;
		const deps: CoalesceDeps = {
			cache: cache === undefined || cache === false ? null : cache,
			coordinator: coordinator === undefined || coordinator === false ? null : coordinator,
		};

		const promise = runCoalesced(
			deps,
			() => buildRequestKey(url, opts, allowPrivateIp),
			() => summarizeUncached(url, opts, deps, allowPrivateIp, agentPool),
		);
		const forget = () => {
			inFlight.delete(promise);
		};

		inFlight.add(promise);
		promise.then(forget, forget);

		return promise;
	};

	const close = (): Promise<void> => {
		closing ??= (async () => {
			await Promise.allSettled(inFlight);
			agentPool.destroy();
		})();

		return closing;
	};

	return Object.assign(summarize, { close, [Symbol.asyncDispose]: close });
}

let defaultInstance: SummalyInstance | undefined;

/**
 * Summarize an web page. Uses an instance of createSummaly made on the first call.
 */
export const summaly = (url: string, options?: SummalyOptions): Promise<SummalyResult> => {
	defaultInstance ??= createSummaly();

	return defaultInstance(url, options);
};

/**
 * The whole summary without caching or sharing it: final URL, plugin match, scraping.
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
		const actualUrl = ctx.options.followRedirects ? await resolveFinalUrl(ctx, url) : url;
		const target = new URL(actualUrl);

		// The caller's plugins first, so that they can take over URLs a built-in plugin would summarize.
		const plugins = [...(opts.plugins ?? []), ...builtinPlugins];
		const match = plugins.find(plugin => plugin.test(target));
		const result = match ? await match.summarize(createPluginContext(ctx, target)) : null;
		// A plugin returning null hands the URL over to the generic rules.
		const summary: Summary = result != null ? completeSummary(result) : await scrapeGeneral(ctx, target);

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
