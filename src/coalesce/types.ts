import type { SummaryResult } from '@/types.js';

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
 *
 * - `ok` / `error`: 要約の結果（成功した要約、または失敗したときのエラー）
 * - `icon`: favicon の確認結果。HEAD が成功した icon の URL、失敗したときは null
 *
 * 要約と favicon の確認は同じキャッシュを使うが、キーは用途ごとに分かれていて重ならない。
 * 用途に合わない種類のエントリ（要約のキーで `icon` が返ったなど）は、壊れたものとしてキャッシュミスと同じに扱う
 */
export type CacheEntry =
	| { kind: 'ok'; value: SummaryResult }
	| { kind: 'error'; error: SerializedError }
	| { kind: 'icon'; href: string | null };

export interface SummaryCache {
	get(key: string): Promise<CacheEntry | undefined>;
	set(key: string, entry: CacheEntry, ttlMs: number): Promise<void>;
}

/**
 * 同じ key で実行中の処理があれば、新しく task を走らせずにその結果を共有する
 *
 * run は入れ子で呼ばれる。要約の task の中から、favicon の確認のために別の key で run が呼ばれ、
 * 外側の task はその完了を待つ。そのため、key をまたいで待たせる実装（全体を1本ずつ直列にする、
 * 同時実行数を N に絞るなど）は、外側の task が枠を持ったまま内側の run が枠を待って止まる。
 * 待たせるのは同じ key どうしだけにすること。同時実行数を絞りたいときは、run の外（要約を呼ぶ側）で絞る
 */
export interface InflightCoordinator {
	run<T>(key: string, task: () => Promise<T>): Promise<T>;
}
