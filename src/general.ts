import { URL } from 'node:url';
import { decode as decodeHtml } from 'html-entities';
import * as cheerio from 'cheerio';
import clip from './utils/clip.js';
import cleanupTitle from './utils/cleanup-title.js';

import { get, head, scpaping } from './utils/got.js';
import type { default as Summary, Player } from './summary.js';

/**
 * Contains only the html snippet for a sanitized iframe as the thumbnail is
 * mostly covered in OpenGraph instead.
 *
 * Width should always be 100%.
 */
async function getOEmbedPlayer($: cheerio.CheerioAPI, pageUrl: string): Promise<Player | null> {
	const href = $('link[type="application/json+oembed"]').attr('href');
	if (!href) {
		return null;
	}

	const oEmbedUrl = (() => {
		try {
			return new URL(href, pageUrl);
		} catch { return null; }
	})();
	if (!oEmbedUrl) {
		return null;
	}

	const oEmbed = await get(oEmbedUrl.href).catch(() => null);
	if (!oEmbed) {
		return null;
	}

	const body = (() => {
		try {
			return JSON.parse(oEmbed);
		} catch { /* empty */ }
	})();

	if (!body || body.version !== '1.0' || !['rich', 'video'].includes(body.type)) {
		// Not a well formed rich oEmbed
		return null;
	}

	if (!body.html.startsWith('<iframe ') || !body.html.endsWith('</iframe>')) {
		// It includes something else than an iframe
		return null;
	}

	const oEmbedHtml = cheerio.load(body.html);
	const iframe = oEmbedHtml('iframe');

	if (iframe.length !== 1) {
		// Somehow we either have multiple iframes or none
		return null;
	}

	if (iframe.parents().length !== 2) {
		// Should only have the body and html elements as the parents
		return null;
	}

	const url = iframe.attr('src');
	if (!url) {
		// No src?
		return null;
	}

	try {
		if ((new URL(url)).protocol !== 'https:') {
			// Allow only HTTPS for best security
			return null;
		}
	} catch (e) {
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
	let width: number | null = Number(iframe.attr('width') ?? body.width);
	if (Number.isNaN(width)) {
		width = null;
	}
	const height = Math.min(Number(iframe.attr('height') ?? body.height), 1024);
	if (Number.isNaN(height)) {
		// No proper height info
		return null;
	}

	// TODO: This implementation only allows basic syntax of `allow`.
	// Might need to implement better later.
	const safeList = [
		'autoplay',
		'clipboard-write',
		'fullscreen',
		'encrypted-media',
		'picture-in-picture',
		'web-share',
	];
	// YouTube has these but they are almost never used.
	const ignoredList = [
		'gyroscope',
		'accelerometer',
	];
	const allowedPermissions =
		(iframe.attr('allow') ?? '').split(/\s*;\s*/g)
			.filter(s => s)
			.filter(s => !ignoredList.includes(s));
	if (iframe.attr('allowfullscreen') === '') {
		allowedPermissions.push('fullscreen');
	}
	if (allowedPermissions.some(allow => !safeList.includes(allow))) {
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

export type GeneralScrapingOptions = {
	lang?: string | null;
	userAgent?: string;
	responseTimeout?: number;
	operationTimeout?: number;
	contentLengthLimit?: number;
	contentLengthRequired?: boolean;
}

export default async (_url: URL | string, opts?: GeneralScrapingOptions): Promise<Summary | null> => {
	let lang = opts?.lang;
	// eslint-disable-next-line no-param-reassign
	if (lang && !lang.match(/^[\w-]+(\s*,\s*[\w-]+)*$/)) lang = null;

	const url = typeof _url === 'string' ? new URL(_url) : _url;

	const res = await scpaping(url.href, {
		lang: lang || undefined,
		userAgent: opts?.userAgent,
		responseTimeout: opts?.responseTimeout,
		operationTimeout: opts?.operationTimeout,
		contentLengthLimit: opts?.contentLengthLimit,
		contentLengthRequired: opts?.contentLengthRequired,
	});
	const $ = res.$;
	const twitterCard =
		$('meta[name="twitter:card"]').attr('content') ||
		$('meta[property="twitter:card"]').attr('content');

	// According to docs, name attribute of meta tag is used for twitter card but for compatibility,
	// this library will also look for property attribute.
	// See https://developer.twitter.com/en/docs/twitter-for-websites/cards/overview/summary
	// Property attribute is used for open graph.
	// See https://ogp.me/

	let title: string | null | undefined =
		$('meta[property="og:title"]').attr('content') ||
		$('meta[name="twitter:title"]').attr('content') ||
		$('meta[property="twitter:title"]').attr('content') ||
		$('title').text();

	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	if (title === undefined || title === null) {
		return null;
	}

	title = clip(decodeHtml(title), 100);

	let image: string | null | undefined =
		$('meta[property="og:image"]').attr('content') ||
		$('meta[name="twitter:image"]').attr('content') ||
		$('meta[property="twitter:image"]').attr('content') ||
		$('link[rel="image_src"]').attr('href') ||
		$('link[rel="apple-touch-icon"]').attr('href') ||
		$('link[rel="apple-touch-icon image_src"]').attr('href');

	image = image ? (new URL(image, url.href)).href : null;

	const playerUrl =
		(twitterCard !== 'summary_large_image' && $('meta[name="twitter:player"]').attr('content')) ||
		(twitterCard !== 'summary_large_image' && $('meta[property="twitter:player"]').attr('content')) ||
		$('meta[property="og:video"]').attr('content') ||
		$('meta[property="og:video:secure_url"]').attr('content') ||
		$('meta[property="og:video:url"]').attr('content');

	const playerWidth = parseInt(
		$('meta[name="twitter:player:width"]').attr('content') ||
		$('meta[property="twitter:player:width"]').attr('content') ||
		$('meta[property="og:video:width"]').attr('content') ||
		'');

	const playerHeight = parseInt(
		$('meta[name="twitter:player:height"]').attr('content') ||
		$('meta[property="twitter:player:height"]').attr('content') ||
		$('meta[property="og:video:height"]').attr('content') ||
		'');

	let description: string | null | undefined =
		$('meta[property="og:description"]').attr('content') ||
		$('meta[name="twitter:description"]').attr('content') ||
		$('meta[property="twitter:description"]').attr('content') ||
		$('meta[name="description"]').attr('content');

	description = description
		? clip(decodeHtml(description), 300)
		: null;

	if (title === description) {
		description = null;
	}

	const siteName = decodeHtml(
		$('meta[property="og:site_name"]').attr('content') ||
		$('meta[name="application-name"]').attr('content') ||
		url.host,
	);

	const favicon =
		$('link[rel="shortcut icon"]').attr('href') ||
		$('link[rel="icon"]').attr('href') ||
		'/favicon.ico';

	const activityPub =
		$('link[rel="alternate"][type="application/activity+json"]').attr('href') || null;

	// https://developer.mixi.co.jp/connect/mixi_plugin/mixi_check/spec_mixi_check/#toc-18-
	const sensitive =
		$('meta[property=\'mixi:content-rating\']').attr('content') === '1';

	const find = async (path: string) => {
		const target = new URL(path, url.href);
		try {
			await head(target.href);
			return target;
		} catch (e) {
			return null;
		}
	};

	const getIcon = async () => {
		return (await find(favicon)) || null;
	};

	const [icon, oEmbed] = await Promise.all([
		getIcon(),
		getOEmbedPlayer($, url.href),
	]);

	// Clean up the title
	title = cleanupTitle(title, siteName);

	if (title === '') {
		title = siteName;
	}

	return {
		title: title || null,
		icon: icon?.href || null,
		description: description || null,
		thumbnail: image || null,
		player: oEmbed ?? {
			url: playerUrl || null,
			width: Number.isNaN(playerWidth) ? null : playerWidth,
			height: Number.isNaN(playerHeight) ? null : playerHeight,
			allow: ['autoplay', 'encrypted-media', 'fullscreen'],
		},
		sitename: siteName || null,
		sensitive,
		activityPub,
	};
};
