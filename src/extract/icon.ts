// Derived from misskey-dev/summaly (MIT)
import { runCoalescedIcon } from '@/coalesce/run.js';
import { type ScrapeContext, fetchSubresource } from '@/context.js';

/**
 * Resolves `href` against the page and returns it if a HEAD request succeeds, else null.
 * The outcome is cached and shared through the context's cache and coordinator, keyed by the resolved URL
 * and the options that can change the HEAD, so pages of one site do not send the same HEAD again.
 */
export async function resolveIcon(ctx: ScrapeContext, href: string, pageUrl: URL): Promise<string | null> {
	let target: string;
	try {
		target = new URL(href, pageUrl).href;
	} catch {
		return null;
	}

	try {
		return await runCoalescedIcon(ctx.coalesce, () => ctx.iconKey(target), () => checkIcon(ctx, target));
	} catch {
		// Only a failing cache or coordinator gets here (checkIcon never throws). The icon must not depend on
		// their health, so check without them.
		return await checkIcon(ctx, target);
	}
}

/** `url` if a HEAD request for it succeeds, else null. */
async function checkIcon(ctx: ScrapeContext, url: string): Promise<string | null> {
	try {
		await fetchSubresource(ctx, url, 'HEAD');
		return url;
	} catch {
		return null;
	}
}
