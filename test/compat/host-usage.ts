// Mirrors how Misskey uses summaly (misskey-dev/misskey):
// - packages/backend/rolldown.config.ts imports `version` at build time
// - packages/backend/src/server/web/UrlPreviewService.ts calls `summaly` (fetchSummary)
// - packages/frontend uses only the result type
// Checked against built/index.d.ts by `pnpm typecheck:compat`.
import * as http from 'node:http';
import * as https from 'node:https';
import { version } from '../../built/index.js';
import type { SummalyResult } from '../../built/index.js';

declare const meta: {
	urlPreviewAllowRedirect: boolean;
	urlPreviewUserAgent: string | null;
	urlPreviewTimeout: number;
	urlPreviewMaximumContentLength: number;
	urlPreviewRequireContentLength: boolean;
};
declare const httpRequestService: { httpAgent: http.Agent; httpsAgent: https.Agent };
declare const configUrl: string;

// Backend build: embedded as _SUMMALY_VERSION_
export const summalyVersion: string = version;

const summalyDefaultUserAgent = `SummalyBot/${summalyVersion} (${configUrl}; +https://github.com/misskey-dev/summaly/blob/master/README.md)`;

export async function fetchSummary(url: string, lang?: string): Promise<SummalyResult> {
	const { summaly } = await import('../../built/index.js');

	return summaly(url, {
		followRedirects: meta.urlPreviewAllowRedirect,
		lang: lang ?? 'ja-JP',
		agent: {
			http: httpRequestService.httpAgent,
			https: httpRequestService.httpsAgent,
		},
		userAgent: meta.urlPreviewUserAgent ?? summalyDefaultUserAgent,
		operationTimeout: meta.urlPreviewTimeout,
		contentLengthLimit: meta.urlPreviewMaximumContentLength,
		contentLengthRequired: meta.urlPreviewRequireContentLength,
	});
}

// The backend rewrites these fields of the result it receives.
export function rewrite(summary: SummalyResult, wrap: (url: string | null) => string | null, sensitive: boolean): SummalyResult {
	summary.icon = wrap(summary.icon);
	summary.thumbnail = wrap(summary.thumbnail);
	if (summary.sensitive !== true) {
		summary.sensitive = sensitive;
	}

	return summary;
}

// Frontend side: only the result type is used.
export function previewTitle(summary: SummalyResult): string | null {
	return summary.title;
}

export const emptyPlayer: SummalyResult['player'] = { url: null, width: null, height: null, allow: [] };

export function partialPreview(summary: Partial<SummalyResult>): string | null {
	return summary.url ?? null;
}
