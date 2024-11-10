import Summary from '@/summary.js';
import type { URL } from 'node:url';
import { GeneralScrapingOptions } from '@/general.js';

export interface SummalyPlugin {
	test: (url: URL) => boolean;
	summarize: (url: URL, opts?: GeneralScrapingOptions) => Promise<Summary | null>;
}
