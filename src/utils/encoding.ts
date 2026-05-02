import * as iconv from 'iconv-lite';
import { detect } from 'chardet';

const regCharset = new RegExp(/charset\s*=\s*["']?([\w-]+)/, 'i');

/**
 * Detect HTML encoding
 * @param body Body in Buffer
 * @returns encoding
 */
export function detectEncoding(body: Uint8Array): string {
	// By detection
	const detected = detect(body);
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	if (detected) {
		const encoding = toEncoding(detected);
		if (encoding != null) return encoding;
	}

	// From meta
	const matchMeta = body.toString().match(regCharset);
	if (matchMeta) {
		const candicate = matchMeta[1];
		const encoding = toEncoding(candicate);
		if (encoding != null) return encoding;
	}

	return 'utf-8';
}

export function toUtf8(body: Uint8Array, encoding: string): string {
	return iconv.decode(body, encoding);
}

function toEncoding(candicate: string): string | null {
	if (iconv.encodingExists(candicate)) {
		if (['shift_jis', 'shift-jis', 'windows-31j', 'x-sjis'].includes(candicate.toLowerCase())) return 'cp932';
		return candicate;
	} else {
		return null;
	}
}
