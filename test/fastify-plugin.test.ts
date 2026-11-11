// Derived from misskey-dev/summaly (MIT)
import Fastify from 'fastify';
import { afterEach, describe, expect, test } from 'vitest';
import summaryPlugin from '@/index.js';
import { startTestServer, type TestServer } from './helpers/test-server.js';

const allowedPrivateNetworks = ['127.0.0.0/8', '::1/128'];

const servers: TestServer[] = [];
const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
	await Promise.all(apps.splice(0).map(a => a.close()));
	await Promise.all(servers.splice(0).map(s => s.close()));
});

async function setup(pluginOptions: Record<string, unknown> = {}) {
	// The plugin uses the default cached summarize instance, so every test uses its own URL path.
	const server = await startTestServer((req, res) => {
		if (req.url?.startsWith('/missing')) {
			res.statusCode = 404;
			res.end('not found');
			return;
		}
		if (req.url?.startsWith('/redir')) {
			res.statusCode = 302;
			res.setHeader('location', '/target-page');
			res.end();
			return;
		}
		if (req.url?.startsWith('/target-page')) {
			res.setHeader('content-type', 'text/html');
			res.end('<html><head><title>Redirect Target</title></head><body></body></html>');
			return;
		}
		if (req.url?.startsWith('/echo-lang')) {
			res.setHeader('content-type', 'text/html');
			res.end(`<html><head><title>lang:${req.headers['accept-language']}</title></head><body></body></html>`);
			return;
		}
		res.setHeader('content-type', 'text/html');
		res.end('<html><head><title>Plugin Title</title></head><body></body></html>');
	});
	servers.push(server);
	const app = Fastify();
	apps.push(app);
	await app.register(summaryPlugin, { allowedPrivateNetworks, ...pluginOptions });
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

	test('does not follow redirects by default', async () => {
		const { app, origin } = await setup();
		const res = await app.inject({ method: 'GET', url: '/', query: { url: `${origin}/redir-default` } });
		expect(JSON.stringify(res.json())).not.toContain('Redirect Target');
	});

	test('forwards the lang query as accept-language', async () => {
		const { app, origin } = await setup();
		const res = await app.inject({ method: 'GET', url: '/', query: { url: `${origin}/echo-lang-1`, lang: 'ja-JP' } });
		expect(res.statusCode).toBe(200);
		expect(res.json().title).toContain('lang:ja-JP');
	});

	test('plugin options override the defaults', async () => {
		const { app, origin } = await setup({ followRedirects: true });
		const res = await app.inject({ method: 'GET', url: '/', query: { url: `${origin}/redir-follow` } });
		expect(res.statusCode).toBe(200);
		expect(res.json().title).toBe('Redirect Target');
	});
});
