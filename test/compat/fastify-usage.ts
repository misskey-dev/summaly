// How a Fastify app mounts summaly (@misskey-dev/summaly/fastify).
// Checked against built/fastify.d.ts by `pnpm typecheck:compat`.
import Fastify from 'fastify';
import { InProcessCoordinator } from '../../built/cache.js';
import { fastifySummaly } from '../../built/fastify.js';
import type { SummalyFastifyOptions } from '../../built/fastify.js';

const options: SummalyFastifyOptions = {
	lang: 'ja-JP',
	contentLengthLimit: 10 * 1024 * 1024,
	coordinator: new InProcessCoordinator(),
};

export async function start(): Promise<void> {
	const app = Fastify();

	await app.register(fastifySummaly, options);
	await app.register(fastifySummaly, { ...options, prefix: '/summary' });
	await app.listen({ port: 3000 });
}
