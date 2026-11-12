import * as cheerio from 'cheerio';

/** For the Amazon plugin only, which reads the page body. Everything else uses parseHead. */
export function loadDom(html: string): cheerio.CheerioAPI {
	return cheerio.load(html);
}
