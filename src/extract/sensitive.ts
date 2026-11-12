import type http from 'node:http';
import type { HeadInfo } from '@/html/head.js';
import { metaContent } from './fields.js';

const RTA_LABEL = 'RTA-5042-1996-1400-1577-RTA';

function headerEquals(search: string, headerValue: string | string[] | undefined): boolean {
	if (!headerValue) {
		return false;
	}
	const values = Array.isArray(headerValue) ? headerValue : [headerValue];

	return values.some(value => value.toLowerCase() === search.toLowerCase());
}

/** Adult content marks: mixi:content-rating, the `rating` header, or a `rating` meta. */
export function isSensitive(head: HeadInfo, headers: http.IncomingHttpHeaders): boolean {
	const rating = metaContent(head, 'name:rating');

	// https://developer.mixi.co.jp/connect/mixi_plugin/mixi_check/spec_mixi_check/#toc-18-
	return metaContent(head, 'property:mixi:content-rating') === '1' ||
		headerEquals('adult', headers.rating) ||
		headerEquals(RTA_LABEL, headers.rating) ||
		rating === 'adult' ||
		rating?.toUpperCase() === RTA_LABEL;
}
