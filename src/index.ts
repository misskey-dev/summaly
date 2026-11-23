/**
 * summaly
 * https://github.com/misskey-dev/summaly
 */

import { randomUUID } from 'crypto';
import got from 'got';
import type { Agents as GotAgents } from 'got';
import type { FastifyInstance } from 'fastify';
import { SummalyResult as _SummalyResult } from '@/summary.js';
import { SummalyPlugin as _SummalyPlugin } from '@/iplugin.js';
import { general, type GeneralScrapingOptions } from '@/general.js';
import { DEFAULT_BOT_UA, DEFAULT_OPERATION_TIMEOUT, DEFAULT_RESPONSE_TIMEOUT, agent, setAgent } from '@/utils/got.js';
import { plugins as builtinPlugins } from '@/plugins/index.js';
import { logger } from '@/utils/logger.js';

declare module 'fastify' {
	interface FastifyRequest {
		requestId: string;
		startTime: number;
	}
}

export type SummalyResult = _SummalyResult;

export type SummalyPlugin = _SummalyPlugin;

export type SummalyOptions = {
	/**
	 * Accept-Language for the request
	 */
	lang?: string | null;

	/**
	 * Whether follow redirects
	 */
	followRedirects?: boolean;

	/**
	 * Custom Plugins
	 */
	plugins?: SummalyPlugin[];

	/**
	 * Custom HTTP agent
	 */
	agent?: GotAgents;

	/**
	 * User-Agent for the request
	 */
	userAgent?: string;

	/**
	 * Response timeout.
	 * Set timeouts for each phase, such as host name resolution and socket communication.
	 */
	responseTimeout?: number;

	/**
	 * Operation timeout.
	 * Set the timeout from the start to the end of the request.
	 */
	operationTimeout?: number;

	/**
	 * Maximum content length.
	 * If set to true, an error will occur if the content-length value returned from the other server is larger than this parameter (or if the received body size exceeds this parameter).
	 */
	contentLengthLimit?: number;

	/**
	 * Content length required.
	 * If set to true, it will be an error if the other server does not return content-length.
	 */
	contentLengthRequired?: boolean;

	/**
	 * Request ID for logging
	 */
	requestId?: string;
};

export const summalyDefaultOptions = {
	lang: null,
	followRedirects: true,
	plugins: [],
} as SummalyOptions;

export const version = _VERSION_ as string;

/**
 * Summarize an web page
 */
export const summaly = async (url: string, options?: SummalyOptions): Promise<SummalyResult> => {
	if (options?.agent) setAgent(options.agent);

	const opts: SummalyOptions = {
		...summalyDefaultOptions,
		...options,
	};

	const plugins = builtinPlugins.concat(opts.plugins || []);

	let actualUrl = url;
	if (opts.followRedirects) {
		// .catch(() => url)にすればいいけど、jestにtrace-redirectを食わせるのが面倒なのでtry-catch
		try {
			const timeout = opts.responseTimeout ?? DEFAULT_RESPONSE_TIMEOUT;
			const operationTimeout = opts.operationTimeout ?? DEFAULT_OPERATION_TIMEOUT;
			actualUrl = await got
				.head(url, {
					headers: {
						accept: 'text/html,application/xhtml+xml',
						'user-agent': opts.userAgent ?? DEFAULT_BOT_UA,
						'accept-language': opts.lang ?? undefined,
					},
					timeout: {
						lookup: timeout,
						connect: timeout,
						secureConnect: timeout,
						socket: timeout, // read timeout
						response: timeout,
						send: timeout,
						request: operationTimeout, // whole operation timeout
					},
					agent,
					http2: false,
					retry: {
						limit: 0,
					},
				})
				.then(res => res.url);
		} catch {
			actualUrl = url;
		}
	}

	const _url = new URL(actualUrl);

	// Find matching plugin
	const match = plugins.filter(plugin => plugin.test(_url))[0];

	// Get summary
	const scrapingOptions: GeneralScrapingOptions = {
		lang: opts.lang,
		userAgent: opts.userAgent,
		responseTimeout: opts.responseTimeout,
		followRedirects: opts.followRedirects,
		operationTimeout: opts.operationTimeout,
		contentLengthLimit: opts.contentLengthLimit,
		contentLengthRequired: opts.contentLengthRequired,
		requestId: opts.requestId,
	};

	try {
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		const summary = await (match ? match.summarize : general)(_url, scrapingOptions);

		if (summary == null) {
			const error = new Error('failed summarize');
			if (opts.requestId) {
				logger.error({
					requestId: opts.requestId,
					url: actualUrl,
					error: {
						message: error.message,
						name: error.name,
					},
				}, 'Failed to summarize URL - summary is null');
			}
			throw error;
		}

		return Object.assign(summary, {
			url: actualUrl,
		});
	} catch (error) {
		if (opts.requestId) {
			logger.error({
				requestId: opts.requestId,
				url: actualUrl,
				error: {
					message: error instanceof Error ? error.message : String(error),
					name: error instanceof Error ? error.name : 'Unknown',
					stack: error instanceof Error ? error.stack : undefined,
				},
			}, `Summaly function error: ${error instanceof Error ? error.message : String(error)}`);
		}
		throw error;
	}
};

// eslint-disable-next-line import/no-default-export
export default function (fastify: FastifyInstance, options: SummalyOptions, done: (err?: Error) => void) {
	// Request logger middleware
	fastify.addHook('preHandler', async (req) => {
		const requestId = randomUUID();
		req.requestId = requestId;
		req.startTime = Date.now();

		// 1. 来たリクエストを表示
		logger.info({
			requestId,
			method: req.method,
			url: req.url,
			query: req.query,
			userAgent: req.headers['user-agent'],
			ip: req.ip,
		}, `Request received: ${req.method} ${req.url}`);
	});

	// Response logger middleware
	fastify.addHook('onSend', async (req, reply, payload) => {
		const requestId = req.requestId;
		const startTime = req.startTime;
		const responseTime = Date.now() - startTime;

		// 3. リクエストに対するレスポンス
		logger.info({
			requestId,
			method: req.method,
			url: req.url,
			statusCode: reply.statusCode,
			responseTime: `${responseTime}ms`,
		}, `Response sent: ${reply.statusCode} (${responseTime}ms)`);

		return payload;
	});

	fastify.get<{
		Querystring: {
			url?: string;
			lang?: string;
		};
	}>('/', async (req, reply) => {
		const requestId = req.requestId;
		const url = req.query.url as string;
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		if (url == null) {
			logger.warn({
				requestId,
			}, 'Missing required URL parameter');

			return reply.status(400).send({
				error: 'url is required',
			});
		}

		try {
			const summary = await summaly(url, {
				lang: req.query.lang as string,
				...options,
				requestId, // summaly関数にrequestIdを渡す
			});

			return summary;
		} catch (e) {
			// 5. エラーハンドリングに入った場合のログ
			logger.error({
				requestId,
				url,
				error: {
					message: e instanceof Error ? e.message : String(e),
					name: e instanceof Error ? e.name : 'Unknown',
					stack: e instanceof Error ? e.stack : undefined,
				},
			}, `Error occurred while processing URL: ${url}`);

			return reply.status(500).send({
				error: {
					message: e instanceof Error ? e.message : String(e),
					name: e instanceof Error ? e.name : 'Unknown',
				},
			});
		}
	});

	fastify.get('/health', async (req, reply) => {
		return reply.status(200).send({
			status: 'ok',
			timestamp: new Date().toISOString(),
		});
	});

	done();
}
