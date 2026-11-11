// Derived from misskey-dev/summaly (MIT)
import { fetchPage } from '@/extract/general.js';
import { loadDom } from '@/html/dom.js';
import type { Provider } from './provider.js';

// Empty strings (absent elements, empty attributes) must fall through to the next source, as upstream does.
/* oxlint-disable typescript/prefer-nullish-coalescing */

const HOSTNAMES = new Set([
	'www.amazon.com',
	'www.amazon.co.jp',
	'www.amazon.ca',
	'www.amazon.com.br',
	'www.amazon.com.mx',
	'www.amazon.co.uk',
	'www.amazon.de',
	'www.amazon.fr',
	'www.amazon.it',
	'www.amazon.es',
	'www.amazon.nl',
	'www.amazon.cn',
	'www.amazon.in',
	'www.amazon.au',
]);

/** Reads the product body (`#title`, `#landingImage`, `#productDescription`), so it needs the full DOM. */
export const amazon: Provider = {
	name: 'amazon',

	test: url => HOSTNAMES.has(url.hostname),

	async summarize(ctx, url) {
		const page = await fetchPage(ctx, url);
		const $ = loadDom(page.html);

		const title = $('#title').text();

		const description =
			$('#productDescription').text() ||
			$('meta[name="description"]').attr('content');

		const thumbnail: string | undefined = $('#landingImage').attr('src');

		const twitterCard =
			$('meta[name="twitter:card"]').attr('content') ||
			$('meta[property="twitter:card"]').attr('content');

		const thumbnailStyle =
			twitterCard === 'summary_large_image' ? 'summary_large_image' :
			twitterCard === 'summary' ? 'summary' :
			null;

		const playerUrl =
			$('meta[property="twitter:player"]').attr('content') ||
			$('meta[name="twitter:player"]').attr('content');

		const playerWidth =
			$('meta[property="twitter:player:width"]').attr('content') ||
			$('meta[name="twitter:player:width"]').attr('content');

		const playerHeight =
			$('meta[property="twitter:player:height"]').attr('content') ||
			$('meta[name="twitter:player:height"]').attr('content');

		return {
			title: title ? title.trim() : null,
			icon: 'https://www.amazon.com/favicon.ico',
			description: description ? description.trim() : null,
			thumbnail: thumbnail ? thumbnail.trim() : null,
			thumbnailStyle,
			player: {
				url: playerUrl || null,
				width: playerWidth ? parseInt(playerWidth) : null,
				height: playerHeight ? parseInt(playerHeight) : null,
				allow: playerUrl ? ['fullscreen', 'encrypted-media'] : [],
			},
			sitename: 'Amazon',
			activityPub: null,
			fediverseCreator: null,
		};
	},
};
