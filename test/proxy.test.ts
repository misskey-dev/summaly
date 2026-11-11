import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createProxyAgents, selectProxyUrl, TunnelingHttpAgent, TunnelingHttpsAgent } from '@/http/proxy.js';
import { fetchResponse, type FetchRequest } from '@/http/request.js';
import { StatusError } from '@/http/status-error.js';
import { createTransport } from '@/http/transport.js';
import type { ProxyOptions } from '@/types.js';
import { startTestServer } from './helpers/test-server.js';
import { TEST_CERT, TEST_CERT_HOST, TEST_KEY } from './helpers/tls-cert.js';

type TestProxy = {
	url: string;
	/** Number of requests (CONNECT or otherwise) the proxy received */
	received(): number;
	/** The authority (request target) of each CONNECT the proxy received, in order */
	connects: string[];
	/** The Proxy-Authorization header of each CONNECT, in order */
	authorizations: (string | undefined)[];
	/** Number of client and upstream sockets still open */
	open(): number;
	close(): Promise<void>;
};

/**
 * Minimal forward proxy on 127.0.0.1. Targets are tunneled with CONNECT, so CONNECT is relayed
 * (or answered with 502 when `relay` is false); any other request is only counted and answered with 501.
 */
function startTestProxy({ relay = true } = {}): Promise<TestProxy> {
	let received = 0;
	const connects: string[] = [];
	const authorizations: (string | undefined)[] = [];
	const sockets = new Set<net.Socket>();
	const server = http.createServer((_req, res) => {
		received++;
		res.writeHead(501);
		res.end();
	});
	server.on('connect', (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
		received++;
		connects.push(req.url ?? '');
		authorizations.push(req.headers['proxy-authorization']);
		sockets.add(client);
		client.on('close', () => sockets.delete(client));
		if (!relay) {
			client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
			return;
		}
		const { hostname, port } = new URL(`http://${req.url}`);
		const upstream = net.connect(Number(port), hostname.replace(/^\[|\]$/g, ''), () => {
			client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
			upstream.write(head);
			upstream.pipe(client);
			client.pipe(upstream);
		});
		sockets.add(upstream);
		upstream.on('close', () => sockets.delete(upstream));
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
				connects,
				authorizations,
				open: () => sockets.size,
				close: () => new Promise<void>((done, fail) => {
					for (const s of sockets) s.destroy();
					server.close(err => (err ? fail(err) : done()));
					server.closeAllConnections();
				}),
			});
		});
	});
}

type HangingProxy = {
	url: string;
	/** Number of TCP connections accepted */
	accepted(): number;
	/** Number of accepted connections that are still open */
	open(): number;
	close(): Promise<void>;
};

/** Accepts TCP connections and reads the CONNECT request, but never answers it. */
function startHangingProxy(): Promise<HangingProxy> {
	let accepted = 0;
	const sockets = new Set<net.Socket>();
	const server = net.createServer(socket => {
		accepted++;
		sockets.add(socket);
		socket.on('error', () => {});
		socket.on('close', () => sockets.delete(socket));
		socket.resume();
	});
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as AddressInfo;
			resolve({
				url: `http://127.0.0.1:${port}`,
				accepted: () => accepted,
				open: () => sockets.size,
				close: () => new Promise<void>((done, fail) => {
					for (const s of sockets) s.destroy();
					server.close(err => (err ? fail(err) : done()));
				}),
			});
		});
	});
}

/** Polls `condition` until it holds or `ms` passes. */
async function waitFor(condition: () => boolean, ms = 1000): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (!condition()) {
		if (Date.now() > deadline) return false;
		await new Promise(r => setTimeout(r, 10));
	}
	return true;
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
	await Promise.all(closers.splice(0).map(close => close()));
});

async function proxy(options?: { relay?: boolean }): Promise<TestProxy> {
	const p = await startTestProxy(options);
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
	test('scheme ごとにトンネル用の agent を作る', () => {
		const agents = createProxyAgents({ http: 'http://p:3128', https: 'http://p:8080' });
		expect(agents.http).toBeInstanceOf(TunnelingHttpAgent);
		expect(agents.https).toBeInstanceOf(TunnelingHttpsAgent);
	});

	test('指定のない scheme には作らない', () => {
		expect(createProxyAgents({ https: 'http://p:8080' })).toEqual({ https: expect.any(TunnelingHttpsAgent) });
		expect(createProxyAgents({ http: '' })).toEqual({});
	});
});

