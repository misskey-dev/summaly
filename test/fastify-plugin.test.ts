// Derived from misskey-dev/summaly (MIT)
import Fastify from 'fastify';
import { afterEach, describe, expect, test } from 'vitest';
import summalyPlugin from '@/index.js';
import { startTestServer, type TestServer } from './helpers/test-server.js';

const allowedPrivateNetworks = ['127.0.0.0/8', '::1/128'];

const servers: TestServer[] = [];
const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
	await Promise.all(apps.splice(0).map(a => a.close()));
	await Promise.all(servers.splice(0).map(s => s.close()));
});

async function setup() {
	// The plugin uses the default cached summaly instance, so every test uses its own URL path.
	const server = await startTestServer((req, res) => {
		if (req.url?.startsWith('/missing')) {
			res.statusCode = 404;
			res.end('not found');
			return;
		}
		res.setHeader('content-type', 'text/html');
		res.end('<html><head><title>Plugin Title</title></head><body></body></html>');
	});
	servers.push(server);
	const app = Fastify();
	apps.push(app);
	await app.register(summalyPlugin, { allowedPrivateNetworks });
	return { app, origin: server.url.replace(/\/$/, '') };
}

describe('fastify plugin', () => {
	test('returns 400 without url', async () => {
		const { app } = await setup();
		const res = await app.inject({ method: 'GET', url: '/' });
		expect(res.statusCode).toBe(400);
		expect(res.json()).toEqual({ error: 'url is required' });
	});

	test('returns 500 with the status code when fetching fails', async () => {
		const { app, origin } = await setup();
		const res = await app.inject({ method: 'GET', url: '/', query: { url: `${origin}/missing-plugin` } });
		expect(res.statusCode).toBe(500);
		expect(res.json().error.statusCode).toBe(404);
	});

	test('returns the summary', async () => {
		const { app, origin } = await setup();
		const res = await app.inject({ method: 'GET', url: '/', query: { url: `${origin}/ok-plugin` } });
		expect(res.statusCode).toBe(200);
		expect(res.json().title).toBe('Plugin Title');
	});
});
