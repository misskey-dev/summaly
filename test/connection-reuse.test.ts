import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net, { type AddressInfo, type Socket } from 'node:net';
import tls from 'node:tls';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { createSummarizer } from '@/index.js';
import type { SummaryPlugin } from '@/types.js';
import { runSourceScript } from './helpers/run-source.js';
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
	/** Closes the connections that are not serving a request, as a server does when its keep-alive timeout passes */
	closeIdle: () => void;
	close: () => Promise<void>;
};

/** Answers the page and its favicon, with a content-length (also to HEAD, so the connection can be kept alive). */
const serveDefault: http.RequestListener = (req, res) => {
	if (req.url === '/favicon.ico') {
		res.writeHead(200, { 'content-type': 'image/x-icon', 'content-length': '4' });
		res.end(req.method === 'HEAD' ? undefined : 'icon');
		return;
	}
	const body = Buffer.from(PAGE);
	res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(body.length) });
	res.end(req.method === 'HEAD' ? undefined : body);
};

const origins: { close: () => Promise<void> }[] = [];
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

async function startOrigin(scheme: 'http' | 'https', host = '127.0.0.1', handler: http.RequestListener = serveDefault): Promise<Origin> {
	const bySocket = new Map<Socket, string[]>();
	let connections = 0;
	const listener: http.RequestListener = (req, res) => {
		const list = bySocket.get(req.socket) ?? [];
		list.push(`${req.method} ${req.url}`);
		bySocket.set(req.socket, list);
		handler(req, res);
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
		closeIdle: () => server.closeIdleConnections(),
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

/**
 * Forward proxy on 127.0.0.1 that relays CONNECT tunnels, counting them and the sockets (both sides) still open.
 */
async function startConnectProxy(): Promise<{ url: string; tunnels: () => number; open: () => number }> {
	let tunnels = 0;
	const sockets = new Set<Socket>();
	const track = (socket: Socket) => {
		sockets.add(socket);
		socket.on('close', () => sockets.delete(socket));
		socket.on('error', () => {});
	};
	const server = http.createServer((_req, res) => {
		res.writeHead(501);
		res.end();
	});
	server.on('connect', (req: http.IncomingMessage, client: Socket, head: Buffer) => {
		tunnels++;
		track(client);
		const { hostname, port } = new URL(`http://${req.url}`);
		const upstream = net.connect(Number(port), hostname, () => {
			client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
			upstream.write(head);
			upstream.pipe(client);
			client.pipe(upstream);
		});
		track(upstream);
		client.on('close', () => upstream.destroy());
		upstream.on('close', () => client.destroy());
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
	origins.push({
		close: () => new Promise<void>(resolve => {
			for (const socket of sockets) socket.destroy();
			server.close(() => resolve());
			server.closeAllConnections();
		}),
	});
	return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, tunnels: () => tunnels, open: () => sockets.size };
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

	// Before connections were shared across summaries, a summary closed every connection when it ended.
	// Now the completed ones stay idle in the summarizer's pool until its idle timeout.
	test('要約が終わっても、待機中の接続は1本だけ残す', async () => {
		const origin = await startOrigin(scheme);
		await summarize(origin.url);
		expect(await origin.open()).toBe(1);
	});

	test('要約が失敗しても、完了した応答の接続は次の要約で使える', async () => {
		const origin = await startOrigin(scheme);
		// The HEAD for the final URL succeeds and leaves an idle socket; then the summary fails.
		const failing: SummaryPlugin = {
			test: () => true,
			summarize: () => Promise.reject(new Error('plugin failed')),
		};
		await expect(summarize(origin.url, { plugins: [failing] })).rejects.toThrow('plugin failed');
		expect(origin.connections()).toBe(1);
		const summary = await summarize(new URL('/next', origin.url).href);
		expect(summary.title).toBe('page');
		expect(origin.connections()).toBe(1);
	});

	test('ページの取得がタイムアウトした接続は残さない', async () => {
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
});

describe.each(['http', 'https'] as const)('要約をまたいで接続を再利用する (%s)', scheme => {
	test('同じ summarizer で同じサイトの別ページを順に要約すると、接続は1本', async () => {
		const origin = await startOrigin(scheme);
		expect((await summarize(new URL('/a', origin.url).href)).title).toBe('page');
		expect((await summarize(new URL('/b', origin.url).href)).title).toBe('page');
		expect(origin.connections()).toBe(1);
		expect(origin.requestsBySocket()).toEqual([[
			'HEAD /a', 'GET /a', 'HEAD /favicon.ico',
			'HEAD /b', 'GET /b', 'HEAD /favicon.ico',
		]]);
	});

	test('同時に要約すると別の接続を使い、終わった後の要約はそのどれかを使う', async () => {
		const origin = await startOrigin(scheme);
		await Promise.all([
			summarize(new URL('/?c', origin.url).href),
			summarize(new URL('/?d', origin.url).href),
		]);
		const concurrent = origin.connections();
		expect(concurrent).toBeGreaterThanOrEqual(1);
		await summarize(new URL('/?e', origin.url).href);
		expect(origin.connections()).toBe(concurrent);
	});

	test('別の summarizer とは接続を共有しない', async () => {
		const origin = await startOrigin(scheme);
		const other = createSummarizer({ cache: false, coordinator: false, allowedPrivateNetworks: ['127.0.0.0/8'] });
		await summarize(new URL('/a', origin.url).href);
		await other(new URL('/b', origin.url).href);
		expect(origin.connections()).toBe(2);
		await summarize(new URL('/c', origin.url).href);
		await other(new URL('/d', origin.url).href);
		expect(origin.connections()).toBe(2);
		for (const requests of origin.requestsBySocket()) {
			const pages = requests.filter(r => r.startsWith('GET ')).map(r => r.split(' ')[1]);
			expect([['/a', '/c'], ['/b', '/d']]).toContainEqual(pages);
		}
	});

	test('allowedPrivateNetworks が違う要約とは接続を共有せず、同じ設定なら書き方が違っても共有する', async () => {
		const origin = await startOrigin(scheme);
		await summarize(new URL('/a', origin.url).href);
		await summarize(new URL('/b', origin.url).href, { allowedPrivateNetworks: ['127.0.0.1/32'] });
		expect(origin.connections()).toBe(2);
		await summarize(new URL('/c', origin.url).href, { allowedPrivateNetworks: ['127.0.0.0/8', '127.0.0.0/8'] });
		await summarize(new URL('/d', origin.url).href, { allowedPrivateNetworks: ['127.0.0.1/32'] });
		expect(origin.connections()).toBe(2);
	});

	test('相手が待機中の接続を閉じていたら、次の要約は新しい接続を使う', async () => {
		const origin = await startOrigin(scheme);
		await summarize(new URL('/a', origin.url).href);
		origin.closeIdle();
		await vi.waitFor(async () => expect(await origin.open()).toBe(0), { timeout: 1000, interval: 10 });
		expect((await summarize(new URL('/b', origin.url).href)).title).toBe('page');
		expect(origin.connections()).toBe(2);
	});

	test('前の要約の接続が次の要求を受けたところで切られたら、新しい接続で送り直す', async () => {
		const earlier = new Set<Socket>();
		let dropEarlier = false;
		const origin = await startOrigin(scheme, '127.0.0.1', (req, res) => {
			if (dropEarlier && earlier.has(req.socket)) {
				// Like a server that closes an idle keep-alive connection just as the client reuses it.
				req.socket.destroy();
				return;
			}
			if (!dropEarlier) earlier.add(req.socket);
			serveDefault(req, res);
		});
		await summarize(new URL('/a', origin.url).href);
		dropEarlier = true;
		const summary = await summarize(new URL('/b', origin.url).href);
		expect(summary.title).toBe('page');
		expect(summary.icon).toBe(new URL('/favicon.ico', origin.url).href);
		// The HEAD for the final URL went out again on a new connection (without the retry it would be lost,
		// and the summary would fall back to the URL as given).
		expect(origin.requestsBySocket()).toEqual([
			['HEAD /a', 'GET /a', 'HEAD /favicon.ico', 'HEAD /b'],
			['HEAD /b', 'GET /b', 'HEAD /favicon.ico'],
		]);
	});
});

/** Node calls `addRequest` for every request an agent serves; @types/node does not declare it. */
type AgentInternals = http.Agent & { addRequest: (...args: unknown[]) => void };

describe('要約をまたいだ接続の再利用の対象外', () => {
	test('環境変数でプライベート IP を許可したときは、従来どおり Node の globalAgent を使う', async () => {
		const origin = await startOrigin('http');
		const addRequest = vi.spyOn(http.globalAgent as AgentInternals, 'addRequest');
		process.env.CHIRAMISS_ALLOW_PRIVATE_IP = 'true';
		try {
			const other = createSummarizer({ cache: false, coordinator: false });
			expect((await other(origin.url)).title).toBe('page');
			expect(addRequest).toHaveBeenCalledTimes(3);
		} finally {
			delete process.env.CHIRAMISS_ALLOW_PRIVATE_IP;
			addRequest.mockRestore();
		}
	});

	test('呼び出し元の agent は従来どおりそのまま使い、触らない', async () => {
		const origin = await startOrigin('http');
		const agent = new http.Agent({ keepAlive: true });
		const addRequest = vi.spyOn(agent as AgentInternals, 'addRequest');
		const destroy = vi.spyOn(agent, 'destroy');
		try {
			await summarize(new URL('/a', origin.url).href, { agent: { http: agent } });
			await summarize(new URL('/b', origin.url).href, { agent: { http: agent } });
			expect(addRequest).toHaveBeenCalledTimes(6);
			expect(destroy).not.toHaveBeenCalled();
			// Only the caller's agent connected; its own keep-alive decides reuse.
			expect(origin.connections()).toBe(1);
		} finally {
			agent.destroy();
		}
	});

	test('プロキシ経由の接続は、要約をまたいで残さない', async () => {
		const origin = await startOrigin('http');
		const proxy = await startConnectProxy();
		const viaProxy = { proxy: { http: proxy.url } };
		expect((await summarize(new URL('/a', origin.url).href, viaProxy)).title).toBe('page');
		await vi.waitFor(() => expect(proxy.open()).toBe(0), { timeout: 1000, interval: 10 });
		await expectAllClosed(origin);
		const tunnels = proxy.tunnels();
		expect(tunnels).toBeGreaterThan(0);
		expect((await summarize(new URL('/b', origin.url).href, viaProxy)).title).toBe('page');
		await vi.waitFor(() => expect(proxy.open()).toBe(0), { timeout: 1000, interval: 10 });
		await expectAllClosed(origin);
		// Each summary opened its own tunnels; none was carried over.
		expect(proxy.tunnels()).toBe(tunnels * 2);
		expect(origin.connections()).toBe(tunnels * 2);
	});
});

test('待機中の接続は、待機の timeout（4秒）の後に閉じる', async () => {
	const origin = await startOrigin('http');
	await summarize(origin.url);
	const started = Date.now();
	expect(await origin.open()).toBe(1);
	await vi.waitFor(async () => expect(await origin.open()).toBe(0), { timeout: 6000, interval: 50 });
	const elapsed = Date.now() - started;
	expect(elapsed).toBeGreaterThanOrEqual(3000);
	expect(elapsed).toBeLessThan(5000);
}, 10_000);

test('待機中の接続が残っていても、プロセスはすぐ終了する', async () => {
	const origin = await startOrigin('http');
	const child = await runSourceScript(`
		const { summarize } = await import(SOURCE_INDEX);
		const url = process.argv[1];
		const opts = { allowedPrivateNetworks: ['127.0.0.0/8'] };
		const a = await summarize(new URL('/a', url).href, opts);
		const b = await summarize(new URL('/b', url).href, opts);
		console.log(JSON.stringify([a.title, b.title]));
	`, [origin.url]);
	expect(child.code).toBe(0);
	expect(JSON.parse(child.stdout)).toEqual(['page', 'page']);
	// The two summaries shared one connection, which was still idle in the pool when the script ended.
	expect(origin.connections()).toBe(1);
	// Well before the 4 s idle timeout.
	expect(child.exitDelay).toBeLessThan(1500);
}, 15_000);

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

test('127.0.0.2 を許可した要約が接続を残していても、許可していない要約は IP リテラルの 127.0.0.2 を従来どおり拒否する', async ({ skip }) => {
	const origin = await startOrigin('http', '127.0.0.2').catch((e: NodeJS.ErrnoException) => {
		if (e.code === 'EADDRNOTAVAIL') {
			skip('cannot bind 127.0.0.2 on this host (e.g. macOS has no 127.0.0.0/8 loopback aliases); covered on Linux CI');
		}
		throw e;
	});
	const allowed = await summarize(new URL('/a', origin.url).href, { allowedPrivateNetworks: ['127.0.0.2/32'] });
	expect(allowed.title).toBe('page');
	// The connection opened under the setting that allows 127.0.0.2 is idle in the pool.
	expect(await origin.open()).toBe(1);
	const requests = origin.requestsBySocket().flat().length;
	await expect(summarize(new URL('/b', origin.url).href, { allowedPrivateNetworks: ['127.0.0.1/32'] }))
		.rejects.toThrow('Private IP rejected 127.0.0.2');
	await expect(summarize(new URL('/c', origin.url).href, { allowedPrivateNetworks: [] }))
		.rejects.toThrow('Private IP rejected 127.0.0.2');
	expect(origin.requestsBySocket().flat()).toHaveLength(requests);
	expect(origin.connections()).toBe(1);
});

/**
 * An IP literal is refused by the check before each hop, before any agent is picked, so the test above passes even if
 * every setting shared one agent. Here the target is a name (DNS rebinding): the check before each hop of the later
 * summaries sees a public address and passes, so only keeping their agents apart stops them from reusing the socket
 * to 127.0.0.2 that the first summary left in the pool.
 */
test('127.0.0.2 を許可した要約の接続は、名前が公開アドレスに解決されるようになっても、許可していない要約には使わせない', async ({ skip }) => {
	const origin = await startOrigin('http', '127.0.0.2').catch((e: NodeJS.ErrnoException) => {
		if (e.code === 'EADDRNOTAVAIL') {
			skip('cannot bind 127.0.0.2 on this host (e.g. macOS has no 127.0.0.0/8 loopback aliases); covered on Linux CI');
		}
		throw e;
	});
	const host = 'rebind.test';
	let checkedAddress = '127.0.0.2';
	// The check before each hop (dns.promises.lookup) and the check at connect time (dns.lookup) resolve the name apart.
	const precheck = vi.spyOn(dns.promises, 'lookup').mockImplementation((async () => [{ address: checkedAddress, family: 4 }]) as never);
	const originalLookup = dns.lookup;
	const connectLookup = vi.spyOn(dns, 'lookup').mockImplementation(((hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
		if (hostname !== host) {
			(originalLookup as (...args: unknown[]) => void)(hostname, options, callback);
			return;
		}
		callback(null, [{ address: '127.0.0.2', family: 4 }]);
	}) as never);
	try {
		const other = createSummarizer({ cache: false, coordinator: false });
		const url = new URL(origin.url);
		url.hostname = host;
		const allowed = await other(new URL('/a', url).href, { allowedPrivateNetworks: ['127.0.0.2/32'] });
		expect(allowed.title).toBe('page');
		// The connection opened under the setting that allows 127.0.0.2 is idle in the pool.
		expect(await origin.open()).toBe(1);
		const requests = origin.requestsBySocket().flat().length;

		checkedAddress = '93.184.216.34';
		await expect(other(new URL('/b', url).href, { allowedPrivateNetworks: ['127.0.0.1/32'] }))
			.rejects.toThrow('Private IP rejected 127.0.0.2');
		await expect(other(new URL('/c', url).href, { allowedPrivateNetworks: [] }))
			.rejects.toThrow('Private IP rejected 127.0.0.2');
		expect(origin.requestsBySocket().flat()).toHaveLength(requests);
		expect(origin.connections()).toBe(1);
	} finally {
		precheck.mockRestore();
		connectLookup.mockRestore();
	}
});

/**
 * A raw origin that answers the requests on one connection in order, but sends `stray` bytes that do not belong
 * to any response (as a non-compliant server does) on that connection just before its next response.
 * Holding them until the next request makes them arrive after the client has sent that request on the reused socket.
 */
async function startStrayOrigin(stray: (method: string, path: string) => string | undefined): Promise<{ url: string; connections: () => number }> {
	let connections = 0;
	const sockets = new Set<Socket>();
	const server = net.createServer(socket => {
		connections++;
		sockets.add(socket);
		socket.on('close', () => sockets.delete(socket));
		socket.on('error', () => {});
		let buffered = '';
		let pending: string | undefined;
		socket.on('data', data => {
			buffered += data.toString('latin1');
			for (let end = buffered.indexOf('\r\n\r\n'); end >= 0; end = buffered.indexOf('\r\n\r\n')) {
				const [method = '', path = ''] = buffered.slice(0, end).split(' ');
				buffered = buffered.slice(end + 4);
				const body = path === '/favicon.ico' ? 'icon' : PAGE;
				const type = path === '/favicon.ico' ? 'image/x-icon' : 'text/html';
				socket.write(`${pending ?? ''}HTTP/1.1 200 OK\r\ncontent-type: ${type}\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n${method === 'HEAD' ? '' : body}`);
				pending = stray(method, path);
			}
		});
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
	origins.push({
		close: () => new Promise<void>(resolve => {
			for (const socket of sockets) socket.destroy();
			server.close(() => resolve());
		}),
	});
	return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, connections: () => connections };
}

describe('再利用したソケットに前の応答の余りが届いたら、新しい接続で送り直す', () => {
	test('HEAD の応答のあとに本文（チャンクの終端）が届く', async () => {
		const origin = await startStrayOrigin((method, path) => (method === 'HEAD' && path === '/' ? '0\r\n\r\n' : undefined));
		const summary = await summarize(origin.url);
		expect(summary.title).toBe('page');
		expect(summary.icon).toBe(new URL('/favicon.ico', origin.url).href);
		// The page GET failed on the reused socket and went out again on a new connection.
		expect(origin.connections()).toBe(2);
	});

	test('GET の本文が Content-Length より長い', async () => {
		const origin = await startStrayOrigin((method, path) => (method === 'GET' && path === '/' ? 'trailing garbage' : undefined));
		const summary = await summarize(origin.url);
		expect(summary.title).toBe('page');
		// The favicon HEAD failed on the reused socket and went out again on a new connection.
		expect(summary.icon).toBe(new URL('/favicon.ico', origin.url).href);
		expect(origin.connections()).toBe(2);
	});
});
