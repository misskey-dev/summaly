/**
 * Tests for the Docker image
 *
 * Starts a container from the image and checks that requests reach the server.
 * Run with `pnpm test:docker`, which builds the image before running this file.
 * Set SUMMALY_TEST_IMAGE to test an image that has already been built.
 */

'use strict';

import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, describe, beforeAll, afterAll } from 'vitest';

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);

const execFileAsync = promisify(execFile);

const image = process.env.SUMMALY_TEST_IMAGE || 'summaly:test';

/**
 * Serves /fixtures/basic.html and prints the User-Agent of each request.
 * Runs in a container on the same network as the summaly container,
 * so that the test does not depend on how containers reach the host.
 */
const fixtureServerScript = `
const http = require('node:http');
const fs = require('node:fs');
const body = fs.readFileSync('/fixtures/basic.html');
http.createServer((req, res) => {
	console.log(JSON.stringify({ userAgent: req.headers['user-agent'] }));
	res.writeHead(200, { 'content-type': 'text/html', 'content-length': body.byteLength });
	res.end(body);
}).listen(8080, () => console.log('ready'));
`;

type DockerResult = { exitCode: number; stdout: string; stderr: string };

async function docker(args: string[]): Promise<DockerResult> {
	try {
		const { stdout, stderr } = await execFileAsync('docker', args);
		return { exitCode: 0, stdout, stderr };
	} catch (err) {
		const e = err as { code?: unknown; stdout?: string; stderr?: string };
		if (typeof e.code !== 'number') throw err;
		return { exitCode: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
	}
}

async function dockerOk(args: string[]): Promise<string> {
	const res = await docker(args);
	if (res.exitCode !== 0) {
		throw new Error(`docker ${args.join(' ')} failed (exit ${res.exitCode}): ${res.stderr}`);
	}
	return res.stdout.trim();
}

async function removeContainer(id: string): Promise<void> {
	await docker(['rm', '-f', id]);
}

async function waitFor(id: string, isReady: () => Promise<boolean>): Promise<void> {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (await isReady()) return;
		const running = await dockerOk(['inspect', '-f', '{{.State.Running}}', id]);
		if (running !== 'true') {
			const logs = await docker(['logs', id]);
			throw new Error(`Container ${id} exited before it became ready:\n${logs.stdout}${logs.stderr}`);
		}
		await new Promise(resolve => setTimeout(resolve, 200));
	}
	throw new Error(`Container ${id} did not become ready within 30 seconds`);
}

describe('Docker イメージ', () => {
	const network = `summaly-test-${randomUUID()}`;
	const targetUrl = 'http://fixture:8080/';
	let fixtureId = '';

	beforeAll(async () => {
		await dockerOk(['network', 'create', network]);

		// The image under test already contains Node.js, so it is reused for the fixture server
		fixtureId = await dockerOk([
			'run', '-d', '--pull', 'never',
			'--network', network, '--network-alias', 'fixture',
			'-v', `${join(_dirname, 'fixtures', 'htmls')}:/fixtures:ro`,
			'--entrypoint', 'node',
			image, '-e', fixtureServerScript,
		]);
		await waitFor(fixtureId, async () => (await dockerOk(['logs', fixtureId])).includes('ready'));
	}, 60_000);

	afterAll(async () => {
		if (fixtureId) await removeContainer(fixtureId);
		await docker(['network', 'rm', network]);
	});

	/** User-Agents of the requests the fixture server has received so far */
	async function receivedUserAgents(): Promise<string[]> {
		return (await dockerOk(['logs', fixtureId]))
			.split('\n')
			.filter(line => line.startsWith('{'))
			.map(line => (JSON.parse(line) as { userAgent: string }).userAgent);
	}

	/**
	 * Starts a summaly container with the port 3000 published on a random port of 127.0.0.1
	 * and waits until the server accepts requests
	 */
	async function startContainer(env: Record<string, string>): Promise<{ id: string; baseUrl: string }> {
		const envArgs = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
		const id = await dockerOk([
			'run', '-d', '--pull', 'never',
			'--network', network,
			'-p', '127.0.0.1::3000',
			...envArgs,
			image,
		]);

		try {
			// e.g. "127.0.0.1:49153"
			const hostPort = (await dockerOk(['port', id, '3000/tcp'])).split('\n')[0];
			const baseUrl = `http://${hostPort}`;
			await waitFor(id, async () => {
				try {
					// Without a timeout, the request may hang when the container has already exited
					await fetch(baseUrl, { signal: AbortSignal.timeout(1000) });
					return true;
				} catch {
					return false;
				}
			});
			return { id, baseUrl };
		} catch (err) {
			await removeContainer(id);
			throw err;
		}
	}

	describe('起動したコンテナへのリクエスト', () => {
		let container: { id: string; baseUrl: string } | null = null;

		beforeAll(async () => {
			container = await startContainer({
				// The fixture server has a private IP address on the Docker network
				SUMMALY_ALLOW_PRIVATE_IP: 'true',
				SUMMALY_USER_AGENT: 'summaly-docker-test/1.0',
			});
		}, 60_000);

		afterAll(async () => {
			if (container) await removeContainer(container.id);
		});

		test('url が指定されていない場合は 400 になる', async () => {
			const res = await fetch(container!.baseUrl);
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({ error: 'url is required' });
		});

		test('ページの要約を取得できる', async () => {
			const res = await fetch(`${container!.baseUrl}/?url=${encodeURIComponent(targetUrl)}`);
			expect(res.status).toBe(200);
			expect(await res.json()).toMatchObject({ title: 'KISS principle', url: targetUrl });
		});

		test('環境変数で指定したオプションが反映される', async () => {
			const before = (await receivedUserAgents()).length;
			const res = await fetch(`${container!.baseUrl}/?url=${encodeURIComponent(targetUrl)}`);
			expect(res.status).toBe(200);
			// The page itself is fetched with SUMMALY_USER_AGENT (the favicon check may follow with another User-Agent)
			expect((await receivedUserAgents()).slice(before)).toContain('summaly-docker-test/1.0');
		});

		test('root 以外のユーザーで実行される', async () => {
			const uid = await dockerOk(['exec', container!.id, 'id', '-u']);
			expect(uid).not.toBe('0');
		});
	});

	test('プライベート IP アドレスのページはデフォルトで拒否される', async () => {
		const container = await startContainer({});
		try {
			const res = await fetch(`${container.baseUrl}/?url=${encodeURIComponent(targetUrl)}`);
			expect(res.status).toBe(500);
			expect(await res.json()).toMatchObject({ error: { statusMessage: 'Private IP Rejected' } });
		} finally {
			await removeContainer(container.id);
		}
	}, 60_000);

	test('docker stop で終了コード 0 で終了する', async () => {
		const container = await startContainer({});
		try {
			await dockerOk(['stop', '--time', '10', container.id]);
			// 137 would mean that the server ignored SIGTERM and was killed
			const exitCode = await dockerOk(['inspect', '-f', '{{.State.ExitCode}}', container.id]);
			expect(exitCode).toBe('0');
		} finally {
			await removeContainer(container.id);
		}
	}, 60_000);

	test('不正な環境変数を指定すると終了コード 1 で終了する', async () => {
		const res = await docker(['run', '--rm', '--pull', 'never', '-e', 'SUMMALY_PORT=abc', image]);
		expect(res.exitCode).toBe(1);
		expect(res.stderr).toContain('Invalid value for SUMMALY_PORT: "abc"');
	}, 60_000);
});
