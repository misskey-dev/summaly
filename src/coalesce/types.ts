import type { SummalyResult } from '@/types.js';

/**
 * JSON にできるエラーの表現（キャッシュに保存するため）
 */
export type SerializedError = {
	name: string;
	message: string;
	statusCode?: number;
	statusMessage?: string;
};

/**
 * キャッシュに保存する1件分。JSON を往復しても同じ結果になる形に限る
 */
export type CacheEntry =
	| { kind: 'ok'; value: SummalyResult }
	| { kind: 'error'; error: SerializedError };

export interface SummaryCache {
	get(key: string): Promise<CacheEntry | undefined>;
	set(key: string, entry: CacheEntry, ttlMs: number): Promise<void>;
}

/**
 * 同じ key で実行中の処理があれば、新しく task を走らせずにその結果を共有する
 */
export interface InflightCoordinator {
	run<T>(key: string, task: () => Promise<T>): Promise<T>;
}
