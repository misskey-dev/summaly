/**
 * @misskey-dev/summaly/fastify: summaly as a Fastify plugin. Needs `fastify` (a peer dependency).
 */

import type { FastifyPluginAsync } from 'fastify';
import { toErrorBody } from '@/fastify/error.js';
import { resolveRequestOptions } from '@/fastify/query.js';
import { createSummaly } from '@/index.js';
import type { SummalyOptions } from '@/types.js';

export type { SummalyErrorBody } from '@/fastify/error.js';

/**
 * Options of fastifySummaly: summaly options applied to every request.
 *
 * Requests may pass `lang`, `userAgent`, `followRedirects`, `responseTimeout`, `operationTimeout`,
 * `contentLengthLimit` and `contentLengthRequired` in the query, as Misskey does when it uses a summary proxy.
 * `lang`, `userAgent` and `followRedirects` given here win over the query (`followRedirects` defaults to false).
 * The timeouts and `contentLengthLimit` given here (or the defaults) are upper bounds the query may only tighten,
 * and the query may only turn `contentLengthRequired` on.
 */
export type SummalyFastifyOptions = SummalyOptions;

/**
 * Serves `GET /?url=<url>&lang=<lang>&...` with the summary as JSON.
 * A missing `url` gives 400 `{ error: 'url is required' }`. A failed summary gives 500 `{ error }` with why it failed
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
	const summaly = createSummaly(options);

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
			return await summaly(url, resolveRequestOptions(query, options));
		} catch (e) {
			return reply.status(500).send({
				error: toErrorBody(e),
			});
		}
	});
};
