import type { FastifyPluginAsync } from 'fastify';
import { createSummaly } from '@/summaly.js';
import type { SummalyOptions } from '@/types.js';
import { toErrorBody } from './error.js';
import { resolveRequestOptions } from './query.js';

/** Cache-Control of a successful summary, unless the plugin is given another `cacheControl`. */
export const DEFAULT_CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=43200';

/**
 * Options of fastifySummaly: summaly options applied to every request, and `cacheControl`.
 *
 * Requests may pass `lang`, `userAgent`, `followRedirects`, `responseTimeout`, `operationTimeout`,
 * `contentLengthLimit` and `contentLengthRequired` in the query, as Misskey does when it uses a summary proxy.
 * `lang`, `userAgent` and `followRedirects` given here win over the query (`followRedirects` defaults to false).
 * The timeouts and `contentLengthLimit` given here (or the defaults) are upper bounds the query may only tighten,
 * and the query may only turn `contentLengthRequired` on.
 */
export type SummalyFastifyOptions = SummalyOptions & {
	/**
	 * Cache-Control header of a successful summary, for a reverse proxy or a CDN in front.
	 * Defaults to `public, max-age=86400, stale-while-revalidate=43200`; false sends none.
	 * Errors never get one.
	 */
	cacheControl?: string | false;
};

/**
 * Serves `GET /?url=<url>&lang=<lang>&...` with the summary as JSON.
 * A successful summary has the `cacheControl` header. A missing `url` gives 400 `{ error: 'url is required' }`. A failed summary gives 500 `{ error }` with why it failed
 * (SummalyErrorBody: name, message, and the HTTP status or the system error code when there is one).
 *
 * Each registration has its own summaly instance (see createSummaly), closed when Fastify closes.
 *
 * ```ts
 * import { fastifySummaly } from '@misskey-dev/summaly/fastify';
 *
 * await fastify.register(fastifySummaly, { lang: 'ja-JP' });
 * ```
 */
export const fastifySummaly: FastifyPluginAsync<SummalyFastifyOptions> = async (fastify, options) => {
	const { cacheControl = DEFAULT_CACHE_CONTROL, ...summalyOptions } = options;
	const summaly = createSummaly(summalyOptions);

	// Fastify runs onClose once the requests in progress are answered.
	fastify.addHook('onClose', () => summaly.close());

	fastify.get('/', async (req, reply) => {
		const query = req.query as Record<string, unknown>;
		const url = query.url;

		if (typeof url !== 'string') {
			return reply.status(400).send({
				error: 'url is required',
			});
		}

		try {
			const summary = await summaly(url, resolveRequestOptions(query, summalyOptions));

			if (cacheControl !== false) {
				void reply.header('cache-control', cacheControl);
			}

			return summary;
		} catch (e) {
			return reply.status(500).send({
				error: toErrorBody(e),
			});
		}
	});
};
