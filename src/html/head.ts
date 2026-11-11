import { Parser } from 'htmlparser2';

/** `rel` is null when absent (oEmbed discovery links often have only `type`). */
export type LinkTag = { rel: string | null; type: string | null; href: string };

export type HeadInfo = {
	title: string | null;
	/** 同じキーの最初の出現を返す。値は生のまま（エンティティは未デコード）。 */
	meta(key: `name:${string}` | `property:${string}`): string | undefined;
	links: LinkTag[];
};

const CHUNK_SIZE = 16 * 1024;

/**
 * `</head>` か `<body>` に達するまでだけ読む軽量パーサ。
 * `<title>` が head の外にしかない場合に備え、停止後も title だけは探す。
 */
export function parseHead(html: string): HeadInfo {
	const metas = new Map<string, string>();
	const links: LinkTag[] = [];
	// Kept in an object: the parser callbacks change these during parser.write(), which plain `let`
	// narrowing would not see in the loop below.
	const state: { title: string | null; headDone: boolean } = { title: null, headDone: false };
	let inTitle = false;
	let titleText = '';

	const parser = new Parser({
		// htmlparser2 types attribs as always present; an attribute that is not on the tag is undefined.
		onopentag(name, attrs: Record<string, string | undefined>) {
			if (name === 'title') {
				if (state.title === null) {
					inTitle = true;
					titleText = '';
				}
				return;
			}
			if (state.headDone) return;
			if (name === 'body') {
				state.headDone = true;
			} else if (name === 'meta') {
				const content = attrs['content'];
				if (content === undefined) return;
				for (const attr of ['name', 'property'] as const) {
					const value = attrs[attr];
					if (value === undefined) continue;
					const key = `${attr}:${value}`;
					if (!metas.has(key)) metas.set(key, content);
				}
			} else if (name === 'link') {
				const href = attrs['href'];
				if (href === undefined) return;
				links.push({ rel: attrs['rel'] ?? null, type: attrs['type'] ?? null, href });
			}
		},
		ontext(text) {
			if (inTitle) titleText += text;
		},
		onclosetag(name) {
			if (name === 'title' && inTitle) {
				inTitle = false;
				state.title = titleText;
			} else if (name === 'head') {
				state.headDone = true;
			}
		},
	}, { decodeEntities: false });

	for (let i = 0; i < html.length; i += CHUNK_SIZE) {
		parser.write(html.slice(i, i + CHUNK_SIZE));
		if (state.headDone && state.title !== null) break;
	}
	parser.end();

	return {
		title: state.title,
		meta: key => metas.get(key),
		links,
	};
}
