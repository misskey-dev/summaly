import * as cheerio from 'cheerio';

/** Amazon プロバイダ専用。それ以外は parseHead を使う。 */
export function loadDom(html: string): cheerio.CheerioAPI {
	return cheerio.load(html);
}
