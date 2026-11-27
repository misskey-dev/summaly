/**
 * Graceful shutdown of the built server process (src/server/index.ts): SIGTERM lets an in-flight request finish, then exits 0.
 */

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, expect, test } from 'vitest';

const rootDir = fileURLToPath(new URL('../..', import.meta.url));
const PAGE = '<html><head><title>Slow page</title></head><body></body></html>';
const SLOW_MS = 1000;

// On Windows, SIGTERM cannot be handled: child.kill('SIGTERM') terminates the process at once.
const unsupported = process.platform === 'win32';

const cleanups: (() => void | Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) {
		await cleanup();
	}
});

beforeAll(() => {
	if (unsupported) {
		return;
	}
	// The test runs the real entry point, so build it first.
	execFileSync('pnpm', ['build'], { cwd: rootDir, stdio: 'ignore' });
}, 120_000);

/** A page server that answers after SLOW_MS and resolves `requested` when the request arrives. */
async function startSlowServer(): Promise<{ url: string; requested: Promise<void> }> {
	let onRequest!: () => void;
	const requested = new Promise<void>(resolve => onRequest = resolve);
	const server = http.createServer((_req, res) => {
		onRequest();
		setTimeout(() => res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE), SLOW_MS);
	});

	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	cleanups.push(() => new Promise<void>(resolve => {
		server.close(() => resolve());
		server.closeAllConnections();
	}));
	const { port } = server.address() as AddressInfo;

	return { url: `http://127.0.0.1:${port}/`, requested };
}

/** Starts `node built-server/server.mjs` on a free port and resolves with its base URL once it is listening. */
async function startServerProcess(): Promise<{ child: ChildProcess; url: string; exited: Promise<number | null> }> {
	const env: NodeJS.ProcessEnv = { ...process.env, SUMMALY_HOST: '127.0.0.1', SUMMALY_PORT: '0', SUMMALY_ALLOWED_PRIVATE_NETWORKS: '127.0.0.0/8' };

	for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']) {
		delete env[name];
	}
	const child = spawn(process.execPath, ['built-server/server.mjs'], { cwd: rootDir, env, stdio: ['ignore', 'pipe', 'inherit'] });
	const exited = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)));

	cleanups.push(() => {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill('SIGKILL');
		}
	});

	const url = await new Promise<string>((resolve, reject) => {
		let output = '';

		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			output += chunk;
			// fastify's logger prints e.g. {"msg":"Server listening at http://127.0.0.1:12345"}
			const match = /Server listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(output);

			if (match) {
				resolve(match[1]);
			}
		});
		child.once('exit', code => reject(new Error(`server exited early (${code}): ${output}`)));
	});

	return { child, url, exited };
}

test.skipIf(unsupported)('SIGTERM を受けても処理中の要求は 200 で完了し、keep-alive の接続が残っていてもプロセスは 0 で終わる', async () => {
	const page = await startSlowServer();
	const server = await startServerProcess();

	// fetch keeps the connection alive, as the host app's HTTP client does.
	const response = fetch(`${server.url}/?url=${encodeURIComponent(page.url)}`);

	await page.requested;
	server.child.kill('SIGTERM');

	const res = await response;

	expect(res.status).toBe(200);
	expect(await res.json()).toMatchObject({ title: 'Slow page', url: page.url });
	expect(await server.exited).toBe(0);
}, 30_000);
