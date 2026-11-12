import type { CheerioAPI } from 'cheerio';

/**
 * A full DOM of `html`, for the Amazon plugin only, which reads the page body. Everything else uses parseHead.
 * cheerio is loaded on the first call, so a process that never summarizes an Amazon page never loads it.
 */
export async function loadDom(html: string): Promise<CheerioAPI> {
	const { load } = await import('cheerio');

	return load(html);
}
