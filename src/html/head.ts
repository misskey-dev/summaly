import { Parser } from 'htmlparser2';

export type LinkTag = { rel: string; type: string | null; href: string };

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
	let title: string | null = null;
	let inTitle = false;
	let titleText = '';
	let headDone = false;

	const parser = new Parser({
		onopentag(name, attrs) {
			if (name === 'title') {
				if (title === null) {
					inTitle = true;
					titleText = '';
				}
				return;
			}
			if (headDone) return;
			if (name === 'body') {
				headDone = true;
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
				const { rel, href } = attrs;
				if (rel === undefined || href === undefined) return;
				links.push({ rel, type: attrs['type'] ?? null, href });
			}
		},
		ontext(text) {
			if (inTitle) titleText += text;
		},
		onclosetag(name) {
			if (name === 'title' && inTitle) {
				inTitle = false;
				title = titleText;
			} else if (name === 'head') {
				headDone = true;
			}
		},
	}, { decodeEntities: false });

	for (let i = 0; i < html.length; i += CHUNK_SIZE) {
		parser.write(html.slice(i, i + CHUNK_SIZE));
		if (headDone && title !== null) break;
	}
	parser.end();

	return {
		title,
		meta: key => metas.get(key),
		links,
	};
}