describe('createTransport with proxy', () => {
	test('プロキシ用 agent は transport.agents に入れず、guard は残す', () => {
		const t = createTransport({ proxy: { http: 'http://p:3128', https: 'http://p:8080' } }, {});
		expect(t.agents).toEqual({});
		expect(t.guard).not.toBeNull();
		expect(t.proxyAgents.http).toBeInstanceOf(TunnelingHttpAgent);
		expect(t.proxyAgents.https).toBeInstanceOf(TunnelingHttpsAgent);
	});

	test('agent を渡した scheme ではプロキシ設定を使わない', () => {
		const agent = new http.Agent();
		const t = createTransport({ agent: { http: agent }, proxy: { http: 'http://p:3128', https: 'http://p:8080' } }, {});
		expect(t.agents.http).toBe(agent);
		expect(t.proxyAgents.http).toBeUndefined();
		expect(t.proxyAgents.https).toBeInstanceOf(TunnelingHttpsAgent);
		expect(t.proxy).toEqual({ https: 'http://p:8080' });
	});

	test.each([
		['proxy.local:3128'],
		['socks5://p:1080'],
		['http://'],
		['file:///tmp/proxy'],
		['not a url'],
	])('http/https 以外やホスト名のないプロキシ URL は TypeError (%s)', value => {
		for (const scheme of ['http', 'https'] as const) {
			expect(() => createTransport({ proxy: { [scheme]: value } }, {})).toThrow(TypeError);
			expect(() => createTransport({ proxy: { [scheme]: value } }, {})).toThrow(value);
		}
	});

	test('プロキシ URL の検証は agent を渡した scheme にも効く', () => {
		expect(() => createTransport({ agent: { http: new http.Agent() }, proxy: { http: 'socks5://p:1080' } }, {})).toThrow(TypeError);
	});

	test('不正なプロキシ URL のエラーにはパスワードを載せない', () => {
		expect(() => createTransport({ proxy: { http: 'socks5://u:secret@p:1080' } }, {})).toThrow(/^(?!.*secret).*socks5:\/\/u:\*\*\*@p:1080/);
	});

	test.each([
		[{ http: 'http://p:3128' }],
		[{ https: 'https://p:8443' }],
		[{ http: 'http://user:pw@p:3128', https: 'http://[2001:db8::1]:8080' }],
		[{ http: '', https: '' }],
	])('http/https のプロキシ URL は受け付ける (%o)', proxy => {
		expect(() => createTransport({ proxy }, {})).not.toThrow();
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

describe('fetchResponse through a proxy: timeouts', () => {
	async function hanging(): Promise<HangingProxy> {
		const p = await startHangingProxy();
		closers.push(p.close);
		return p;
	}

	test.each(['http', 'https'])('CONNECT に応答しないプロキシでも operationTimeout で打ち切り、ソケットを閉じる (%s)', async scheme => {
		const p = await hanging();
		const transport = createTransport({ allowedPrivateNetworks: ['127.0.0.0/8'], proxy: { [scheme]: p.url } }, {});
		const started = Date.now();
		const e = await fetchResponse(transport, { ...request(`${scheme}://127.0.0.1:9/`), responseTimeout: 0, operationTimeout: 300 }).catch(e => e);
		expect(Date.now() - started).toBeLessThan(1000);
		expect(e).toBeInstanceOf(Error);
		expect(e.message).toContain("Timeout awaiting 'request' for 300ms");
		expect(p.accepted()).toBe(1);
		expect(await waitFor(() => p.open() === 0)).toBe(true);
	});

	test.each(['http', 'https'])('CONNECT に応答しないプロキシは responseTimeout で打ち切り、ソケットを閉じる (%s)', async scheme => {
		const p = await hanging();
		const transport = createTransport({ allowedPrivateNetworks: ['127.0.0.0/8'], proxy: { [scheme]: p.url } }, {});
		const started = Date.now();
		const e = await fetchResponse(transport, { ...request(`${scheme}://127.0.0.1:9/`), responseTimeout: 300, operationTimeout: 60000 }).catch(e => e);
		expect(Date.now() - started).toBeLessThan(1000);
		expect(e).toBeInstanceOf(Error);
		expect(e.message).toContain('300ms');
		expect(p.accepted()).toBe(1);
		expect(await waitFor(() => p.open() === 0)).toBe(true);
	});
});

describe('fetchResponse through a proxy: CONNECT authority', () => {
	/** Resolves the given names in `assertHostAllowed` (dns.promises.lookup); other names resolve normally. */
	function fakeDns(records: Record<string, { address: string; family: number }[]>) {
		const original = dns.promises.lookup.bind(dns.promises);
		const spy = vi.spyOn(dns.promises, 'lookup').mockImplementation(((hostname: string, options: any) =>
			hostname in records ? Promise.resolve(records[hostname]) : original(hostname, options)) as any);
		closers.push(async () => spy.mockRestore());
		return spy;
	}

	test('ホスト名の宛先は、検証した IP アドレスで CONNECT し、Host ヘッダは元のホスト名のまま', async () => {
		const lookup = fakeDns({ 'proxied.test': [{ address: '127.0.0.1', family: 4 }] });
		const p = await proxy();
		let host: string | undefined;
		const server = await serve((req, res) => {
			host = req.headers.host;
			res.end('via ip');
		});
		const { port } = new URL(server.url);
		const transport = createTransport({ allowedPrivateNetworks: ['127.0.0.0/8'], proxy: { http: p.url } }, {});
		const result = await fetchResponse(transport, request(`http://proxied.test:${port}/`));
		expect(result.body.toString()).toBe('via ip');
		expect(p.connects).toEqual([`127.0.0.1:${port}`]);
		expect(host).toBe(`proxied.test:${port}`);
		// Resolved once, by the guard check
		expect(lookup.mock.calls.filter(([h]) => h === 'proxied.test')).toHaveLength(1);
	});

	test('IPv6 リテラルの宛先は角括弧付きで CONNECT する', async () => {
		const p = await proxy({ relay: false });
		const transport = createTransport({ allowedPrivateNetworks: ['2001:db8::/32'], proxy: { http: p.url, https: p.url } }, {});
		await expect(fetchResponse(transport, request('http://[2001:db8::1]:8080/'))).rejects.toThrow('502');
		await expect(fetchResponse(transport, request('https://[2001:db8::1]/'))).rejects.toThrow('502');
		expect(p.connects).toEqual(['[2001:db8::1]:8080', '[2001:db8::1]:443']);
	});

	test('IPv6 アドレスに解決されたホスト名も角括弧付きで CONNECT する', async () => {
		fakeDns({ 'v6.test': [{ address: '2001:db8::2', family: 6 }] });
		const p = await proxy({ relay: false });
		const transport = createTransport({ allowedPrivateNetworks: ['2001:db8::/32'], proxy: { https: p.url } }, {});
		await expect(fetchResponse(transport, request('https://v6.test/'))).rejects.toThrow('502');
		expect(p.connects).toEqual(['[2001:db8::2]:443']);
	});

	test('プロキシ URL の認証情報を Proxy-Authorization で送る', async () => {
		const p = await proxy({ relay: false });
		const proxyUrl = p.url.replace('http://', 'http://user:p%40ss@');
		const transport = createTransport({ allowedPrivateNetworks: ['127.0.0.0/8'], proxy: { http: proxyUrl } }, {});
		await expect(fetchResponse(transport, request('http://127.0.0.1:9/'))).rejects.toThrow('502');
		expect(p.authorizations).toEqual([`Basic ${Buffer.from('user:p@ss').toString('base64')}`]);
	});

	test('guard が無効なら宛先を自分で解決せず、ホスト名のままプロキシに渡す', async () => {
		const lookup = fakeDns({});
		const p = await proxy({ relay: false });
		const transport = createTransport({ proxy: { http: p.url } }, { SUMMALY_ALLOW_PRIVATE_IP: 'true' });
		await expect(fetchResponse(transport, request('http://only-the-proxy-knows.test/'))).rejects.toThrow('502');
		expect(p.connects).toEqual(['only-the-proxy-knows.test:80']);
		expect(lookup).not.toHaveBeenCalled();
	});

	test('https の宛先は IP へトンネルしつつ、SNI・証明書検証・Host にはホスト名を使う', async () => {
		fakeDns({ [TEST_CERT_HOST]: [{ address: '127.0.0.1', family: 4 }] });
		const p = await proxy();
		let host: string | undefined;
		let servername: string | false | null | undefined;
		const server = https.createServer({ cert: TEST_CERT, key: TEST_KEY }, (req, res) => {
			host = req.headers.host;
			servername = (req.socket as import('node:tls').TLSSocket).servername;
			res.end('via tls');
		});
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		closers.push(() => new Promise<void>(done => {
			server.close(() => done());
			server.closeAllConnections();
		}));
		const { port } = server.address() as AddressInfo;
		const url = `https://${TEST_CERT_HOST}:${port}/`;

		// The certificate names only the host name, so verification fails unless it uses the host name
		const transport = createTransport({ allowedPrivateNetworks: ['127.0.0.0/8'], proxy: { https: p.url } }, {});
		(transport.proxyAgents.https as https.Agent).options.ca = TEST_CERT;
		const result = await fetchResponse(transport, request(url));
		expect(result.body.toString()).toBe('via tls');
		expect(p.connects).toEqual([`127.0.0.1:${port}`]);
		expect(host).toBe(`${TEST_CERT_HOST}:${port}`);
		expect(servername).toBe(TEST_CERT_HOST);

		// Certificate verification stays on: without the test CA the self-signed certificate is rejected
		const untrusted = createTransport({ allowedPrivateNetworks: ['127.0.0.0/8'], proxy: { https: p.url } }, {});
		await expect(fetchResponse(untrusted, request(url))).rejects.toThrow(/self[- ]signed/);
		// Both tunnels are torn down (keepAlive off; the failed TLS handshake closes its tunnel)
		expect(await waitFor(() => p.open() === 0)).toBe(true);
	});
});
