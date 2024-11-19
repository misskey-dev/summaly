import iconv from 'iconv-lite';
import Encoding from 'encoding-japanese';
import jschardet from 'jschardet';

import type { Response } from 'got';

const regCharset = new RegExp(/charset\s*=\s*["']?([\w-]+)/, 'i');

export const ENCODING_JAPANESE_ENCODING_PREFIX = '__EJ__';

const ENCODING_JAPANESE_SUPPORTED_ENCODING: string[] = [
	'UTF32',
	'UTF16',
	'UTF16BE',
	'UTF16LE',
	'BINARY',
	'ASCII',
	'JIS',
	'UTF8',
	'EUCJP',
	'SJIS',
	'UNICODE',
	'AUTO',
] satisfies Encoding.Encoding[];

/**
 * Detect HTML encoding
 * @param body Body in Buffer
 * @returns encoding
 */
export function detectEncoding(res: Response): string {
	// From header
	const contentType = res.headers['content-type'];
	if (contentType) {
		const matchHeader = contentType.match(regCharset);
		if (matchHeader) {
			const candicate = matchHeader[1];
			const encoding = toEncoding(candicate);
			if (encoding != null) return encoding;
		}
	}

	const body = res.rawBody;

	// By detection
	const detected = jschardet.detect(body, { minimumThreshold: 0.99 });
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	if (detected) {
		const candicate = detected.encoding;
		const encoding = toEncoding(candicate);
		if (encoding != null) return encoding;
	}

	// From meta
	const matchMeta = body.toString('ascii').match(regCharset);
	if (matchMeta) {
		const candicate = matchMeta[1];
		const encoding = toEncoding(candicate);
		if (encoding != null) return encoding;
	}

	return 'utf-8';
}

export function toUtf8(body: Buffer, encoding: string): string {
	if (encoding.startsWith(ENCODING_JAPANESE_ENCODING_PREFIX)) {
		const _encoding = encoding.slice(ENCODING_JAPANESE_ENCODING_PREFIX.length);

		function assertEncoding(enc: string): enc is Encoding.Encoding {
			return ENCODING_JAPANESE_SUPPORTED_ENCODING.includes(enc);
		}

		if (assertEncoding(_encoding)) {
			return Encoding.codeToString(Encoding.convert(body, 'UNICODE', _encoding));
		}
	}
	return iconv.decode(body, encoding);
}

function toEncoding(candicate: string): string | null {
	// iconvで処理できない
	// https://github.com/ashtuchkin/iconv-lite/issues/60
	if (candicate.toLowerCase() === 'iso-2022-jp') return '__EJ__JIS';

	if (iconv.encodingExists(candicate)) {
		if (['shift_jis', 'shift-jis', 'windows-31j', 'x-sjis'].includes(candicate.toLowerCase())) return 'cp932';
		return candicate;
	} else {
		return null;
	}
}
