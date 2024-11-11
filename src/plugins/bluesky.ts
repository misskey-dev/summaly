import * as cheerio from 'cheerio';
import { getResponse } from '@/utils/got.js';
import { parseGeneral } from '@/general.js';
import type Summary from '@/summary.js';

export function test(url: URL): boolean {
	return url.hostname === 'bsky.app';
}

export async function summarize(url: URL): Promise<Summary | null> {
	// HEADで取ると404が返るためGETのみで取得
	const res = await getResponse({
		url: url.href,
		method: 'GET',
		headers: {
			'accept': '*/*',
		},
	});
	const body = res.body;
	const $ = cheerio.load(body);

	return await parseGeneral(url, {
		body,
		$,
		response: res,
	});
}
