/**
 * HTTP endpoints of the standalone summaly server
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { InProcessCoordinator, type InflightCoordinator, type SummaryCache } from '@/cache.js';
import { createSummaly } from '@/index.js';
import type { ServerConfig } from './config.js';
import { MemorySummaryCache } from './memory-cache.js';
import { resolveRequestOptions } from './query.js';

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
 * Builds the server: `GET /` (summary endpoint) and `GET /healthz`.
 */
export function buildApp(config: ServerConfig, deps: AppDeps = {}, options: AppOptions = {}): FastifyInstance {
	const app = Fastify({ logger: options.logger ?? false });

	// One instance per app, so concurrent and repeated requests share its in-flight runs and cache.
	const summaly = createSummaly({
		...config.summalyOptions,
		cache: deps.cache ?? new MemorySummaryCache(config.cache),
		coordinator: deps.coordinator ?? new InProcessCoordinator(),
	});

	// Fastify runs onClose once the requests in progress are answered.
	app.addHook('onClose', () => summaly.close());

	app.get('/', async (req, reply) => {
		const query = req.query as Record<string, unknown>;
		const url = query.url;

		if (typeof url !== 'string') {
			return reply.status(400).send({
				error: 'url is required',
			});
		}

		try {
			return await summaly(url, resolveRequestOptions(query, config.summalyOptions));
		} catch (e) {
			return reply.status(500).send({
				error: e,
			});
		}
	});

	app.get('/healthz', async () => ({ status: 'ok' }));

	return app;
}
