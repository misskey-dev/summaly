import { scpaping } from '@/utils/got.js';
import summary from '@/summary.js';

export function test(url: URL): boolean {
	return url.hostname === 'www.amazon.com' ||
	url.hostname === 'www.amazon.co.jp' ||
	url.hostname === 'www.amazon.ca' ||
	url.hostname === 'www.amazon.com.br' ||
	url.hostname === 'www.amazon.com.mx' ||
	url.hostname === 'www.amazon.co.uk' ||
	url.hostname === 'www.amazon.de' ||
	url.hostname === 'www.amazon.fr' ||
	url.hostname === 'www.amazon.it' ||
	url.hostname === 'www.amazon.es' ||
	url.hostname === 'www.amazon.nl' ||
	url.hostname === 'www.amazon.cn' ||
	url.hostname === 'www.amazon.in' ||
	url.hostname === 'www.amazon.au';
}

export async function summarize(url: URL): Promise<summary> {
	const res = await scpaping(url.href);
	const $ = res.$;

	const title = $('#title').text();

	const description =
		$('#productDescription').text() ||
		$('meta[name="description"]').attr('content');

	const thumbnail: string | undefined = $('#landingImage').attr('src');

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
}
