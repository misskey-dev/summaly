// Mirrors how the tiramiss host calls summaly (packages/backend/src/server/web/UrlPreviewService.ts, fetchSummary)
// and how its frontend imports the result type. Checked against built/index.d.ts by `pnpm typecheck:compat`.
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
declare const summalyDefaultUserAgent: string;

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

export const botUserAgent: string = `SummalyBot/${version}`;

// Frontend side: only the result type is used.
export function previewTitle(summary: SummalyResult): string | null {
	return summary.title;
}
