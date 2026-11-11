import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type net from 'node:net';
import zlib from 'node:zlib';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { StatusError } from '@/http/status-error.js';
import { createTransport } from '@/http/transport.js';
import { fetchResponse, type FetchRequest } from '@/http/request.js';
import { decodeHtml } from '@/http/decode.js';
import { startTestServer, type TestServer } from './helpers/test-server.js';

const SJIS_HTML = readFileSync(new URL('./fixtures/sjis.html', import.meta.url));
const SJIS_TITLE = 'シフトJISで書かれた日本語のページ';
const HTML = '<!DOCTYPE html><html><head><title>hello</title></head><body>こんにちは</body></html>';

const servers: TestServer[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(servers.splice(0).map(s => s.close()));
});

async function serve(handler: http.RequestListener, host?: string): Promise<TestServer> {
	const server = await startTestServer(handler, host);
	servers.push(server);
	return server;
}

const localTransport = () => createTransport({ allowedPrivateNetworks: ['127.0.0.0/8', '::1/128'] });

/** An http.Agent whose createConnection calls are counted. */
function hookedAgent(): { agent: http.Agent; calls: () => number } {
	const agent = new http.Agent();
	let calls = 0;
	const original = agent.createConnection.bind(agent);
	agent.createConnection = ((...args: Parameters<typeof original>) => {
		calls++;
		return original(...args);
	}) as typeof agent.createConnection;
	return { agent, calls: () => calls };
}

function request(url: string, overrides: Partial<FetchRequest> = {}): FetchRequest {
	return {
		url,
		method: 'GET',
		headers: { accept: 'text/html' },
		followRedirects: true,
		responseTimeout: 20000,
		operationTimeout: 60000,
		contentLengthLimit: 10 * 1024 * 1024,
		contentLengthRequired: false,
		...overrides,
	};
}

describe('createTransport', () => {
	test('既定では guard を持つ', () => {
		const t = createTransport({}, {});
		expect(t.guard).not.toBeNull();
		expect(t.agents).toEqual({});
	});

	test('既定では transport 専用の guard 付き agent を持つ', () => {
		const t = createTransport({}, {});
		expect(t.guardedAgents?.http).toBeInstanceOf(http.Agent);
		expect(t.guardedAgents?.http).not.toBe(http.globalAgent);
		expect(t.guardedAgents?.https).not.toBe(https.globalAgent);
		expect(createTransport({}, {}).guardedAgents?.http).not.toBe(t.guardedAgents?.http);
	});

	test('http と https の両方の agent を渡すと guard なし、proxy は無視する', () => {
		const agent = new http.Agent();
		const secureAgent = new https.Agent();
		const t = createTransport({ agent: { http: agent, https: secureAgent }, proxy: { http: 'http://p:8080' } }, {});
		expect(t.guard).toBeNull();
		expect(t.guardedAgents).toBeNull();
		expect(t.agents.http).toBe(agent);
		expect(t.agents.https).toBe(secureAgent);
		expect(t.proxy).toBeNull();
	});

	test('片方の scheme だけ agent を渡すと、もう片方のために guard は残る', () => {
		const agent = new http.Agent();
		const t = createTransport({ agent: { http: agent }, proxy: { http: 'http://p:8080' } }, {});
		expect(t.guard).not.toBeNull();
		expect(t.guardedAgents).not.toBeNull();
		expect(t.agents.http).toBe(agent);
		expect(t.proxy).toBeNull();
	});

	test('中身が undefined の agent では guard は外れない', () => {
		const t = createTransport({ agent: { http: undefined }, proxy: { http: 'http://p:8080' } }, {});
		expect(t.guard).not.toBeNull();
		expect(t.proxy).toEqual({ http: 'http://p:8080' });
	});

	test('SUMMALY_ALLOW_PRIVATE_IP=true なら guard なし', () => {
		expect(createTransport({}, { SUMMALY_ALLOW_PRIVATE_IP: 'true' }).guard).toBeNull();
		expect(createTransport({ agent: { http: new http.Agent() } }, { SUMMALY_ALLOW_PRIVATE_IP: 'true' }).guard).toBeNull();
	});
});

