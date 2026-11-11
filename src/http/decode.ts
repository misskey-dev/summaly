// Derived from misskey-dev/summaly (MIT)
import { detect } from 'chardet';

const regCharset = /charset\s*=\s*["']?([\w-]+)/i;

// UTF-8 is by far the most common, so the decoder instance is reused.
const utf8TextDecoder = new TextDecoder('utf-8', { fatal: false });

function isSupportedEncoding(label: string): boolean {
	try {
		new TextDecoder(label);
		return true;
	} catch {
		return false;
	}
}

/**
 * Detects the encoding of an HTML body.
 * Order: content-type charset (chiramiss addition) → chardet → meta charset → utf-8.
 */
export function detectEncoding(body: Buffer, contentType?: string): string {
	// From the content-type header (only when the label is usable)
	const fromHeader = contentType?.match(regCharset)?.[1]?.toLowerCase();
	if (fromHeader && isSupportedEncoding(fromHeader)) {
		return fromHeader;
	}

	// By detection
	const detected = detect(body);
	if (detected != null) {
		return detected.toLowerCase();
	}

	// From meta
	const fromMeta = body.toString().match(regCharset)?.[1];
	if (fromMeta) {
		return fromMeta.toLowerCase();
	}

	return 'utf-8';
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
