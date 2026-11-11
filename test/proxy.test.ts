import http from 'node:http';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent';
import { afterEach, describe, expect, test } from 'vitest';
import { createProxyAgents, selectProxyUrl } from '@/http/proxy.js';
import { fetchResponse, type FetchRequest } from '@/http/request.js';
import { StatusError } from '@/http/status-error.js';
import { createTransport } from '@/http/transport.js';
import type { ProxyOptions } from '@/types.js';
import { startTestServer } from './helpers/test-server.js';

type TestProxy = {
	url: string;
	/** Number of requests (CONNECT or otherwise) the proxy received */
	received(): number;
	close(): Promise<void>;
};

/**
 * Minimal forward proxy on 127.0.0.1. hpagent tunnels both http and https targets with CONNECT,
 * so CONNECT is relayed; any other request is only counted and answered with 501.
 */
function startTestProxy(): Promise<TestProxy> {
	let received = 0;
	const sockets = new Set<net.Socket>();
	const server = http.createServer((_req, res) => {
		received++;
		res.writeHead(501);
		res.end();
	});
	server.on('connect', (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
		received++;
		const { hostname, port } = new URL(`http://${req.url}`);
		const upstream = net.connect(Number(port), hostname.replace(/^\[|\]$/g, ''), () => {
			client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
			upstream.write(head);
			upstream.pipe(client);
			client.pipe(upstream);
		});
		sockets.add(client).add(upstream);
		const cleanup = () => {
			client.destroy();
			upstream.destroy();
		};
		client.on('error', cleanup).on('close', cleanup);
		upstream.on('error', cleanup).on('close', cleanup);
	});
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as AddressInfo;
			resolve({
				url: `http://127.0.0.1:${port}`,
				received: () => received,
				close: () => new Promise<void>((done, fail) => {
					for (const s of sockets) s.destroy();
					server.close(err => (err ? fail(err) : done()));
					server.closeAllConnections();
				}),
			});
		});
	});
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
	await Promise.all(closers.splice(0).map(close => close()));
});

async function proxy(): Promise<TestProxy> {
	const p = await startTestProxy();
	closers.push(p.close);
	return p;
}

async function serve(handler: http.RequestListener, host?: string) {
	const server = await startTestServer(handler, host);
	closers.push(server.close);
	return server;
}

function request(url: string): FetchRequest {
	return {
		url,
		method: 'GET',
		headers: { accept: 'text/html' },
		followRedirects: true,
		responseTimeout: 20000,
		operationTimeout: 60000,
		contentLengthLimit: 10 * 1024 * 1024,
		contentLengthRequired: false,
	};
}

describe('selectProxyUrl', () => {
	test.each<[string, ProxyOptions, string | null]>([
		['https://a.example.com/', { https: 'http://p:8080' }, 'http://p:8080'],
		['http://a.example.com/', { https: 'http://p:8080' }, null],
		['https://a.example.com/', { https: 'http://p:8080', noProxy: '.example.com' }, null],
		['https://example.com/', { https: 'http://p:8080', noProxy: 'example.com' }, null],
		['https://a.example.org/', { https: 'http://p:8080', noProxy: 'example.com' }, 'http://p:8080'],
		['https://a.example.com/', { https: 'http://p:8080', noProxy: '*' }, null],
	])('selectProxyUrl(%s)', (u, p, expected) => expect(selectProxyUrl(new URL(u), p)).toBe(expected));

	test.each<[string, ProxyOptions, string | null]>([
		['http://a.example.com/', { http: 'http://p:3128' }, 'http://p:3128'],
		// A leading dot also matches the domain itself
		['https://example.com/', { https: 'http://p:8080', noProxy: '.example.com' }, null],
		// Suffix match is on label boundaries
		['https://badexample.com/', { https: 'http://p:8080', noProxy: 'example.com' }, 'http://p:8080'],
		// Comma separated, whitespace and case tolerant
		['https://b.example.net/', { https: 'http://p:8080', noProxy: 'example.com, EXAMPLE.NET ,' }, null],
		// host:port matches only that port (default ports included)
		['https://example.com/', { https: 'http://p:8080', noProxy: 'example.com:443' }, null],
		['https://example.com:8443/', { https: 'http://p:8080', noProxy: 'example.com:443' }, 'http://p:8080'],
		['http://example.com:8080/', { http: 'http://p:8080', noProxy: 'example.com:8080' }, null],
		// IP literals
		['http://10.0.0.1/', { http: 'http://p:8080', noProxy: '10.0.0.1' }, null],
		['http://[::1]:8080/', { http: 'http://p:8080', noProxy: '::1' }, null],
		['http://[::1]:8080/', { http: 'http://p:8080', noProxy: '[::1]:8080' }, null],
		['http://[::1]:8081/', { http: 'http://p:8080', noProxy: '[::1]:8080' }, 'http://p:8080'],
		// Empty proxy URL (e.g. HTTPS_PROXY= ) means no proxy
		['https://a.example.com/', { https: '' }, null],
		['https://a.example.com/', { https: 'http://p:8080', noProxy: '' }, 'http://p:8080'],
	])('selectProxyUrl(%s, %o)', (u, p, expected) => expect(selectProxyUrl(new URL(u), p)).toBe(expected));
});

