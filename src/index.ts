import { VERSION } from '@/version.js';

export const version: string = VERSION;

export type {
	GeneralScrapingOptions,
	Player,
	ProxyOptions,
	Summary,
	SummalyOptions,
	SummalyPlugin,
	SummalyResult,
} from '@/types.js';
export type {
	CacheEntry,
	InflightCoordinator,
	SerializedError,
	SummaryCache,
} from '@/coalesce/types.js';
