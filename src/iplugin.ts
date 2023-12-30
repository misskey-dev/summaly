import type { URL } from 'node:url';
import Summary from './summary.js';

export interface SummalyPlugin {
	test: (url: URL) => boolean;
	summarize: (url: URL, lang?: string) => Promise<Summary | null>;
}
