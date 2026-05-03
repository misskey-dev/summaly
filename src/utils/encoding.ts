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
		const decoder = new TextDecoder(encoding, { fatal: true });
		return decoder.decode(body);
	} catch (e) {
		// フォールバック
		const decoder = new TextDecoder('utf-8', { fatal: false });
		return decoder.decode(body);
	}
}
