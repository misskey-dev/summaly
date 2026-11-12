import { Parser } from 'htmlparser2';

/** `rel` is null when absent (oEmbed discovery links often have only `type`). */
export type LinkTag = { rel: string | null; type: string | null; href: string };

export type HeadInfo = {
	title: string | null;
	/** The first value for the key, raw (entities not decoded). */
	meta(key: `name:${string}` | `property:${string}`): string | undefined;
	links: LinkTag[];
};

/**
 * Reading stops at this nesting depth. htmlparser2 spends time proportional to the current depth on every tag,
 * so without a limit a deeply nested page takes quadratic time. Real pages are far shallower than this.
 */
const MAX_DEPTH = 128;

/**
 * A light parser that reads only up to `</head>` or `<body>`.
 * Since a page may have its `<title>` outside the head only, it keeps looking for the title (and nothing else)
 * after the head until it finds one. Once the head has ended and the title is known, it stops tokenizing and never
 * reads the rest of the body. It also stops when the nesting goes deeper than MAX_DEPTH, and returns what it read.
 */
export function parseHead(html: string): HeadInfo {
	const metas = new Map<string, string>();
	const links: LinkTag[] = [];
	// Kept in an object: the parser callbacks change these during parser.write(), which plain `let`
	// narrowing would not see after it.
	const state: { title: string | null; headDone: boolean } = { title: null, headDone: false };
	let inTitle = false;
	let titleText = '';
	let depth = 0;
	// Nothing after this point can change the result. pause() stops the tokenizer right after the current
	// tag, even in the middle of the string written, so the rest of the page is never tokenized.
	const stopIfDone = () => {
		if (state.headDone && state.title !== null) {
			parser.pause();
		}
	};

	const parser = new Parser({
		// htmlparser2 types attribs as always present; an attribute that is not on the tag is undefined.
		onopentag(name, attrs: Record<string, string | undefined>) {
			depth++;
			if (depth > MAX_DEPTH) {
				parser.pause();

				return;
			}
			if (name === 'title') {
				if (state.title === null) {
					inTitle = true;
					titleText = '';
				}

				return;
			}
			if (state.headDone) {
				return;
			}
			if (name === 'body') {
				state.headDone = true;
				stopIfDone();
			} else if (name === 'meta') {
				const content = attrs['content'];

				if (content === undefined) {
					return;
				}
				for (const attr of ['name', 'property'] as const) {
					const value = attrs[attr];

					if (value === undefined) {
						continue;
					}
					const key = `${attr}:${value}`;

					if (!metas.has(key)) {
						metas.set(key, content);
					}
				}
			} else if (name === 'link') {
				const href = attrs['href'];

				if (href === undefined) {
					return;
				}
				links.push({ rel: attrs['rel'] ?? null, type: attrs['type'] ?? null, href });
			}
		},
		ontext(text) {
			if (inTitle) {
				titleText += text;
			}
		},
		onclosetag(name) {
			depth--;
			if (name === 'title' && inTitle) {
				inTitle = false;
				state.title = titleText;
				stopIfDone();
			} else if (name === 'head') {
				state.headDone = true;
				stopIfDone();
			}
		},
	}, { decodeEntities: false });

	// While paused, end() does not resume: the rest stays untokenized.
	parser.write(html);
	parser.end();

	return {
		title: state.title,
		meta: key => metas.get(key),
		links,
	};
}
