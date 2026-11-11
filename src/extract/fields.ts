// Derived from misskey-dev/summaly (MIT)
import { decode } from 'html-entities';
import type { HeadInfo } from '@/html/head.js';
import type { Player, Summary } from '@/types.js';
import { clip } from './text.js';

// Each pick* function mirrors one field of upstream parseGeneral() (src/general.ts), keeping its fallback order.
// parseHead() returns raw values, so values are first decoded the way cheerio's `.attr()` / `.text()` did.
// Title, description and site name then get upstream's extra decode() on top, as upstream did.
//
// Twitter cards officially use the name attribute, but upstream also accepts property for compatibility.
// See https://developer.twitter.com/en/docs/twitter-for-websites/cards/overview/summary and https://ogp.me/

type MetaKey = Parameters<HeadInfo['meta']>[0];

/**
 * First non-empty `content` among `keys`, decoded like an attribute value. Same as chaining cheerio `.attr('content') ||`.
 * Never returns '', so callers chain fallbacks with `??` and keep upstream's `||` behavior.
 */
export function metaContent(head: HeadInfo, ...keys: MetaKey[]): string | undefined {
	for (const key of keys) {
		const value = head.meta(key);
		if (value) {
			return decode(value, { scope: 'attribute' });
		}
	}
	return undefined;
}

/**
 * Non-empty `href` of the first link matching `rel` and/or `type`, decoded like an attribute value.
 * Values are compared case-insensitively, as cheerio's `link[rel="..."]` selectors do for these attributes in HTML.
 */
export function linkHref(head: HeadInfo, match: { rel?: string; type?: string }): string | undefined {
	const link = head.links.find(l =>
		(match.rel === undefined || l.rel?.toLowerCase() === match.rel) &&
		(match.type === undefined || l.type?.toLowerCase() === match.type));
	return link?.href ? decode(link.href, { scope: 'attribute' }) : undefined;
}

function twitterCard(head: HeadInfo): string | undefined {
	return metaContent(head, 'name:twitter:card', 'property:twitter:card');
}

function resolveUrl(href: string, base: URL): string | null {
	try {
		return new URL(href, base).href;
	} catch {
		return null;
	}
}

/** Never null: like upstream's `$('title').text()`, a page without any title yields ''. */
export function pickTitle(head: HeadInfo): string {
	const title =
		metaContent(head, 'property:og:title', 'name:twitter:title', 'property:twitter:title') ??
		decode(head.title ?? '');
	return clip(decode(title), 100);
}

export function pickDescription(head: HeadInfo): string | null {
	const description = metaContent(head,
		'property:og:description',
		'name:twitter:description',
		'property:twitter:description',
		'name:description');
	return description ? clip(decode(description), 300) : null;
}

/** Absolute URL of the thumbnail, or null (also when it cannot be resolved against `base`). */
export function pickImage(head: HeadInfo, base: URL): string | null {
	const image =
		metaContent(head, 'property:og:image', 'name:twitter:image', 'property:twitter:image') ??
		linkHref(head, { rel: 'image_src' }) ??
		linkHref(head, { rel: 'apple-touch-icon' }) ??
		linkHref(head, { rel: 'apple-touch-icon image_src' });
	return image ? resolveUrl(image, base) : null;
}

export function pickThumbnailStyle(head: HeadInfo): Summary['thumbnailStyle'] {
	const card = twitterCard(head);
	return card === 'summary_large_image' ? 'summary_large_image' :
		card === 'summary' ? 'summary' :
		null;
}

/** Player from twitter:player / og:video metas. Used when there is no valid oEmbed player. */
export function pickMetaPlayer(head: HeadInfo): Player {
	// A summary_large_image card's twitter:player may point at the image itself (e.g. Pleroma), so it is skipped.
	const twitterPlayer = twitterCard(head) !== 'summary_large_image'
		? metaContent(head, 'name:twitter:player', 'property:twitter:player')
		: undefined;
	const url = twitterPlayer ??
		metaContent(head, 'property:og:video', 'property:og:video:secure_url', 'property:og:video:url');

	const width = parseInt(
		metaContent(head, 'name:twitter:player:width', 'property:twitter:player:width', 'property:og:video:width') ??
		'');
	const height = parseInt(
		metaContent(head, 'name:twitter:player:height', 'property:twitter:player:height', 'property:og:video:height') ??
		'');

	return {
		url: url ?? null,
		width: Number.isNaN(width) ? null : width,
		height: Number.isNaN(height) ? null : height,
		allow: ['autoplay', 'encrypted-media', 'fullscreen'],
	};
}

export function pickSiteName(head: HeadInfo, url: URL): string {
	return decode(metaContent(head, 'property:og:site_name', 'name:application-name') ?? url.host);
}

/** Favicon reference as written in the page (possibly relative). Falls back to `/favicon.ico`. */
export function pickFaviconHref(head: HeadInfo): string {
	return linkHref(head, { rel: 'shortcut icon' }) ??
		linkHref(head, { rel: 'icon' }) ??
		'/favicon.ico';
}

export function pickActivityPub(head: HeadInfo): string | null {
	return linkHref(head, { rel: 'alternate', type: 'application/activity+json' }) ?? null;
}

export function pickFediverseCreator(head: HeadInfo): string | null {
	return metaContent(head, 'name:fediverse:creator') ?? null;
}
