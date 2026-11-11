import http from 'node:http';
import https from 'node:https';
import type { AddressInfo, Socket } from 'node:net';
import tls from 'node:tls';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { createSummarizer } from '@/index.js';
import type { SummaryPlugin } from '@/types.js';
import { LOOPBACK_CERT, LOOPBACK_KEY } from './helpers/tls-cert.js';

const PAGE = '<!doctype html><html><head><title>page</title><link rel="icon" href="/favicon.ico"></head><body>body</body></html>';

/** followRedirects is left at its default (true): HEAD for the final URL, GET for the page, HEAD for the favicon. */
const summarize = createSummarizer({ cache: false, coordinator: false, allowedPrivateNetworks: ['127.0.0.0/8'] });

type Origin = {
	url: string;
	/** TCP connections accepted so far */
	connections: () => number;
	/** `METHOD path` of each request, grouped by the socket it came on */
	requestsBySocket: () => string[][];
	/** Connections still open on the server side */
	open: () => Promise<number>;
	close: () => Promise<void>;
};

const origins: Origin[] = [];
afterEach(async () => {
	await Promise.all(origins.splice(0).map(o => o.close()));
});

// The https origin uses a self-signed certificate for 127.0.0.1; trust it the way a deployment would add a CA.
const originalCAs = tls.getCACertificates('default');
beforeAll(() => {
	tls.setDefaultCACertificates([...originalCAs, LOOPBACK_CERT]);
});
afterAll(() => {
	tls.setDefaultCACertificates(originalCAs);
});

async function startOrigin(scheme: 'http' | 'https', host = '127.0.0.1', handler?: http.RequestListener): Promise<Origin> {
	const bySocket = new Map<Socket, string[]>();
	let connections = 0;
	const listener: http.RequestListener = (req, res) => {
		const list = bySocket.get(req.socket) ?? [];
		list.push(`${req.method} ${req.url}`);
		bySocket.set(req.socket, list);
		if (handler) {
			handler(req, res);
			return;
		}
		if (req.url === '/favicon.ico') {
			res.writeHead(200, { 'content-type': 'image/x-icon', 'content-length': '4' });
			res.end(req.method === 'HEAD' ? undefined : 'icon');
			return;
		}
		const body = Buffer.from(PAGE);
		res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(body.length) });
		res.end(req.method === 'HEAD' ? undefined : body);
	};
	const server = scheme === 'https'
		? https.createServer({ cert: LOOPBACK_CERT, key: LOOPBACK_KEY }, listener)
		: http.createServer(listener);
	server.on('connection', () => connections++);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, host, () => resolve());
	});
	const { port } = server.address() as AddressInfo;
	const origin: Origin = {
		url: `${scheme}://${host}:${port}/`,
		connections: () => connections,
		requestsBySocket: () => [...bySocket.values()],
		open: () => new Promise((resolve, reject) => server.getConnections((err, n) => (err ? reject(err) : resolve(n)))),
		close: () => new Promise<void>(resolve => {
			server.close(() => resolve());
			server.closeAllConnections();
		}),
	};
	origins.push(origin);
	return origin;
}

/** Waits until the client side has closed every connection to `origin`. */
async function expectAllClosed(origin: Origin): Promise<void> {
	await vi.waitFor(async () => expect(await origin.open()).toBe(0), { timeout: 1000, interval: 10 });
}

describe.each(['http', 'https'] as const)('1回の要約の中で接続を再利用する (%s)', scheme => {
	test('HEAD・GET・favicon の HEAD を同じ接続で送る', async () => {
		const origin = await startOrigin(scheme);
		const summary = await summarize(origin.url);
		expect(summary.title).toBe('page');
		expect(summary.icon).toBe(new URL('/favicon.ico', origin.url).href);
		expect(origin.requestsBySocket()).toEqual([['HEAD /', 'GET /', 'HEAD /favicon.ico']]);
		expect(origin.connections()).toBe(1);
	});

	test('要約が終わったら接続を残さない', async () => {
		const origin = await startOrigin(scheme);
		await summarize(origin.url);
		await expectAllClosed(origin);
	});

	test('要約が失敗しても接続を残さない', async () => {
		const origin = await startOrigin(scheme);
		// The HEAD for the final URL succeeds and leaves an idle socket; then the summary fails.
		const failing: SummaryPlugin = {
			test: () => true,
			summarize: () => Promise.reject(new Error('plugin failed')),
		};
		await expect(summarize(origin.url, { plugins: [failing] })).rejects.toThrow('plugin failed');
		expect(origin.connections()).toBe(1);
		await expectAllClosed(origin);
	});

	test('ページの取得がタイムアウトしても接続を残さない', async () => {
		const origin = await startOrigin(scheme, '127.0.0.1', (req, res) => {
			if (req.method === 'HEAD') {
				res.writeHead(200, { 'content-type': 'text/html', 'content-length': '0' });
				res.end();
			}
			// The GET never gets an answer.
		});
		await expect(summarize(origin.url, { operationTimeout: 200 })).rejects.toThrow("Timeout awaiting 'request' for 200ms");
		await expectAllClosed(origin);
	});

	test('別の要約呼び出しとは接続を共有しない', async () => {
		const origin = await startOrigin(scheme);
		await summarize(new URL('/?a', origin.url).href);
		await summarize(new URL('/?b', origin.url).href);
		await Promise.all([
			summarize(new URL('/?c', origin.url).href),
			summarize(new URL('/?d', origin.url).href),
		]);
		const groups = origin.requestsBySocket();
		expect(groups).toHaveLength(4);
		for (const requests of groups) {
			// Each socket served exactly one summary (its page query), plus that summary's favicon HEAD.
			const pages = new Set(requests.filter(r => !r.endsWith('/favicon.ico')).map(r => r.split(' ')[1]));
			expect(pages.size).toBe(1);
		}
		await expectAllClosed(origin);
	});
});

test('接続を再利用しても、許可していないプライベート IP への favicon の取得は拒否する', async ({ skip }) => {
	let targetHits = 0;
	const target = await startOrigin('http', '127.0.0.1', (_req, res) => {
		targetHits++;
		res.end('secret');
	});
	const page = `<!doctype html><html><head><title>page</title><link rel="icon" href="${new URL('/favicon.ico', target.url).href}"></head></html>`;
	const origin = await startOrigin('http', '127.0.0.2', (req, res) => {
		res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(Buffer.byteLength(page)) });
		res.end(req.method === 'HEAD' ? undefined : page);
	}).catch((e: NodeJS.ErrnoException) => {
		if (e.code === 'EADDRNOTAVAIL') {
			skip('cannot bind 127.0.0.2 on this host (e.g. macOS has no 127.0.0.0/8 loopback aliases); covered on Linux CI');
		}
		throw e;
	});
	const summary = await summarize(origin.url, { allowedPrivateNetworks: ['127.0.0.2/32'] });
	expect(summary.title).toBe('page');
	expect(origin.requestsBySocket()).toEqual([['HEAD /', 'GET /']]);
	expect(targetHits).toBe(0);
});
