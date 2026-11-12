// Derived from misskey-dev/summaly (MIT)
import { Parser } from 'htmlparser2';
import { type ScrapeContext, fetchSubresource } from '@/context.js';
import type { HeadInfo } from '@/html/head.js';
import type { Player } from '@/types.js';
import { linkHref } from './fields.js';

const MAX_HEIGHT = 1024;
// An accepted html is a top-level iframe (depth 1, since htmlparser2 reads its content as raw text),
// possibly followed by stray markup that the old DOM-based check let through; one extra level is kept for
// that. Anything deeper is rejected without parsing the rest: htmlparser2 makes each tag cost as much as
// the current nesting depth, so unbounded nesting would take quadratic time.
const MAX_HTML_DEPTH = 2;

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

	const attrs = findTopLevelIframe(body.html);

	if (!attrs) {
		return null;
	}

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

	// Same parts as `split(/\s*;\s*/)`: whitespace is dropped only where it touches a `;`.
	// The pattern is not used because, when no `;` follows a run of whitespace, it rescans the run
	// from each of its positions, which is quadratic on a value the remote controls.
	const allowedPermissions = (attrs['allow'] ?? '').split(';')
		.map((s, i, parts) => {
			const part = i > 0 ? s.trimStart() : s;

			return i < parts.length - 1 ? part.trimEnd() : part;
		})
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

/**
 * Attributes of the iframe when html has exactly one and it is at the top level (upstream: only the body
 * and html elements as the parents); null otherwise, or when html nests deeper than MAX_HTML_DEPTH.
 */
function findTopLevelIframe(html: string): Record<string, string> | null {
	// Kept in an object: the parser callbacks change these during parser.write(), which plain `let`
	// narrowing would not see after it.
	const state: { depth: number; tooDeep: boolean; iframes: number; topLevel: Record<string, string> | null } = {
		depth: 0,
		tooDeep: false,
		iframes: 0,
		topLevel: null,
	};
	const parser = new Parser({
		onopentag(name, attrs) {
			state.depth++;
			if (state.depth > MAX_HTML_DEPTH) {
				state.tooDeep = true;
				parser.pause();

				return;
			}
			if (name === 'iframe') {
				state.iframes++;
				if (state.depth === 1) {
					state.topLevel = attrs;
				}
			}
		},
		onclosetag() {
			state.depth--;
		},
	});

	// While paused, end() does not resume: the rest stays untokenized.
	parser.write(html);
	parser.end();

	if (state.tooDeep || state.iframes !== 1) {
		// Too deeply nested, or somehow we either have multiple iframes or none
		return null;
	}

	return state.topLevel;
}
