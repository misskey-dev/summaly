import { scrapeGeneral } from '@/extract/general.js';
import type { Provider } from './provider.js';

export const branchioDeeplinks: Provider = {
	name: 'branchio-deeplinks',

	// Deep links made with Branch.io
	test: url => /^[a-zA-Z0-9]+\.app\.link$/.test(url.hostname) || url.hostname === 'spotify.link',

	async summarize(ctx, url) {
		// https://help.branch.io/using-branch/docs/creating-a-deep-link#redirections
		// Forcing the web redirect keeps branch.io from serving its own interstitial page.
		const target = new URL(url);

		target.searchParams.append('$web_only', 'true');

		return await scrapeGeneral(ctx, target);
	},
};
