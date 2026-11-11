/**
 * Tests for the standalone server configuration
 */

'use strict';

import fs from 'node:fs';
import process from 'node:process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import fastify, { type FastifyInstance } from 'fastify';
import Summaly from '@/index.js';
import { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT, ServerConfigError, loadServerConfig } from '@/server/config.js';

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);

process.env.NODE_ENV = 'test';

describe('loadServerConfig', () => {
	test('何も指定しない場合はデフォルト値になる', () => {
		expect(loadServerConfig({})).toEqual({
			host: 'localhost',
			port: 3000,
			summalyOptions: {},
		});
		expect(DEFAULT_SERVER_HOST).toBe('localhost');
		expect(DEFAULT_SERVER_PORT).toBe(3000);
	});

	test('何も指定しない場合、summalyOptions にキーが含まれない', () => {
		expect(Object.keys(loadServerConfig({}).summalyOptions)).toEqual([]);
	});

	test('関係のない環境変数は無視される', () => {
		expect(loadServerConfig({ PATH: '/usr/bin', LANG: 'ja_JP.UTF-8', PORT: '8080', HOST: '0.0.0.0' })).toEqual({
			host: 'localhost',
			port: 3000,
			summalyOptions: {},
		});
	});

	test('すべての環境変数が反映される', () => {
		expect(loadServerConfig({
			SUMMALY_HOST: '0.0.0.0',
			SUMMALY_PORT: '8080',
			SUMMALY_LANG: 'ja-JP',
			SUMMALY_USER_AGENT: 'MyBot/1.0',
			SUMMALY_FOLLOW_REDIRECTS: 'false',
			SUMMALY_RESPONSE_TIMEOUT: '1000',
			SUMMALY_OPERATION_TIMEOUT: '5000',
			SUMMALY_CONTENT_LENGTH_LIMIT: '1048576',
			SUMMALY_CONTENT_LENGTH_REQUIRED: 'true',
		})).toEqual({
			host: '0.0.0.0',
			port: 8080,
			summalyOptions: {
				lang: 'ja-JP',
				userAgent: 'MyBot/1.0',
				followRedirects: false,
				responseTimeout: 1000,
				operationTimeout: 5000,
				contentLengthLimit: 1048576,
				contentLengthRequired: true,
			},
		});
	});

	describe('環境変数ごとの反映', () => {
		test('SUMMALY_HOST', () => {
			expect(loadServerConfig({ SUMMALY_HOST: '::' }).host).toBe('::');
			expect(loadServerConfig({ SUMMALY_HOST: '127.0.0.1' }).host).toBe('127.0.0.1');
		});

		test('SUMMALY_PORT', () => {
			expect(loadServerConfig({ SUMMALY_PORT: '0' }).port).toBe(0);
			expect(loadServerConfig({ SUMMALY_PORT: '80' }).port).toBe(80);
			expect(loadServerConfig({ SUMMALY_PORT: '65535' }).port).toBe(65535);
			expect(loadServerConfig({ SUMMALY_PORT: '03000' }).port).toBe(3000);
		});

		test('SUMMALY_LANG', () => {
			expect(loadServerConfig({ SUMMALY_LANG: 'en-US' }).summalyOptions).toEqual({ lang: 'en-US' });
		});

		test('SUMMALY_USER_AGENT', () => {
			expect(loadServerConfig({ SUMMALY_USER_AGENT: 'Mozilla/5.0 (compatible; Test)' }).summalyOptions).toEqual({ userAgent: 'Mozilla/5.0 (compatible; Test)' });
		});

		test('SUMMALY_FOLLOW_REDIRECTS', () => {
			expect(loadServerConfig({ SUMMALY_FOLLOW_REDIRECTS: 'true' }).summalyOptions).toEqual({ followRedirects: true });
			expect(loadServerConfig({ SUMMALY_FOLLOW_REDIRECTS: 'false' }).summalyOptions).toEqual({ followRedirects: false });
		});

		test('SUMMALY_RESPONSE_TIMEOUT', () => {
			expect(loadServerConfig({ SUMMALY_RESPONSE_TIMEOUT: '0' }).summalyOptions).toEqual({ responseTimeout: 0 });
			expect(loadServerConfig({ SUMMALY_RESPONSE_TIMEOUT: '20000' }).summalyOptions).toEqual({ responseTimeout: 20000 });
		});

		test('SUMMALY_OPERATION_TIMEOUT', () => {
			expect(loadServerConfig({ SUMMALY_OPERATION_TIMEOUT: '60000' }).summalyOptions).toEqual({ operationTimeout: 60000 });
		});

		test('SUMMALY_CONTENT_LENGTH_LIMIT', () => {
			expect(loadServerConfig({ SUMMALY_CONTENT_LENGTH_LIMIT: '10485760' }).summalyOptions).toEqual({ contentLengthLimit: 10485760 });
		});

		test('SUMMALY_CONTENT_LENGTH_REQUIRED', () => {
			expect(loadServerConfig({ SUMMALY_CONTENT_LENGTH_REQUIRED: 'true' }).summalyOptions).toEqual({ contentLengthRequired: true });
			expect(loadServerConfig({ SUMMALY_CONTENT_LENGTH_REQUIRED: 'false' }).summalyOptions).toEqual({ contentLengthRequired: false });
		});
	});

	describe('真偽値', () => {
		test.each([
			['true', true],
			['TRUE', true],
			['True', true],
			['1', true],
			['false', false],
			['FALSE', false],
			['False', false],
			['0', false],
		])('%j は %j として扱われる', (value, expected) => {
			expect(loadServerConfig({ SUMMALY_FOLLOW_REDIRECTS: value }).summalyOptions.followRedirects).toBe(expected);
			expect(loadServerConfig({ SUMMALY_CONTENT_LENGTH_REQUIRED: value }).summalyOptions.contentLengthRequired).toBe(expected);
		});

		test.each(['yes', 'no', 'on', 'off', '2', '-1', ' true', 'true ', 't', ' '])('%j はエラーになる', (value) => {
			for (const name of ['SUMMALY_FOLLOW_REDIRECTS', 'SUMMALY_CONTENT_LENGTH_REQUIRED']) {
				expect(() => loadServerConfig({ [name]: value })).toThrow(ServerConfigError);
				expect(() => loadServerConfig({ [name]: value })).toThrow(`Invalid value for ${name}: ${JSON.stringify(value)}`);
			}
		});
	});

	describe('整数', () => {
		const integerVariables = [
			'SUMMALY_PORT',
			'SUMMALY_RESPONSE_TIMEOUT',
			'SUMMALY_OPERATION_TIMEOUT',
			'SUMMALY_CONTENT_LENGTH_LIMIT',
		];

		test.each(['abc', '1e3', '12abc', '-1', '+1', '1.5', '1.0', '0x10', ' ', ' 1', '1 ', 'Infinity', 'NaN'])('%j はエラーになる', (value) => {
			for (const name of integerVariables) {
				expect(() => loadServerConfig({ [name]: value })).toThrow(ServerConfigError);
				expect(() => loadServerConfig({ [name]: value })).toThrow(`Invalid value for ${name}: ${JSON.stringify(value)}`);
			}
		});

		test('65535 を超えるポートはエラーになる', () => {
			expect(() => loadServerConfig({ SUMMALY_PORT: '65536' })).toThrow('Invalid value for SUMMALY_PORT: "65536"');
			expect(() => loadServerConfig({ SUMMALY_PORT: '99999999999999999999' })).toThrow(ServerConfigError);
		});

		test.each(['SUMMALY_RESPONSE_TIMEOUT', 'SUMMALY_OPERATION_TIMEOUT'])('%s は setTimeout の最大値までに制限される', (name) => {
			expect(loadServerConfig({ [name]: '2147483647' }).summalyOptions).toEqual({
				[name === 'SUMMALY_RESPONSE_TIMEOUT' ? 'responseTimeout' : 'operationTimeout']: 2147483647,
			});
			expect(() => loadServerConfig({ [name]: '2147483648' })).toThrow(ServerConfigError);
			expect(() => loadServerConfig({ [name]: '2147483648' })).toThrow(`Invalid value for ${name}: "2147483648" (expected an integer between 0 and 2147483647)`);
			expect(() => loadServerConfig({ [name]: '3000000000' })).toThrow(`Invalid value for ${name}: "3000000000"`);
		});

		test('安全な整数の範囲を超える値はエラーになる', () => {
			expect(() => loadServerConfig({ SUMMALY_CONTENT_LENGTH_LIMIT: '9007199254740992' })).toThrow('Invalid value for SUMMALY_CONTENT_LENGTH_LIMIT');
			expect(loadServerConfig({ SUMMALY_CONTENT_LENGTH_LIMIT: '9007199254740991' }).summalyOptions.contentLengthLimit).toBe(Number.MAX_SAFE_INTEGER);
		});
	});

	test('空文字は未設定として扱われる', () => {
		const config = loadServerConfig({
			SUMMALY_HOST: '',
			SUMMALY_PORT: '',
			SUMMALY_LANG: '',
			SUMMALY_USER_AGENT: '',
			SUMMALY_FOLLOW_REDIRECTS: '',
			SUMMALY_RESPONSE_TIMEOUT: '',
			SUMMALY_OPERATION_TIMEOUT: '',
			SUMMALY_CONTENT_LENGTH_LIMIT: '',
			SUMMALY_CONTENT_LENGTH_REQUIRED: '',
		});
		expect(config).toEqual({ host: 'localhost', port: 3000, summalyOptions: {} });
		expect(Object.keys(config.summalyOptions)).toEqual([]);
	});

	test('undefined は未設定として扱われる', () => {
		const config = loadServerConfig({ SUMMALY_LANG: undefined, SUMMALY_PORT: undefined });
		expect(config).toEqual({ host: 'localhost', port: 3000, summalyOptions: {} });
		expect(Object.keys(config.summalyOptions)).toEqual([]);
	});

	test('渡された env を変更しない', () => {
		const env = { SUMMALY_PORT: '8080', SUMMALY_LANG: '' };
		loadServerConfig(env);
		expect(env).toEqual({ SUMMALY_PORT: '8080', SUMMALY_LANG: '' });
	});
});

