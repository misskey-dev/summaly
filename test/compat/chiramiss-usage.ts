// The same host usage as host-usage.ts, written with chiramiss's own names.
// Checked against built/index.d.ts by `pnpm typecheck:compat`.
import * as http from 'node:http';
import * as https from 'node:https';
import { createSummarizer, defaultSummarizeOptions, version } from '../../built/index.js';
import type { SummarizeOptions, SummaryPlugin, SummaryResult } from '../../built/index.js';

declare const meta: {
	urlPreviewAllowRedirect: boolean;
	urlPreviewUserAgent: string | null;
	urlPreviewTimeout: number;
	urlPreviewMaximumContentLength: number;
	urlPreviewRequireContentLength: boolean;
};
declare const httpRequestService: { httpAgent: http.Agent; httpsAgent: https.Agent };
declare const defaultUserAgent: string;

export async function fetchSummary(url: string, lang?: string): Promise<SummaryResult> {
	const { summarize } = await import('../../built/index.js');
	const options: SummarizeOptions = {
		followRedirects: meta.urlPreviewAllowRedirect,
		lang: lang ?? 'ja-JP',
		agent: {
			http: httpRequestService.httpAgent,
			https: httpRequestService.httpsAgent,
		},
		userAgent: meta.urlPreviewUserAgent ?? defaultUserAgent,
		operationTimeout: meta.urlPreviewTimeout,
		contentLengthLimit: meta.urlPreviewMaximumContentLength,
		contentLengthRequired: meta.urlPreviewRequireContentLength,
	};
	return summarize(url, options);
}

const plugin: SummaryPlugin = {
	test: url => url.hostname === 'example.com',
	summarize: async () => null,
};

export const summarizeWithPlugin: (url: string, options?: SummarizeOptions) => Promise<SummaryResult> = createSummarizer({
	...defaultSummarizeOptions,
	plugins: [plugin],
});

export const botUserAgent: string = `ChiramissBot/${version}`;

export function previewTitle(summary: SummaryResult): string | null {
	return summary.title;
}