describe('fetchResponse', () => {
	test('200 の本文を返す', async () => {
		const server = await serve((_req, res) => {
			res.writeHead(200, { 'content-type': 'text/html' });
			res.end(HTML);
		});
		const result = await fetchResponse(localTransport(), request(server.url));
		expect(result.statusCode).toBe(200);
		expect(result.url).toBe(server.url);
		expect(result.body.toString()).toBe(HTML);
		expect(result.headers['content-type']).toBe('text/html');
	});

	test('undefined のヘッダは送らず、Accept-Encoding を送る', async () => {
		let received: http.IncomingHttpHeaders = {};
		const server = await serve((req, res) => {
			received = req.headers;
			res.end('ok');
		});
		await fetchResponse(localTransport(), request(server.url, { headers: { 'user-agent': 'TestBot/1.0', 'accept-language': undefined } }));
		expect(received['user-agent']).toBe('TestBot/1.0');
		expect(received['accept-language']).toBeUndefined();
		expect(received['accept-encoding']).toBe('gzip, deflate, br');
	});

	test.each([
		['gzip', zlib.gzipSync],
		['br', zlib.brotliCompressSync],
		['deflate', zlib.deflateSync],
		['deflate', zlib.deflateRawSync],
	] as const)('gzip / br の応答を展開する (%s, %o)', async (encoding, compress) => {
		const server = await serve((_req, res) => {
			res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': encoding });
			res.end(compress(Buffer.from(HTML)));
		});
		const result = await fetchResponse(localTransport(), request(server.url));
		expect(result.body.toString()).toBe(HTML);
	});

	test('content-encoding 付きの空の本文は空として扱う', async () => {
		const server = await serve((_req, res) => {
			res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
			res.end();
		});
		const result = await fetchResponse(localTransport(), request(server.url));
		expect(result.body.length).toBe(0);
	});

	test('HEAD は本文なしで返す', async () => {
		const server = await serve((req, res) => {
			res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip', 'content-length': '20' });
			res.end(req.method === 'HEAD' ? undefined : zlib.gzipSync('x'));
		});
		const result = await fetchResponse(localTransport(), request(server.url, { method: 'HEAD' }));
		expect(result.statusCode).toBe(200);
		expect(result.body.length).toBe(0);
	});

	test('Shift_JIS の HTML を decodeHtml で正しく読める', async () => {
		const server = await serve((_req, res) => {
			res.writeHead(200, { 'content-type': 'text/html' });
			res.end(SJIS_HTML);
		});
		const result = await fetchResponse(localTransport(), request(server.url));
		expect(decodeHtml(result.body, result.headers['content-type'])).toContain(SJIS_TITLE);
	});

	test('followRedirects=true でリダイレクトをたどり、最終 URL を返す', async () => {
		const server = await serve((req, res) => {
			if (req.url === '/a') {
				res.writeHead(301, { location: '/b' });
				res.end();
			} else if (req.url === '/b') {
				res.writeHead(302, { location: '/c?x=1' });
				res.end();
			} else {
				res.writeHead(200, { 'content-type': 'text/html' });
				res.end(`final:${req.url}`);
			}
		});
		const result = await fetchResponse(localTransport(), request(new URL('/a', server.url).href));
		expect(result.statusCode).toBe(200);
		expect(result.url).toBe(new URL('/c?x=1', server.url).href);
		expect(result.body.toString()).toBe('final:/c?x=1');
	});

	test('followRedirects=false では 3xx をそのまま返す', async () => {
		const server = await serve((_req, res) => {
			res.writeHead(302, { location: '/next' });
			res.end();
		});
		const result = await fetchResponse(localTransport(), request(server.url, { followRedirects: false }));
		expect(result.statusCode).toBe(302);
		expect(result.url).toBe(server.url);
		expect(result.headers.location).toBe('/next');
	});

	function redirectChain(length: number): http.RequestListener {
		return (req, res) => {
			const n = Number(req.url!.slice(1) || 0);
			if (n < length) {
				res.writeHead(302, { location: `/${n + 1}` });
				res.end();
			} else {
				res.end('done');
			}
		};
	}

	test('10 回までのリダイレクトはたどる', async () => {
		const server = await serve(redirectChain(10));
		const result = await fetchResponse(localTransport(), request(server.url));
		expect(result.url).toBe(new URL('/10', server.url).href);
	});

	test('11 回目のリダイレクトでエラーになる', async () => {
		const server = await serve(redirectChain(11));
		await expect(fetchResponse(localTransport(), request(server.url))).rejects.toThrow('Redirected 10 times. Aborting.');
	});

	test('最初の接続先がプライベート IP なら StatusError(400) で拒否する', async () => {
		let hits = 0;
		const server = await serve((_req, res) => {
			hits++;
			res.end('ok');
		});
		const e = await fetchResponse(createTransport({}, {}), request(server.url)).catch(e => e);
		expect(e).toBeInstanceOf(StatusError);
		expect(e.statusCode).toBe(400);
		expect(hits).toBe(0);
	});

	test('リダイレクト先がプライベート IP なら StatusError(400) で拒否する', async ({ skip }) => {
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
		const transport = createTransport({ allowedPrivateNetworks: ['127.0.0.2/32'] }, {});
		const e = await fetchResponse(transport, request(origin.url)).catch(e => e);
		expect(e).toBeInstanceOf(StatusError);
		expect(e.statusCode).toBe(400);
		expect(targetHits).toBe(0);
	});

	test('http の agent だけ渡したとき、https へのリダイレクトは guard で拒否する', async () => {
		const { agent, calls } = hookedAgent();
		const server = await serve((_req, res) => {
			res.writeHead(302, { location: `https://127.0.0.1:${new URL(server.url).port}/` });
			res.end();
		});
		const e = await fetchResponse(createTransport({ agent: { http: agent } }, {}), request(server.url)).catch(e => e);
		agent.destroy();
		// The http hop went through the caller's agent (guard handed off); the https hop is rejected before connecting.
		expect(calls()).toBeGreaterThan(0);
		expect(e).toBeInstanceOf(StatusError);
		expect(e.statusCode).toBe(400);
		expect(e.message).toBe('Private IP rejected 127.0.0.1');
	});

	test('http.globalAgent に溜まった同じ宛先のソケットを、guard 付きの接続では使い回さない', async () => {
		const sockets = new Set<net.Socket>();
		const server = await serve((req, res) => {
			sockets.add(req.socket);
			res.end('ok');
		});
		// Leave a keep-alive socket in the process-wide pool, opened without the guarded lookup.
		await new Promise<void>((resolve, reject) => {
			http.get(server.url, { agent: http.globalAgent }, res => {
				res.resume();
				res.on('end', resolve);
			}).on('error', reject);
		});
		await new Promise(resolve => setImmediate(resolve));
		const name = http.globalAgent.getName({ host: '127.0.0.1', port: Number(new URL(server.url).port) });
		expect(http.globalAgent.freeSockets[name]?.length).toBe(1);

		const result = await fetchResponse(localTransport(), request(server.url));
		expect(result.body.toString()).toBe('ok');
		expect(sockets.size).toBe(2);
		expect(http.globalAgent.freeSockets[name]?.length).toBe(1);
	});

	test('404 は statusCode 404 の StatusError', async () => {
		const server = await serve((_req, res) => {
			res.writeHead(404, { 'content-type': 'text/html' });
			res.end('not found');
		});
		const e = await fetchResponse(localTransport(), request(server.url)).catch(e => e);
		expect(e).toBeInstanceOf(StatusError);
		expect(e.statusCode).toBe(404);
		expect(e.statusMessage).toBe('Not Found');
		expect(e.message).toBe('404 Not Found');
	});

	test('500 は statusCode 500 の StatusError', async () => {
		const server = await serve((_req, res) => {
			res.writeHead(500);
			res.end();
		});
		const e = await fetchResponse(localTransport(), request(server.url)).catch(e => e);
		expect(e).toBeInstanceOf(StatusError);
		expect(e.statusCode).toBe(500);
		expect(e.isPermanentError).toBe(false);
	});

	test('typeFilter に合わない content-type はエラー', async () => {
		const server = await serve((_req, res) => {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end('{}');
		});
		await expect(fetchResponse(localTransport(), request(server.url, { typeFilter: /^(text\/html|application\/xhtml\+xml)/ })))
			.rejects.toThrow('Rejected by type filter application/json');
	});

	test('content-length が上限超過ならエラー、上限以内なら成功', async () => {
		const body = 'x'.repeat(100);
		const server = await serve((_req, res) => {
			res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(body.length) });
			res.end(body);
		});
		await expect(fetchResponse(localTransport(), request(server.url, { contentLengthLimit: 99 })))
			.rejects.toThrow('maxSize exceeded (100 > 99) on response');
		const result = await fetchResponse(localTransport(), request(server.url, { contentLengthLimit: 100 }));
		expect(result.body.toString()).toBe(body);
	});

	test('content-length なしのストリームが受信中に上限を超えたらエラー', async () => {
		const server = await serve((_req, res) => {
			res.writeHead(200, { 'content-type': 'text/html' });
			res.write('a'.repeat(60));
			setTimeout(() => res.write('b'.repeat(60)), 20);
			// never ends on its own; the client must abort
		});
		await expect(fetchResponse(localTransport(), request(server.url, { contentLengthLimit: 100 })))
			.rejects.toThrow('maxSize exceeded (120 > 100) on response');
	});

	test('展開後のサイズが上限を超えたらエラー', async () => {
		const compressed = zlib.gzipSync(Buffer.alloc(1024 * 1024));
		const server = await serve((_req, res) => {
			res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip', 'content-length': String(compressed.length) });
			res.end(compressed);
		});
		await expect(fetchResponse(localTransport(), request(server.url, { contentLengthLimit: 64 * 1024 })))
			.rejects.toThrow(/^maxSize exceeded \(\d+ > 65536\) on response$/);
	});

	test('content-length なしで空の gzip メンバーが続く応答は、受信量で打ち切る', async () => {
		const chunk = Buffer.concat(Array.from({ length: 50 }, () => zlib.gzipSync(Buffer.alloc(0))));
		const server = await serve((_req, res) => {
			res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
			// Decompresses to nothing and never ends.
			const timer = setInterval(() => res.write(chunk), 5);
			res.on('close', () => clearInterval(timer));
		});
		const started = Date.now();
		await expect(fetchResponse(localTransport(), request(server.url, { contentLengthLimit: 4096, operationTimeout: 3000 })))
			.rejects.toThrow(/^maxSize exceeded \(\d+ > 4096\) on response$/);
		expect(Date.now() - started).toBeLessThan(1000);
	});

	test('contentLengthRequired=true で content-length がなければエラー', async () => {
		const server = await serve((_req, res) => {
			res.writeHead(200, { 'content-type': 'text/html' });
			res.write('chunked');
			res.end();
		});
		await expect(fetchResponse(localTransport(), request(server.url, { contentLengthRequired: true })))
			.rejects.toThrow('content-length required');
	});

	test('operationTimeout を超えたらエラーになる', async () => {
		const server = await serve(() => {
			// never respond
		});
		const started = Date.now();
		await expect(fetchResponse(localTransport(), request(server.url, { operationTimeout: 200 })))
			.rejects.toThrow("Timeout awaiting 'request' for 200ms");
		expect(Date.now() - started).toBeLessThan(2000);
	});

	test('名前解決の事前確認も operationTimeout に含まれる', async () => {
		vi.spyOn(dns.promises, 'lookup').mockImplementation(() => new Promise(() => {}));
		await expect(fetchResponse(createTransport({}, {}), request('http://example.invalid/', { operationTimeout: 100 })))
			.rejects.toThrow("Timeout awaiting 'request' for 100ms");
	});

	test('ホスト名でも接続時の名前解決を通って取得できる', async () => {
		const server = await serve((_req, res) => res.end('ok'));
		const url = new URL(server.url);
		url.hostname = 'localhost';
		const result = await fetchResponse(localTransport(), request(url.href));
		expect(result.body.toString()).toBe('ok');
	});

	test('事前確認の後に名前解決の結果が変わっても、接続時の名前解決で拒否する (DNS rebinding)', async () => {
		let hits = 0;
		const server = await serve((_req, res) => {
			hits++;
			res.end('secret');
		});
		// The pre-check sees a public address; the connect-time lookup then resolves localhost to loopback.
		vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
		const url = new URL(server.url);
		url.hostname = 'localhost';
		const e = await fetchResponse(createTransport({}, {}), request(url.href)).catch(e => e);
		expect(e).toBeInstanceOf(StatusError);
		expect(e.statusCode).toBe(400);
		expect(hits).toBe(0);
	});

	test('受信が止まったら responseTimeout でエラーになる', async () => {
		const server = await serve((_req, res) => {
			res.writeHead(200, { 'content-type': 'text/html' });
			res.write('partial');
			// stall
		});
		await expect(fetchResponse(localTransport(), request(server.url, { responseTimeout: 200 })))
			.rejects.toThrow("Timeout awaiting 'socket' for 200ms");
	});

	test('渡した agent が実際に使われる', async () => {
		const server = await serve((_req, res) => res.end('ok'));
		const { agent, calls } = hookedAgent();
		const result = await fetchResponse(createTransport({ agent: { http: agent } }, {}), request(server.url));
		expect(result.body.toString()).toBe('ok');
		expect(calls()).toBeGreaterThan(0);
		agent.destroy();
	});
});

describe('decodeHtml', () => {
	test('meta charset で Shift_JIS を判定する', () => {
		expect(decodeHtml(SJIS_HTML)).toContain(SJIS_TITLE);
	});

	test('content-type の charset を chardet より優先する', () => {
		expect(decodeHtml(SJIS_HTML, 'text/html; charset=euc-jp')).not.toContain(SJIS_TITLE);
		expect(decodeHtml(Buffer.from(HTML), 'text/html; charset="UTF-8"')).toBe(HTML);
	});

	test('解釈できない content-type の charset は無視する', () => {
		expect(decodeHtml(SJIS_HTML, 'text/html; charset=no-such-charset')).toContain(SJIS_TITLE);
	});

	test('UTF-8 の HTML はそのまま読める', () => {
		expect(decodeHtml(Buffer.from(HTML))).toBe(HTML);
	});
});
