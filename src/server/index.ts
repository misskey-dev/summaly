// Derived from misskey-dev/summaly (MIT)
/**
 * Standalone chiramiss server (summaly-compatible)
 * Configured via environment variables (see README.md)
 */

import process from 'node:process';
import { buildApp } from './app.js';
import { ServerConfigError, loadServerConfig, type ServerConfig } from './config.js';

async function main(): Promise<void> {
	let config: ServerConfig;

	try {
		config = loadServerConfig(process.env);
	} catch (err) {
		if (err instanceof ServerConfigError) {
			console.error(`[chiramiss] ${err.message}`);
		} else {
			console.error(err);
		}
		process.exit(1);
	}

	const fastify = buildApp(config, {}, { logger: true });

	let closing = false;

	// A response sent during shutdown closes its connection: otherwise a keep-alive client's socket, idle once the
	// in-flight request is answered, would hold fastify.close() open until the keep-alive timeout.
	fastify.addHook('onSend', async (_request, reply) => {
		if (closing) {
			reply.header('connection', 'close');
		}
	});
	const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
		if (closing) {
			return;
		}
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
