/**
 * Standalone summaly server
 * Configured via environment variables (see README.md)
 */

import process from 'node:process';
import Fastify from 'fastify';
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

	const fastify = Fastify({ logger: true });
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
