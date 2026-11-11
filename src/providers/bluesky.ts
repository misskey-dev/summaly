// Derived from misskey-dev/summaly (MIT)
import { fetchPage, summarizePage } from '@/extract/general.js';
import type { Provider } from './provider.js';

export const bluesky: Provider = {
	name: 'bluesky',

	test: url => url.hostname === 'bsky.app',

	async summarize(ctx, url) {
		// Fetched with GET only: bsky.app answers HEAD with 404.
		const page = await fetchPage(ctx, url);

		return await summarizePage(ctx, url, page);
	},
};
