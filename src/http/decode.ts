import { detect } from 'chardet';

/** How far into the body `<meta charset>` is looked for. The HTML spec prescans 1024 bytes; this is more lenient. */
const META_PRESCAN_BYTES = 8 * 1024;

/** How much of the body chardet sees. Running it on a whole page costs ~50ms per 350KB. */
const CHARDET_SAMPLE_BYTES = 16 * 1024;

const headerCharset = /charset\s*=\s*["']?([\w-]+)/i;
const metaTag = /<meta\b[^>]*>/gi;
const attribute = /([^\s"'=/>]+)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
const comment = /<!--[\s\S]*?(?:-->|$)/g;

// UTF-8 is by far the most common, so the decoder instance is reused.
const utf8TextDecoder = new TextDecoder('utf-8', { fatal: false });
const strictUtf8TextDecoder = new TextDecoder('utf-8', { fatal: true });

/** The WHATWG canonical name of an encoding label (e.g. 'x-sjis' → 'shift_jis'), or null if unsupported. */
function canonicalEncoding(label: string): string | null {
	try {
		return new TextDecoder(label).encoding;
	} catch {
		return null;
	}
}

function fromBom(body: Buffer): string | null {
	if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) {
		return 'utf-8';
	}
	if (body[0] === 0xff && body[1] === 0xfe) {
		return 'utf-16le';
	}
	if (body[0] === 0xfe && body[1] === 0xff) {
		return 'utf-16be';
	}

	return null;
}

function fromContentType(contentType: string | undefined): string | null {
	const label = contentType?.match(headerCharset)?.[1];

	return label ? canonicalEncoding(label) : null;
}

/** The charset a `<meta>` tag declares: its `charset` attribute, or the `content` of `http-equiv="content-type"`. */
function metaTagCharset(tag: string): string | null {
	const attrs = new Map<string, string>();

	for (const match of tag.slice('<meta'.length).matchAll(attribute)) {
		const key = (match.at(1) ?? '').toLowerCase();
		const value = (match.at(2) ?? '').replace(/^(["'])(.*)\1$/s, '$2');

		if (!attrs.has(key)) {
			attrs.set(key, value);
		}
	}
	const charset = attrs.get('charset');

	if (charset) {
		return charset.trim();
	}
	if (attrs.get('http-equiv')?.toLowerCase() === 'content-type') {
		return attrs.get('content')?.match(headerCharset)?.[1] ?? null;
	}

	return null;
}

function fromMeta(body: Buffer): string | null {
	// latin1 maps every byte to one character, so ASCII markup is readable whatever the real encoding is.
	const head = body.subarray(0, META_PRESCAN_BYTES).toString('latin1').replace(comment, '');

	for (const [tag] of head.matchAll(metaTag)) {
		const label = metaTagCharset(tag);

		// Checked on the label itself: TextDecoder on Node 22 does not know x-user-defined, so canonicalEncoding() would drop it.
		if (label?.trim().toLowerCase() === 'x-user-defined') {
			return 'windows-1252';
		}
		const encoding = label ? canonicalEncoding(label) : null;

		if (!encoding) {
			continue;
		}
		// A document that could be read as ASCII to find its meta cannot really be UTF-16 (HTML spec).
		if (encoding === 'utf-16le' || encoding === 'utf-16be') {
			return 'utf-8';
		}

		return encoding;
	}

	return null;
}

function isValidUtf8(body: Buffer): boolean {
	try {
		strictUtf8TextDecoder.decode(body);

		return true;
	} catch {
		return false;
	}
}

function fromDetection(body: Buffer): string | null {
	if (body.length === 0) {
		return null;
	}
	const sampled = detect(body.subarray(0, CHARDET_SAMPLE_BYTES));

	if (sampled?.toLowerCase() !== 'ascii') {
		return sampled ? canonicalEncoding(sampled) : null;
	}
	// An ASCII-only sample says nothing about the rest. Most such pages are UTF-8, which is cheap to confirm;
	// otherwise fall back to detecting on the whole body (slow, but only for undeclared non-UTF-8 pages).
	if (isValidUtf8(body)) {
		return 'utf-8';
	}
	const whole = detect(body);

	return whole ? canonicalEncoding(whole) : null;
}

/**
 * Detects the encoding of an HTML body, in the order browsers use:
 * BOM → content-type charset → `<meta charset>` near the top → chardet on a sample → utf-8.
 * Returns a WHATWG canonical encoding name.
 * chardet sees only a sample: running it on a whole page would dominate the cost of a summary.
 */
export function detectEncoding(body: Buffer, contentType?: string): string {
	return fromBom(body)
		?? fromContentType(contentType)
		?? fromMeta(body)
		?? fromDetection(body)
		?? 'utf-8';
}

export function toUtf8(body: Buffer, encoding: string): string {
	try {
		const decoder = encoding === 'utf-8' ? utf8TextDecoder : new TextDecoder(encoding, { fatal: true });

		return decoder.decode(body);
	} catch {
		// Fallback
		return utf8TextDecoder.decode(body);
	}
}

export function decodeHtml(body: Buffer, contentType?: string): string {
	return toUtf8(body, detectEncoding(body, contentType));
}
