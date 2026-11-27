import type { Summary } from '@/types.js';

const WEB_PROTOCOLS = new Set(['http:', 'https:']);

/** `value` if it is an absolute http(s) URL, else null. */
function webUrl(value: string | null): string | null {
	if (value === null) {
		return null;
	}
	try {
		return WEB_PROTOCOLS.has(new URL(value).protocol) ? value : null;
	} catch {
		return null;
	}
}

/** `value` if it is an absolute http(s) URL or a `data:image/...` URL, else null. */
function imageUrl(value: string | null): string | null {
	if (value !== null && /^data:image\//i.test(value)) {
		return value;
	}

	return webUrl(value);
}

/**
 * Drops URLs a host must not use as they are: anything but http(s) for `player.url` (loaded into an iframe) and
 * `activityPub`, and anything but http(s) or an image `data:` URL for `icon` and `thumbnail` (shown as images).
 * A page or a plugin can put `javascript:` and other schemes there. Applied to every summary, plugins' included.
 */
export function sanitizeUrls<T extends Summary>(summary: T): T {
	return {
		...summary,
		icon: imageUrl(summary.icon),
		thumbnail: imageUrl(summary.thumbnail),
		player: { ...summary.player, url: webUrl(summary.player.url) },
		activityPub: webUrl(summary.activityPub),
	};
}
