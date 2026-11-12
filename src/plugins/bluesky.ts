import { defineBuiltinPlugin } from '@/plugin/define.js';

export const bluesky = defineBuiltinPlugin({
	name: 'summaly:bluesky',

	test: url => url.hostname === 'bsky.app',

	async summarize({ url, fetchPage, summarizePage }) {
		// Fetched with GET only: bsky.app answers HEAD with 404.
		return await summarizePage(await fetchPage(url));
	},
});
