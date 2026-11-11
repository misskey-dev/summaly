// Derived from misskey-dev/summaly (MIT)
import { DomUtils, parseDocument } from 'htmlparser2';
import { type ScrapeContext, fetchSubresource } from '@/context.js';
import type { HeadInfo } from '@/html/head.js';
import type { Player } from '@/types.js';
import { linkHref } from './fields.js';

const MAX_HEIGHT = 1024;

// TODO (from upstream): only the basic syntax of `allow` is supported.
const SAFE_PERMISSIONS = [
	'autoplay',
	'clipboard-write',
	'fullscreen',
	'encrypted-media',
	'picture-in-picture',
	'web-share',
];
// YouTube has these but they are almost never used.
const IGNORED_PERMISSIONS = [
	'gyroscope',
	'accelerometer',
];

type OEmbed = {
	version?: unknown;
	type?: unknown;
	html?: unknown;
	width?: unknown;
	height?: unknown;
};

/**
 * Player from the page's oEmbed endpoint, or null when there is none or it is not a safe iframe.
 * Only a sanitized iframe is taken, since the thumbnail is mostly covered by OpenGraph.
 */
export async function fetchOEmbedPlayer(ctx: ScrapeContext, head: HeadInfo, pageUrl: URL): Promise<Player | null> {
	const href = linkHref(head, { type: 'application/json+oembed' });

	if (!href) {
		return null;
	}

	let oEmbedUrl: URL;

	try {
		oEmbedUrl = new URL(href, pageUrl);
	} catch {
		return null;
	}

	const body = await fetchSubresource(ctx, oEmbedUrl.href, 'GET').then(
		res => parseJson(res.body.toString('utf-8')),
		() => null,
	);

	return body ? toPlayer(body) : null;
}

function parseJson(text: string): OEmbed | null {
	try {
		const value: unknown = JSON.parse(text);

		return typeof value === 'object' && value !== null ? value as OEmbed : null;
	} catch {
		return null;
	}
}

function toPlayer(body: OEmbed): Player | null {
	if (body.version !== '1.0' || (body.type !== 'rich' && body.type !== 'video')) {
		// Not a well formed rich oEmbed
		return null;
	}

	if (typeof body.html !== 'string' || !body.html.startsWith('<iframe ') || !body.html.endsWith('</iframe>')) {
		// It includes something else than an iframe
		return null;
	}

	const document = parseDocument(body.html);
	const iframes = DomUtils.getElementsByTagName('iframe', document);

	if (iframes.length !== 1) {
		// Somehow we either have multiple iframes or none
		return null;
	}

	const iframe = iframes[0];

	if (iframe.parent !== document) {
		// Should be at the top level (upstream: only the body and html elements as the parents)
		return null;
	}

	const attrs = iframe.attribs;
	const url = attrs['src'];

	if (!url) {
		// No src?
		return null;
	}

	try {
		if (new URL(url).protocol !== 'https:') {
			// Allow only HTTPS for best security
			return null;
		}
	} catch {
		return null;
	}

	// Height is the most important, width is okay to be null. The implementer
	// should choose fixed height instead of fixed aspect ratio if width is null.
	//
	// For example, Spotify's embed page does not strictly follow aspect ratio
	// and thus keeping the height is better than keeping the aspect ratio.
	//
	// Spotify gives `width: 100%, height: 152px` for iframe while `width: 456,
	// height: 152` for oEmbed data, and we treat any percentages as null here.
	let width: number | null = Number(attrs['width'] ?? body.width);

	if (Number.isNaN(width)) {
		width = null;
	}
	const height = Math.min(Number(attrs['height'] ?? body.height), MAX_HEIGHT);

	if (Number.isNaN(height)) {
		// No proper height info
		return null;
	}

	const allowedPermissions = (attrs['allow'] ?? '').split(/\s*;\s*/g)
		.filter(s => s)
		.filter(s => !IGNORED_PERMISSIONS.includes(s));

	if (attrs['allowfullscreen'] === '') {
		allowedPermissions.push('fullscreen');
	}
	if (allowedPermissions.some(allow => !SAFE_PERMISSIONS.includes(allow))) {
		// This iframe is probably too powerful to be embedded
		return null;
	}

	return {
		url,
		width,
		height,
		allow: allowedPermissions,
	};
}
