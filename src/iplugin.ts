import type Summary from '@/summary.js';
import type { GeneralScrapingOptions } from '@/general.js';

export interface SummalyPlugin {
	test: (url: URL) => boolean;
	summarize: (url: URL, opts?: GeneralScrapingOptions) => Promise<Summary | null>;
}
