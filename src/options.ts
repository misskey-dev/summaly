// Derived from misskey-dev/summaly (MIT)
import type { SummarizeOptions } from '@/types.js';
import { DEFAULT_BOT_UA } from '@/version.js';

export const DEFAULT_RESPONSE_TIMEOUT = 20 * 1000;
export const DEFAULT_OPERATION_TIMEOUT = 60 * 1000;
export const DEFAULT_MAX_RESPONSE_SIZE = 10 * 1024 * 1024;

/** Request settings with every default filled in. */
export type ResolvedOptions = {
	/** Accept-Language value, or null when unset or malformed */
	lang: string | null;
	userAgent: string;
	followRedirects: boolean;
	responseTimeout: number;
	operationTimeout: number;
	contentLengthLimit: number;
	contentLengthRequired: boolean;
};

// Same check as upstream general(): a comma-separated list of language tags.
const LANG_PATTERN = /^[\w-]+(\s*,\s*[\w-]+)*$/;

export function resolveOptions(opts: SummarizeOptions): ResolvedOptions {
	return {
		lang: opts.lang && LANG_PATTERN.test(opts.lang) ? opts.lang : null,
		userAgent: opts.userAgent ?? DEFAULT_BOT_UA,
		followRedirects: opts.followRedirects ?? true,
		responseTimeout: opts.responseTimeout ?? DEFAULT_RESPONSE_TIMEOUT,
		operationTimeout: opts.operationTimeout ?? DEFAULT_OPERATION_TIMEOUT,
		contentLengthLimit: opts.contentLengthLimit ?? DEFAULT_MAX_RESPONSE_SIZE,
		contentLengthRequired: opts.contentLengthRequired ?? false,
	};
}
