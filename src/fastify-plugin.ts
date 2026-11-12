import { summaly } from '@/index.js';
import type { SummalyOptions } from '@/types.js';

type ReplyLike = {
	status(code: number): { send(payload: unknown): unknown };
};

type RequestLike = {
	// Fastify types the query as unknown unless a schema is given, so narrow it inside the handler.
	query: unknown;
};

/**
 * The part of a Fastify instance the plugin uses. Defined structurally so that the library
 * (and its published .d.ts) does not depend on fastify.
 */
export type FastifyLike = {
	get(path: string, handler: (req: RequestLike, reply: ReplyLike) => Promise<unknown>): unknown;
};

/**
 * Fastify plugin that serves `GET /`.
 */
export default function summaryPlugin(fastify: FastifyLike, options: SummalyOptions, done: (err?: Error) => void): void {
	fastify.get('/', async (req, reply) => {
		const query = req.query as { url?: string; lang?: string };
		const url = query.url;

		if (url == null) {
			return reply.status(400).send({
				error: 'url is required',
			});
		}

		try {
			return await summaly(url, {
				lang: query.lang,
				followRedirects: false,
				...options,
			});
		} catch (e) {
			return reply.status(500).send({
				error: e,
			});
		}
	});

	done();
}
