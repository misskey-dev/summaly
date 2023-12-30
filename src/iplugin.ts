import Summary from './summary.js';
import type { URL } from 'node:url';

export interface SummalyPlugin {
	test: (url: URL) => boolean;
	summarize: (url: URL, lang?: string) => Promise<Summary | null>;
}
