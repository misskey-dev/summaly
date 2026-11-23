/**
 * Standalone summaly server
 * Configured via environment variables (see README.md)
 */

import { randomUUID } from 'node:crypto';
import process from 'node:process';
import Fastify, { LogController, type FastifyRequest } from 'fastify';
import summaly from '@/index.js';
import { ServerConfigError, loadServerConfig, type ServerConfig } from '@/server/config.js';

async function main(): Promise<void> {
	let config: ServerConfig;
	try {
		config = loadServerConfig(process.env);
	} catch (err) {
		if (err instanceof ServerConfigError) {
			console.error(`[summaly] ${err.message}`);
		} else {
			console.error(err);
		}
		process.exit(1);
	}

	const fastify = Fastify({
		// Use the X-Request-ID header (e.g. set by the ingress) if any, so that the logs can be matched with those of the caller
		requestIdHeader: 'x-request-id',
		genReqId: () => randomUUID(),
		logController: new LogController({ requestIdLogLabel: 'requestId' }),
		logger: {
			level: process.env.LOG_LEVEL ?? 'info',
			formatters: {
				level: (label) => ({ level: label }),
			},
			serializers: {
				// Fastify passes its own request object, though the type says the raw request
				req: (raw) => {
					const req = raw as unknown as FastifyRequest;
					return {
						method: req.method,
						url: req.url,
						query: req.query,
						userAgent: req.headers['user-agent'],
						ip: req.ip,
					};
				},
			},
			transport: process.env.NODE_ENV !== 'production' ? {
				target: 'pino-pretty',
				options: {
					colorize: true,
					translateTime: 'SYS:standard',
					ignore: 'pid,hostname',
				},
			} : undefined,
		},
	});
	await fastify.register(summaly, config.summalyOptions);

	let closing = false;
	const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
		if (closing) return;
		closing = true;
		fastify.log.info(`Received ${signal}, shutting down`);
		try {
			await fastify.close();
		} catch (err) {
			fastify.log.error(err);
			process.exit(1);
		}
		process.exit(0);
	};
	process.once('SIGINT', (signal) => void shutdown(signal));
	process.once('SIGTERM', (signal) => void shutdown(signal));

	try {
		await fastify.listen({ host: config.host, port: config.port });
	} catch (err) {
		fastify.log.error(err);
		process.exit(1);
	}
}

main().catch((err: unknown) => {
	console.error(err);
	process.exit(1);
});
