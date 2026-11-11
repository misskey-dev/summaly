import type { InflightCoordinator } from '@/coalesce/types.js';

/**
 * Shares in-flight tasks within this process: while a task for a key runs, `run` with the same key returns its promise.
 */
export class InProcessCoordinator implements InflightCoordinator {
	readonly #inflight = new Map<string, Promise<unknown>>();

	run<T>(key: string, task: () => Promise<T>): Promise<T> {
		const running = this.#inflight.get(key);
		if (running !== undefined) {
			return running as Promise<T>;
		}

		const promise = (async () => task())().finally(() => {
			if (this.#inflight.get(key) === promise) {
				this.#inflight.delete(key);
			}
		});
		this.#inflight.set(key, promise);
		return promise;
	}
}
