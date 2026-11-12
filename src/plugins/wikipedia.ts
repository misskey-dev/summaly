import { clip } from '@/extract/text.js';
import { defineBuiltinPlugin } from '@/plugin/define.js';

type QueryResponse = {
	query?: { pages?: Record<string, { title: string; extract: string }> };
};

export const wikipedia = defineBuiltinPlugin({
	name: 'summaly:wikipedia',

	test(url) {
		if (!url.hostname) {
			return false;
		}

		return url.hostname.endsWith('.wikipedia.org');
	},

	async summarize({ url, fetch }) {
		const lang = url.host ? url.host.split('.')[0] : null;
		const title = url.pathname ? url.pathname.split('/')[2] : null;
		const endpoint = `https://${lang}.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&exintro=&explaintext=&titles=${title}`;

		const body = (await fetch(endpoint)).json() as QueryResponse;

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
});
