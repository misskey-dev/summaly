/**
 * @misskey-dev/summaly/cache: what it takes to give summaly a cache or in-flight sharing.
 * summaly uses neither unless it is given one (the `cache` and `coordinator` options).
 */

export { InProcessCoordinator } from '@/cache/in-process-coordinator.js';
export type { CacheEntry, InflightCoordinator, SerializedError, SummaryCache } from '@/cache/types.js';
