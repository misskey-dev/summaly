/**
 * The standalone summaly server: fastifySummaly at `/`, plus `GET /healthz`
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { InProcessCoordinator, type InflightCoordinator, type SummaryCache } from '@/cache/index.js';
import { fastifySummaly } from '@/fastify/index.js';
import type { ServerConfig } from './config.js';
import { MemorySummaryCache } from './memory-cache.js';

export type AppDeps = {
	/**
	 * Result cache. Defaults to a MemorySummaryCache with the TTLs of `config.cache`.
	 * The hook for a shared cache (e.g. one built from REDIS_URL in the future).
	 */
	cache?: SummaryCache;

	/**
	 * In-flight request sharing. Defaults to an InProcessCoordinator.
	 */
	coordinator?: InflightCoordinator;
};

export type AppOptions = {
	/**
	 * Enables Fastify's request log on standard output (default false)
	 */
	logger?: boolean;
};

/**
 * Builds the server: `GET /` (fastifySummaly with the options from the environment) and `GET /healthz`.
 */
export function buildApp(config: ServerConfig, deps: AppDeps = {}, options: AppOptions = {}): FastifyInstance {
	const app = Fastify({ logger: options.logger ?? false });

	// One summaly instance for the app, so concurrent and repeated requests share its in-flight runs and cache.
	void app.register(fastifySummaly, {
		...config.summalyOptions,
		cache: deps.cache ?? new MemorySummaryCache(config.cache),
		coordinator: deps.coordinator ?? new InProcessCoordinator(),
		cacheControl: config.cacheControl,
	});

	app.get('/healthz', async () => ({ status: 'ok' }));

	return app;
}
