import { detect } from 'chardet';

const regCharset = new RegExp(/charset\s*=\s*["']?([\w-]+)/, 'i');

// UTF-8は多くのサイトで採用されているため、インスタンスを使い回すことでパフォーマンスを向上させる
const utf8TextDecoder = new TextDecoder('utf-8', { fatal: false });

/**
 * Detect HTML encoding
 * @param body Body in Buffer
 * @returns encoding
 */
export function detectEncoding(body: Uint8Array): string {
	// By detection
	const detected = detect(body);
	if (detected != null) {
		return detected.toLowerCase();
	}

	// From meta
	const matchMeta = body.toString().match(regCharset);
	if (matchMeta) {
		const candicate = matchMeta[1];
		if (candicate) {
			return candicate.toLowerCase();
		}
	}

	return 'utf-8';
}

export function toUtf8(body: Uint8Array, encoding: string): string {
	try {
		const decoder = encoding === 'utf-8' ? utf8TextDecoder : new TextDecoder(encoding, { fatal: true });
		return decoder.decode(body);
	} catch (e) {
		// フォールバック
		return utf8TextDecoder.decode(body);
	}
}
