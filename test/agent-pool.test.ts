import http from 'node:http';
import https from 'node:https';
import type net from 'node:net';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
	GuardedAgentPool,
	IDLE_SOCKET_TIMEOUT,
	MAX_FREE_SOCKETS_PER_HOST,
	MAX_POOL_ENTRIES,
} from '@/http/agent-pool.js';
import { fetchResponse, type FetchRequest } from '@/http/request.js';
import { createTransport } from '@/http/transport.js';
import { startTestServer, type TestServer } from './helpers/test-server.js';

const servers: TestServer[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(servers.splice(0).map(s => s.close()));
});

const LOCAL = ['127.0.0.0/8'];

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

/** A server answering `ok` with a content-length, counting the TCP connections it accepts. */
async function countingServer(handler?: http.RequestListener, host?: string) {
	const sockets = new Set<net.Socket>();
	const server = await startTestServer((req, res) => {
		sockets.add(req.socket);
		if (handler) {
			handler(req, res);

			return;
		}
		res.writeHead(200, { 'content-type': 'text/html', 'content-length': '2' });
		res.end('ok');
	}, host);

	servers.push(server);

	return { url: server.url, connections: () => sockets.size, sockets };
}

function freeSockets(agent: http.Agent): net.Socket[] {
	return Object.values(agent.freeSockets).flat().filter(s => s != null);
}

describe('GuardedAgentPool', () => {
	test('同じ設定なら同じ agent の組を返す（並び順・重複・表記の違いは同じ設定とみなす）', () => {
		const pool = new GuardedAgentPool();
		const a = pool.acquire(['127.0.0.0/8', '::1/128']);

		expect(pool.acquire(['::1/128', '127.0.0.0/8']).agents).toBe(a.agents);
		expect(pool.acquire(['127.0.0.0/8', '::1/128', '127.0.0.0/8']).agents).toBe(a.agents);
		expect(pool.acquire(['127.0.0.0/8', '0:0:0:0:0:0:0:1/128']).agents).toBe(a.agents);
		// No networks, given or not, is one setting.
		expect(pool.acquire(undefined).agents).toBe(pool.acquire([]).agents);
		expect(pool.size).toBe(2);
	});

	test('設定が違えば別の agent の組を返す', () => {
		const pool = new GuardedAgentPool();
		const all = [
			pool.acquire(['127.0.0.0/8']),
			pool.acquire(['127.0.0.2/32']),
			pool.acquire(['127.0.0.0/16']),
			pool.acquire([]),
		];

		expect(new Set(all.map(e => e.agents.http)).size).toBe(4);
		expect(new Set(all.map(e => e.agents.https)).size).toBe(4);
	});

	test('組の guard は、その設定で許可したネットワークだけを許可する', async () => {
		const pool = new GuardedAgentPool();
		const { guard } = pool.acquire(['127.0.0.2/32']);

		expect(guard.allowedNetworks.map(([addr, bits]) => `${addr.toString()}/${bits}`)).toEqual(['127.0.0.2/32']);
	});

	test('別の pool 同士では agent を共有しない', () => {
		expect(new GuardedAgentPool().acquire(LOCAL).agents.http).not.toBe(new GuardedAgentPool().acquire(LOCAL).agents.http);
	});

	test('不正な CIDR は TypeError にし、組を作らない', () => {
		const pool = new GuardedAgentPool();

		expect(() => pool.acquire(['127.1/8'])).toThrow(TypeError);
		expect(pool.size).toBe(0);
	});

	test('agent は keep-alive で、待機中のソケットの timeout と数を控えめにする', () => {
		expect(IDLE_SOCKET_TIMEOUT).toBe(4000);
		expect(MAX_FREE_SOCKETS_PER_HOST).toBe(4);
		expect(MAX_POOL_ENTRIES).toBe(32);
		const { agents } = new GuardedAgentPool().acquire(LOCAL);

		expect(agents.http).toBeInstanceOf(http.Agent);
		expect(agents.https).toBeInstanceOf(https.Agent);
		// Node sets these, but @types/node does not declare them on http.Agent.
		type AgentInternals = http.Agent & { keepAlive: boolean; options: http.AgentOptions };
		for (const agent of [agents.http, agents.https] as AgentInternals[]) {
			expect(agent.keepAlive).toBe(true);
			expect(agent.options.timeout).toBe(4000);
			expect(agent.maxFreeSockets).toBe(4);
			// Concurrent requests are not limited.
			expect(agent.maxSockets).toBe(Number.POSITIVE_INFINITY);
		}
	});

	test('組の数は上限までで、超えたら最も長く使っていない組から外す', () => {
		const pool = new GuardedAgentPool();
		const networks = (i: number) => [`10.0.${i}.0/24`];
		const first = pool.acquire(networks(0));
		const second = pool.acquire(networks(1));

		for (let i = 2; i < 32; i++) {
			pool.acquire(networks(i));
		}
		expect(pool.size).toBe(32);
		// Using the first one again keeps it; the second becomes the oldest.
		expect(pool.acquire(networks(0)).agents).toBe(first.agents);
		pool.acquire(networks(32));
		expect(pool.size).toBe(32);
		expect(pool.acquire(networks(0)).agents).toBe(first.agents);
		expect(pool.acquire(networks(1)).agents).not.toBe(second.agents);
		expect(pool.size).toBe(32);
	});

	test('外した組の agent は destroy せず、使用中の要求はそのまま終わる', async () => {
		let release!: () => void;
		const released = new Promise<void>(resolve => {
			release = resolve;
		});
		const origin = await countingServer((_req, res) => {
			res.writeHead(200, { 'content-type': 'text/html', 'content-length': '4' });
			res.write('sl');
			void released.then(() => res.end('ow'));
		});
		const pool = new GuardedAgentPool();
		const transport = createTransport({ allowedPrivateNetworks: LOCAL, agentPool: pool }, {});
		const destroy = vi.spyOn(transport.guardedAgents!.http, 'destroy');
		const pending = fetchResponse(transport, request(origin.url));

		await vi.waitFor(() => expect(origin.connections()).toBe(1));
		for (let i = 0; i < 40; i++) {
			pool.acquire([`10.0.${i}.0/24`]);
		}
		expect(pool.size).toBeLessThanOrEqual(32);
		expect(pool.acquire(LOCAL).agents).not.toBe(transport.guardedAgents);
		release();
		const result = await pending;

		expect(result.body.toString()).toBe('slow');
		transport.close();
		expect(destroy).not.toHaveBeenCalled();
	});
});