describe('環境変数で設定したサーバーの動作', () => {
	let app: FastifyInstance | null = null;
	let target: FastifyInstance | null = null;
	let targetUrl = '';
	let received: { userAgent?: string; acceptLanguage?: string } = {};
	const content = fs.readFileSync(_dirname + '/htmls/basic.html');

	beforeEach(async () => {
		// The page to be summarized is served by a local server, so no external network access happens
		process.env.SUMMALY_ALLOW_PRIVATE_IP = 'true';
		received = {};

		target = fastify();
		target.get('/', (request, reply) => {
			received = {
				userAgent: request.headers['user-agent'],
				acceptLanguage: request.headers['accept-language'],
			};
			reply.header('content-length', content.byteLength);
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		await target.listen({ host: '127.0.0.1', port: 0 });
		targetUrl = `http://127.0.0.1:${(target.server.address() as AddressInfo).port}/`;
	});

	afterEach(async () => {
		process.env.SUMMALY_ALLOW_PRIVATE_IP = 'false';
		await app?.close();
		await target?.close();
		app = null;
		target = null;
	});

	async function createApp(env: NodeJS.ProcessEnv): Promise<FastifyInstance> {
		const instance = fastify();
		await instance.register(Summaly, loadServerConfig(env).summalyOptions);
		await instance.ready();
		return instance;
	}

	test('url が指定されていない場合は 400 になる', async () => {
		app = await createApp({});
		const res = await app.inject({ method: 'GET', url: '/' });
		expect(res.statusCode).toBe(400);
		expect(res.json()).toEqual({ error: 'url is required' });
	});

	test('環境変数で指定したオプションがプラグインに渡される', async () => {
		app = await createApp({
			SUMMALY_USER_AGENT: 'env-ua/1.0',
			SUMMALY_LANG: 'en-US',
		});
		const res = await app.inject({ method: 'GET', url: '/', query: { url: targetUrl } });

		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({ title: 'KISS principle', url: targetUrl });
		expect(received.userAgent).toBe('env-ua/1.0');
		expect(received.acceptLanguage).toBe('en-US');
	});

	test('SUMMALY_LANG が未設定の場合、lang クエリパラメータが上書きされない', async () => {
		app = await createApp({ SUMMALY_USER_AGENT: 'env-ua/1.0' });
		const res = await app.inject({ method: 'GET', url: '/', query: { url: targetUrl, lang: 'ja-JP' } });

		expect(res.statusCode).toBe(200);
		expect(received.acceptLanguage).toBe('ja-JP');
		expect(received.userAgent).toBe('env-ua/1.0');
	});

	test('SUMMALY_LANG が空文字の場合、lang クエリパラメータが上書きされない', async () => {
		app = await createApp({ SUMMALY_LANG: '' });
		const res = await app.inject({ method: 'GET', url: '/', query: { url: targetUrl, lang: 'ja-JP' } });

		expect(res.statusCode).toBe(200);
		expect(received.acceptLanguage).toBe('ja-JP');
	});

	test('SUMMALY_CONTENT_LENGTH_LIMIT が適用される', async () => {
		app = await createApp({ SUMMALY_CONTENT_LENGTH_LIMIT: String(content.byteLength - 1) });
		const res = await app.inject({ method: 'GET', url: '/', query: { url: targetUrl } });

		expect(res.statusCode).toBe(500);
	});
});
