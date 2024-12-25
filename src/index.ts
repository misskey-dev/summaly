/**
 * summaly
 * https://github.com/misskey-dev/summaly
 */

import { got, type Agents as GotAgents } from 'got';
import type { FastifyInstance } from 'fastify';
import { SummalyResult } from '@/summary.js';
import { SummalyPlugin as _SummalyPlugin } from '@/iplugin.js';
import { parseGeneral, type GeneralScrapingOptions } from '@/general.js';
import { DEFAULT_OPERATION_TIMEOUT, DEFAULT_RESPONSE_TIMEOUT, agent, setAgent } from '@/utils/got.js';
import { plugins as builtinPlugins } from '@/plugins/index.js';

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
};

export const summalyDefaultOptions = {
	lang: null,
	followRedirects: true,
	plugins: [],
} as SummalyOptions;

/**
 * Summarize an web page
 */
export const summaly = async (url: string, options?: SummalyOptions): Promise<SummalyResult> => {
	if (options?.agent) setAgent(options.agent);

	const opts = Object.assign(summalyDefaultOptions, options);

	const plugins = builtinPlugins.concat(opts.plugins || []);

	let actualUrl = url;
	if (opts.followRedirects) {
		// .catch(() => url)にすればいいけど、jestにtrace-redirectを食わせるのが面倒なのでtry-catch
		try {
			const timeout = opts.responseTimeout ?? DEFAULT_RESPONSE_TIMEOUT;
			const operationTimeout = opts.operationTimeout ?? DEFAULT_OPERATION_TIMEOUT;
			actualUrl = await got
				.head(url, {
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
		} catch (e) {
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
		operationTimeout: opts.operationTimeout,
		contentLengthLimit: opts.contentLengthLimit,
		contentLengthRequired: opts.contentLengthRequired,
	};

	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	const summary = await (match ? match.summarize : parseGeneral)(_url, scrapingOptions);

	if (summary == null) {
		throw new Error('failed summarize');
	}

	return Object.assign(summary, {
		url: actualUrl,
	});
};

// eslint-disable-next-line import/no-default-export
export default function (fastify: FastifyInstance, options: SummalyOptions, done: (err?: Error) => void) {
	fastify.get<{
		Querystring: {
			url?: string;
			lang?: string;
		};
	}>('/', async (req, reply) => {
		const url = req.query.url as string;
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		if (url == null) {
			return reply.status(400).send({
				error: 'url is required',
			});
		}

		reply.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=43200, immutable');

		try {
			const summary = await summaly(url, {
				lang: req.query.lang as string,
				followRedirects: false,
				...options,
			});

			return summary;
		} catch (e) {
			return reply.status(500).send({
				error: e,
			});
		}
	});

	done();
}