describe('pool を使う transport', () => {
	test('同じ pool・同じ設定の transport 同士は接続を共有し、close しても待機中の接続は残す', async () => {
		const origin = await countingServer();
		const pool = new GuardedAgentPool();
		const first = createTransport({ allowedPrivateNetworks: LOCAL, agentPool: pool }, {});

		await fetchResponse(first, request(origin.url));
		first.close();
		expect(freeSockets(first.guardedAgents!.http)).toHaveLength(1);
		const second = createTransport({ allowedPrivateNetworks: [...LOCAL], agentPool: pool }, {});

		expect(second.guardedAgents).toBe(first.guardedAgents);
		await fetchResponse(second, request(origin.url));
		second.close();
		expect(origin.connections()).toBe(1);
	});

	test('transport の guard は、pool の組の guard と同じ', () => {
		const pool = new GuardedAgentPool();
		const transport = createTransport({ allowedPrivateNetworks: LOCAL, agentPool: pool }, {});

		expect(transport.guard).toBe(pool.acquire(LOCAL).guard);
	});

	test('設定が違う transport 同士は接続を共有しない', async () => {
		const origin = await countingServer();
		const pool = new GuardedAgentPool();
		const first = createTransport({ allowedPrivateNetworks: ['127.0.0.0/8'], agentPool: pool }, {});

		await fetchResponse(first, request(origin.url));
		const second = createTransport({ allowedPrivateNetworks: ['127.0.0.1/32'], agentPool: pool }, {});

		expect(second.guardedAgents).not.toBe(first.guardedAgents);
		await fetchResponse(second, request(origin.url));
		expect(origin.connections()).toBe(2);
	});

	test('close はプロキシ用の agent だけを destroy する', () => {
		const pool = new GuardedAgentPool();
		const transport = createTransport({ allowedPrivateNetworks: LOCAL, proxy: { http: 'http://proxy.example:8080' }, agentPool: pool }, {});
		const guardedDestroy = vi.spyOn(transport.guardedAgents!.http, 'destroy');
		const guardedSecureDestroy = vi.spyOn(transport.guardedAgents!.https, 'destroy');
		const proxyDestroy = vi.spyOn(transport.proxyAgents.http!, 'destroy');

		transport.close();
		expect(proxyDestroy).toHaveBeenCalled();
		expect(guardedDestroy).not.toHaveBeenCalled();
		expect(guardedSecureDestroy).not.toHaveBeenCalled();
	});

	test('guard が無効なら pool を使わない', () => {
		const pool = new GuardedAgentPool();
		const transport = createTransport({ agentPool: pool }, { CHIRAMISS_ALLOW_PRIVATE_IP: 'true' });

		expect(transport.guard).toBeNull();
		expect(transport.guardedAgents).toBeNull();
		const withAgents = createTransport({ agent: { http: new http.Agent(), https: new https.Agent() }, agentPool: pool }, {});

		expect(withAgents.guardedAgents).toBeNull();
		expect(pool.size).toBe(0);
	});

	test('待機中の接続は timeout の後に閉じる', async () => {
		const origin = await countingServer();
		const pool = new GuardedAgentPool({ idleTimeout: 100 });
		const transport = createTransport({ allowedPrivateNetworks: LOCAL, agentPool: pool }, {});

		await fetchResponse(transport, request(origin.url));
		transport.close();
		const [serverSide] = origin.sockets;

		expect(freeSockets(transport.guardedAgents!.http)).toHaveLength(1);
		const closed = new Promise(resolve => serverSide.once('close', resolve));

		await closed;
		await vi.waitFor(() => expect(freeSockets(transport.guardedAgents!.http)).toHaveLength(0));
	});

	test('待機中のソケットはホストごとに上限までしか残さない', async () => {
		const origin = await countingServer((_req, res) => {
			setTimeout(() => {
				res.writeHead(200, { 'content-type': 'text/html', 'content-length': '2' });
				res.end('ok');
			}, 50);
		});
		const pool = new GuardedAgentPool({ maxFreeSockets: 2 });
		const transport = createTransport({ allowedPrivateNetworks: LOCAL, agentPool: pool }, {});

		await Promise.all(Array.from({ length: 5 }, () => fetchResponse(transport, request(origin.url))));
		expect(origin.connections()).toBe(5);
		expect(freeSockets(transport.guardedAgents!.http)).toHaveLength(2);
		transport.guardedAgents!.http.destroy();
	});

	test.each([
		['新しい接続', false],
		['再利用した接続', true],
	])('responseTimeout が 0 なら、%sでも待機中の timeout で要求を切らない', async (_name, reuse) => {
		const origin = await countingServer((req, res) => {
			const delay = req.method === 'HEAD' ? 0 : 300;

			setTimeout(() => {
				res.writeHead(200, { 'content-type': 'text/html', 'content-length': '2' });
				res.end(req.method === 'HEAD' ? undefined : 'ok');
			}, delay);
		});
		const pool = new GuardedAgentPool({ idleTimeout: 100 });
		const transport = createTransport({ allowedPrivateNetworks: LOCAL, agentPool: pool }, {});

		if (reuse) {
			await fetchResponse(transport, request(origin.url, { method: 'HEAD' }));
		}
		const result = await fetchResponse(transport, request(origin.url, { responseTimeout: 0 }));

		expect(result.body.toString()).toBe('ok');
		expect(origin.connections()).toBe(1);
		transport.guardedAgents!.http.destroy();
	});

	test('responseTimeout を指定すれば、再利用した接続でもその値で切る', async () => {
		const origin = await countingServer((req, res) => {
			if (req.method === 'HEAD') {
				res.writeHead(200, { 'content-type': 'text/html', 'content-length': '2' });
				res.end();
			}
			// The GET never gets an answer.
		});
		const pool = new GuardedAgentPool({ idleTimeout: 5000 });
		const transport = createTransport({ allowedPrivateNetworks: LOCAL, agentPool: pool }, {});

		await fetchResponse(transport, request(origin.url, { method: 'HEAD' }));
		await expect(fetchResponse(transport, request(origin.url, { responseTimeout: 100 })))
			.rejects.toThrow("Timeout awaiting 'socket' for 100ms");
		expect(freeSockets(transport.guardedAgents!.http)).toHaveLength(0);
	});

	test('responseTimeout が待機中の timeout と同じ値でも、再利用した接続ではサーバの Keep-Alive のヒントで縮んだ timeout で切らない', async () => {
		// Node keeps an idle socket for min(agent timeout, hint - 1 s): `Keep-Alive: timeout=2` leaves it 1000ms,
		// and does not set the socket timeout again for a request whose timeout equals the agent's.
		const server = http.createServer((req, res) => {
			setTimeout(() => {
				res.writeHead(200, { 'content-type': 'text/html', 'content-length': '2' });
				res.end(req.method === 'HEAD' ? undefined : 'ok');
			}, req.method === 'HEAD' ? 0 : 1300);
		});

		server.keepAliveTimeout = 2000;
		const sockets = new Set<net.Socket>();

		server.on('connection', socket => sockets.add(socket));
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
		servers.push({
			url: '',
			close: () => new Promise<void>(resolve => {
				server.close(() => resolve());
				server.closeAllConnections();
			}),
		});
		const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/`;
		const pool = new GuardedAgentPool({ idleTimeout: 1500 });
		const transport = createTransport({ allowedPrivateNetworks: LOCAL, agentPool: pool }, {});
		const head = await fetchResponse(transport, request(url, { method: 'HEAD' }));

		expect(head.headers['keep-alive']).toBe('timeout=2');
		const result = await fetchResponse(transport, request(url, { responseTimeout: 1500 }));

		expect(result.body.toString()).toBe('ok');
		expect(sockets.size).toBe(1);
		transport.guardedAgents!.http.destroy();
	}, 10_000);
});
