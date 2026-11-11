// Derived from misskey-dev/summaly (MIT)
import { type ScrapeContext, fetchSubresource } from '@/context.js';

/** Resolves `href` against the page and returns it if a HEAD request succeeds, else null. */
export async function resolveIcon(ctx: ScrapeContext, href: string, pageUrl: URL): Promise<string | null> {
	let target: URL;
	try {
		target = new URL(href, pageUrl);
	} catch {
		return null;
	}

	try {
		await fetchSubresource(ctx, target.href, 'HEAD');
		return target.href;
	} catch {
		return null;
	}
}
