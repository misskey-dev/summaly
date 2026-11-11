// Derived from misskey-dev/summaly (MIT)
import { fetchSubresource } from '@/context.js';
import { clip } from '@/extract/text.js';
import type { Provider } from './provider.js';

type QueryResponse = {
	query?: { pages?: Record<string, { title: string; extract: string }> };
};

export const wikipedia: Provider = {
	name: 'wikipedia',

	test(url) {
		if (!url.hostname) {
			return false;
		}
		return url.hostname.endsWith('.wikipedia.org');
	},

	async summarize(ctx, url) {
		const lang = url.host ? url.host.split('.')[0] : null;
		const title = url.pathname ? url.pathname.split('/')[2] : null;
		const endpoint = `https://${lang}.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&exintro=&explaintext=&titles=${title}`;

		const res = await fetchSubresource(ctx, endpoint, 'GET');
		const body = JSON.parse(res.body.toString('utf-8')) as QueryResponse;

		const pages = body.query?.pages;
		if (!pages) {
			throw new Error('fetch failed');
		}

		const info = pages[Object.keys(pages)[0]];

		return {
			title: info.title,
			icon: 'https://wikipedia.org/static/favicon/wikipedia.ico',
			description: clip(info.extract, 300),
			thumbnail: `https://wikipedia.org/static/images/project-logos/${lang}wiki.png`,
			thumbnailStyle: 'summary',
			player: {
				url: null,
				width: null,
				height: null,
				allow: [],
			},
			sitename: 'Wikipedia',
			activityPub: null,
			fediverseCreator: null,
		};
	},
};
