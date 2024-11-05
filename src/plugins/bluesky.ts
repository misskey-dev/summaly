import * as cheerio from 'cheerio';
import { get } from '../utils/got.js';
import type summary from '../summary.js';

export function test(url: URL): boolean {
	return url.hostname === 'bsky.app';
}

export async function summarize(url: URL): Promise<summary> {
	// HEADで取ると404が返るためGETのみで取得
	const body = await get(url.href);
	const $ = cheerio.load(body);

	const title = $('meta[property="og:title"]').attr('content');

	const description = $('meta[property="og:description"]').attr('content');

	const thumbnail = $('meta[property="og:image"]').attr('content');

	return {
		title: title ? title.trim() : null,
		icon: 'https://bsky.app/static/favicon-32x32.png',
		description: description ? description.trim() : null,
		thumbnail: thumbnail ? thumbnail.trim() : null,
		// oEmbedのhtmlがiframeではないのでsummalyで表示できない
		player: {
			url: null,
			width: null,
			height: null,
			allow: [],
		},
		sitename: 'Bluesky Social',
		activityPub: null,
	};
}
