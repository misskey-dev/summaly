import { fetchSubresource } from '@/context.js';
import { clip } from '@/extract/text.js';
import type { Provider } from './provider.js';

/**
 * Path of a package page: `/package/<name>` or `/package/@<scope>/<name>`, optionally `/v/<version>`.
 * As on npm, a name or version may not start with `.`, and only URL-safe characters are taken, so both go into the
 * registry URL without escaping (`+` in a version aside). Package names are case-sensitive (old packages may have
 * uppercase letters), so the path is matched as is.
 */
const PATH = /^\/package\/((?:@[\w~-][\w.~-]*\/)?[\w~-][\w.~-]*)(?:\/v\/(\w[\w.+-]*))?\/?$/;

const HOSTS = new Set(['www.npmjs.com', 'npmjs.com', 'www.npmjs.org', 'npmjs.org']);

const REGISTRY = 'https://registry.npmjs.org';

/** The parts of a registry version document that are used. Every field is optional: none is trusted to be present. */
type PackageVersion = {
	description?: unknown;
};

/**
 * Package pages on npmjs.com. The site answers bots with a Cloudflare challenge instead of the page,
 * so the summary is built from the public registry API instead.
 */
export const npm: Provider = {
	name: 'npm',

	test: url => HOSTS.has(url.hostname) && PATH.test(url.pathname),

	async summarize(ctx, url) {
		const match = PATH.exec(url.pathname);

		if (!match) {
			throw new Error('not an npm package URL');
		}

		const name = match[1];
		const version = match[2] as string | undefined;

		// The registry takes a scoped name with its `/` encoded. It answers 404 for an unknown package or version.
		const endpoint = `${REGISTRY}/${name.replace('/', '%2f')}/${version == null ? 'latest' : encodeURIComponent(version)}`;
		const res = await fetchSubresource(ctx, endpoint, 'GET');
		const body = JSON.parse(res.body.toString('utf-8')) as PackageVersion | null;

		return {
			title: version == null ? name : `${name}@${version}`,
			icon: 'https://docs.npmjs.com/favicon-32x32.png',
			description: descriptionOf(body?.description),
			thumbnail: null,
			thumbnailStyle: null,
			player: {
				url: null,
				width: null,
				height: null,
				allow: [],
			},
			sitename: 'npm',
			activityPub: null,
			fediverseCreator: null,
		};
	},
};

/** The package's description on one line and clipped, or null when there is none. */
function descriptionOf(description: unknown): string | null {
	if (typeof description !== 'string') {
		return null;
	}

	const text = description.replace(/\s+/g, ' ').trim();

	if (text === '') {
		return null;
	}

	return clip(text, 300);
}