describe('createProxyAgents', () => {
	test('scheme ごとに hpagent の agent を作る', () => {
		const agents = createProxyAgents({ http: 'http://p:3128', https: 'http://p:8080' });
		expect(agents.http).toBeInstanceOf(HttpProxyAgent);
		expect(agents.https).toBeInstanceOf(HttpsProxyAgent);
	});

	test('指定のない scheme には作らない', () => {
		expect(createProxyAgents({ https: 'http://p:8080' })).toEqual({ https: expect.any(HttpsProxyAgent) });
		expect(createProxyAgents({ http: '' })).toEqual({});
	});
});

describe('createTransport with proxy', () => {
	test('プロキシ用 agent は transport.agents に入れず、guard は残す', () => {
		const t = createTransport({ proxy: { http: 'http://p:3128', https: 'http://p:8080' } }, {});
		expect(t.agents).toEqual({});
		expect(t.guard).not.toBeNull();
		expect(t.proxyAgents.http).toBeInstanceOf(HttpProxyAgent);
		expect(t.proxyAgents.https).toBeInstanceOf(HttpsProxyAgent);
	});

	test('agent を渡した scheme ではプロキシ設定を使わない', () => {
		const agent = new http.Agent();
		const t = createTransport({ agent: { http: agent }, proxy: { http: 'http://p:3128', https: 'http://p:8080' } }, {});
		expect(t.agents.http).toBe(agent);
		expect(t.proxyAgents.http).toBeUndefined();
		expect(t.proxyAgents.https).toBeInstanceOf(HttpsProxyAgent);
		expect(t.proxy).toEqual({ https: 'http://p:8080' });
	});
});

describe('fetchResponse through a proxy', () => {
	test('http プロキシ経由で取得できる', async () => {
		const p = await proxy();
		const server = await serve((_req, res) => {
			res.writeHead(200, { 'content-type': 'text/html' });
			res.end('via proxy');
		});
		const transport = createTransport({ allowedPrivateNetworks: ['127.0.0.0/8'], proxy: { http: p.url } }, {});
		const result = await fetchResponse(transport, request(server.url));
		expect(p.received()).toBeGreaterThan(0);
		expect(result.body.toString()).toBe('via proxy');
	});

	test('プロキシ経由でも宛先がプライベート IP なら、プロキシに要求を送る前に拒否する', async () => {
		const p = await proxy();
		let hits = 0;
		const server = await serve((_req, res) => {
			hits++;
			res.end('secret');
		});
		const transport = createTransport({ proxy: { http: p.url } }, {});
		const e = await fetchResponse(transport, request(server.url)).catch(e => e);
		expect(e).toBeInstanceOf(StatusError);
		expect(e.statusCode).toBe(400);
		expect(p.received()).toBe(0);
		expect(hits).toBe(0);
	});

	test('プロキシ経由でもリダイレクト先がプライベート IP なら、プロキシに要求を送る前に拒否する', async ({ skip }) => {
		const p = await proxy();
		let targetHits = 0;
		const target = await serve((_req, res) => {
			targetHits++;
			res.end('secret');
		}, '127.0.0.1');
		const origin = await serve((_req, res) => {
			res.writeHead(302, { location: `http://127.0.0.1:${new URL(target.url).port}/` });
			res.end();
		}, '127.0.0.2').catch((e: NodeJS.ErrnoException) => {
			if (e.code === 'EADDRNOTAVAIL') {
				skip('cannot bind 127.0.0.2 on this host (e.g. macOS has no 127.0.0.0/8 loopback aliases); covered on Linux CI');
			}
			throw e;
		});
		const transport = createTransport({ allowedPrivateNetworks: ['127.0.0.2/32'], proxy: { http: p.url } }, {});
		const e = await fetchResponse(transport, request(origin.url)).catch(e => e);
		expect(e).toBeInstanceOf(StatusError);
		expect(e.statusCode).toBe(400);
		// Only the first hop reached the proxy
		expect(p.received()).toBe(1);
		expect(targetHits).toBe(0);
	});

	test('noProxy に当たる宛先には直接つなぐ（guard も効く）', async () => {
		const p = await proxy();
		const server = await serve((_req, res) => {
			res.end('direct');
		});
		const transport = createTransport({ allowedPrivateNetworks: ['127.0.0.0/8'], proxy: { http: p.url, noProxy: '127.0.0.1' } }, {});
		const result = await fetchResponse(transport, request(server.url));
		expect(result.body.toString()).toBe('direct');
		expect(p.received()).toBe(0);

		const guarded = createTransport({ proxy: { http: p.url, noProxy: '127.0.0.1' } }, {});
		const e = await fetchResponse(guarded, request(server.url)).catch(e => e);
		expect(e).toBeInstanceOf(StatusError);
		expect(e.statusCode).toBe(400);
	});

	test('agent を渡した場合はプロキシ設定を無視する', async () => {
		const p = await proxy();
		const server = await serve((_req, res) => {
			res.end('via caller agent');
		});
		const agent = new http.Agent();
		let calls = 0;
		const original = agent.createConnection.bind(agent);
		agent.createConnection = ((...args: Parameters<typeof original>) => {
			calls++;
			return original(...args);
		}) as typeof agent.createConnection;
		const transport = createTransport({ agent: { http: agent }, proxy: { http: p.url } }, {});
		const result = await fetchResponse(transport, request(server.url));
		agent.destroy();
		expect(result.body.toString()).toBe('via caller agent');
		expect(calls).toBeGreaterThan(0);
		expect(p.received()).toBe(0);
	});
});
