// Derived from misskey-dev/summaly (MIT)
/**
 * Tests for the standalone server configuration
 */

import { expect, test, describe } from 'vitest';
import { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT, ServerConfigError, loadServerConfig, type ServerConfig } from '../src/config.js';

describe('loadServerConfig', () => {
	test('何も指定しない場合はデフォルト値になる', () => {
		expect(loadServerConfig({})).toEqual({
			host: 'localhost',
			port: 3000,
			summarizeOptions: {},
		});
		expect(DEFAULT_SERVER_HOST).toBe('localhost');
		expect(DEFAULT_SERVER_PORT).toBe(3000);
	});

	test('何も指定しない場合、summarizeOptions にキーが含まれない', () => {
		expect(Object.keys(loadServerConfig({}).summarizeOptions)).toEqual([]);
	});

	test('関係のない環境変数は無視される', () => {
		expect(loadServerConfig({ PATH: '/usr/bin', LANG: 'ja_JP.UTF-8', PORT: '8080', HOST: '0.0.0.0' })).toEqual({
			host: 'localhost',
			port: 3000,
			summarizeOptions: {},
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
			summarizeOptions: {
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
			expect(loadServerConfig({ SUMMALY_LANG: 'en-US' }).summarizeOptions).toEqual({ lang: 'en-US' });
		});

		test('SUMMALY_USER_AGENT', () => {
			expect(loadServerConfig({ SUMMALY_USER_AGENT: 'Mozilla/5.0 (compatible; Test)' }).summarizeOptions).toEqual({ userAgent: 'Mozilla/5.0 (compatible; Test)' });
		});

		test('SUMMALY_FOLLOW_REDIRECTS', () => {
			expect(loadServerConfig({ SUMMALY_FOLLOW_REDIRECTS: 'true' }).summarizeOptions).toEqual({ followRedirects: true });
			expect(loadServerConfig({ SUMMALY_FOLLOW_REDIRECTS: 'false' }).summarizeOptions).toEqual({ followRedirects: false });
		});

		test('SUMMALY_RESPONSE_TIMEOUT', () => {
			expect(loadServerConfig({ SUMMALY_RESPONSE_TIMEOUT: '0' }).summarizeOptions).toEqual({ responseTimeout: 0 });
			expect(loadServerConfig({ SUMMALY_RESPONSE_TIMEOUT: '20000' }).summarizeOptions).toEqual({ responseTimeout: 20000 });
		});

		test('SUMMALY_OPERATION_TIMEOUT', () => {
			expect(loadServerConfig({ SUMMALY_OPERATION_TIMEOUT: '60000' }).summarizeOptions).toEqual({ operationTimeout: 60000 });
		});

		test('SUMMALY_CONTENT_LENGTH_LIMIT', () => {
			expect(loadServerConfig({ SUMMALY_CONTENT_LENGTH_LIMIT: '10485760' }).summarizeOptions).toEqual({ contentLengthLimit: 10485760 });
		});

		test('SUMMALY_CONTENT_LENGTH_REQUIRED', () => {
			expect(loadServerConfig({ SUMMALY_CONTENT_LENGTH_REQUIRED: 'true' }).summarizeOptions).toEqual({ contentLengthRequired: true });
			expect(loadServerConfig({ SUMMALY_CONTENT_LENGTH_REQUIRED: 'false' }).summarizeOptions).toEqual({ contentLengthRequired: false });
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
			expect(loadServerConfig({ SUMMALY_FOLLOW_REDIRECTS: value }).summarizeOptions.followRedirects).toBe(expected);
			expect(loadServerConfig({ SUMMALY_CONTENT_LENGTH_REQUIRED: value }).summarizeOptions.contentLengthRequired).toBe(expected);
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
			'SUMMALY_CACHE_TTL',
			'SUMMALY_ERROR_CACHE_TTL',
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
			expect(loadServerConfig({ [name]: '2147483647' }).summarizeOptions).toEqual({
				[name === 'SUMMALY_RESPONSE_TIMEOUT' ? 'responseTimeout' : 'operationTimeout']: 2147483647,
			});
			expect(() => loadServerConfig({ [name]: '2147483648' })).toThrow(ServerConfigError);
			expect(() => loadServerConfig({ [name]: '2147483648' })).toThrow(`Invalid value for ${name}: "2147483648" (expected an integer between 0 and 2147483647)`);
			expect(() => loadServerConfig({ [name]: '3000000000' })).toThrow(`Invalid value for ${name}: "3000000000"`);
		});

		test('安全な整数の範囲を超える値はエラーになる', () => {
			expect(() => loadServerConfig({ SUMMALY_CONTENT_LENGTH_LIMIT: '9007199254740992' })).toThrow('Invalid value for SUMMALY_CONTENT_LENGTH_LIMIT');
			expect(loadServerConfig({ SUMMALY_CONTENT_LENGTH_LIMIT: '9007199254740991' }).summarizeOptions.contentLengthLimit).toBe(Number.MAX_SAFE_INTEGER);
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
			SUMMALY_ALLOWED_PRIVATE_NETWORKS: '',
			SUMMALY_CACHE_TTL: '',
			SUMMALY_ERROR_CACHE_TTL: '',
			HTTP_PROXY: '',
			http_proxy: '',
			HTTPS_PROXY: '',
			https_proxy: '',
			NO_PROXY: '',
			no_proxy: '',
		});
		expect(config).toEqual({ host: 'localhost', port: 3000, summarizeOptions: {} });
		expect(Object.keys(config.summarizeOptions)).toEqual([]);
	});

	test('undefined は未設定として扱われる', () => {
		const config = loadServerConfig({ SUMMALY_LANG: undefined, SUMMALY_PORT: undefined, HTTPS_PROXY: undefined });
		expect(config).toEqual({ host: 'localhost', port: 3000, summarizeOptions: {} });
		expect(Object.keys(config.summarizeOptions)).toEqual([]);
	});

	test('渡された env を変更しない', () => {
		const env = { SUMMALY_PORT: '8080', SUMMALY_LANG: '' };
		loadServerConfig(env);
		expect(env).toEqual({ SUMMALY_PORT: '8080', SUMMALY_LANG: '' });
	});

	// chiramiss additions below

	test('SUMMALY_ALLOWED_PRIVATE_NETWORKS をカンマ区切りで読む、不正な CIDR はエラー', () => {
		expect(loadServerConfig({ SUMMALY_ALLOWED_PRIVATE_NETWORKS: '127.0.0.0/8' }).summarizeOptions).toEqual({
			allowedPrivateNetworks: ['127.0.0.0/8'],
		});
		expect(loadServerConfig({ SUMMALY_ALLOWED_PRIVATE_NETWORKS: '10.0.0.0/8,fd00::/8, 192.168.0.0/16 ,' }).summarizeOptions).toEqual({
			allowedPrivateNetworks: ['10.0.0.0/8', 'fd00::/8', '192.168.0.0/16'],
		});

		for (const value of ['foo', '10.0.0.0/33', '127.0.0.1', '10.0.0.0/8,nope', '::1/129', ',']) {
			expect(() => loadServerConfig({ SUMMALY_ALLOWED_PRIVATE_NETWORKS: value })).toThrow(ServerConfigError);
			expect(() => loadServerConfig({ SUMMALY_ALLOWED_PRIVATE_NETWORKS: value })).toThrow(`Invalid value for SUMMALY_ALLOWED_PRIVATE_NETWORKS: ${JSON.stringify(value)}`);
		}
	});

	test.each(['192.168.010.0/24', '010.0.0.0/8', '0x7f.1/32', '127.1/8', '0x7f000001/32', '2130706433/32', '10.0.0.0/8,192.168.010.0/24'])
		('SUMMALY_ALLOWED_PRIVATE_NETWORKS の正規でない IPv4 CIDR %s はエラー', value => {
			expect(() => loadServerConfig({ SUMMALY_ALLOWED_PRIVATE_NETWORKS: value })).toThrow(ServerConfigError);
			expect(() => loadServerConfig({ SUMMALY_ALLOWED_PRIVATE_NETWORKS: value })).toThrow(`Invalid value for SUMMALY_ALLOWED_PRIVATE_NETWORKS: ${JSON.stringify(value)}`);
		});

	test.each([
		['::ffff:192.168.0.0/112', '192.168.0.0/16'],
		['::ffff:127.0.0.1/128', '127.0.0.1/32'],
		['10.0.0.0/8,::ffff:0:0/96', '0.0.0.0/0'],
	])('SUMMALY_ALLOWED_PRIVATE_NETWORKS の IPv4 射影 IPv6 CIDR %s は IPv4 形式を促すエラー', (value, ipv4) => {
		expect(() => loadServerConfig({ SUMMALY_ALLOWED_PRIVATE_NETWORKS: value })).toThrow(ServerConfigError);
		expect(() => loadServerConfig({ SUMMALY_ALLOWED_PRIVATE_NETWORKS: value })).toThrow(`write it in IPv4 form (${ipv4})`);
	});

	test('SUMMALY_ALLOWED_PRIVATE_NETWORKS の IPv4 射影 IPv6 の範囲が /96 より広い CIDR もエラー', () => {
		expect(() => loadServerConfig({ SUMMALY_ALLOWED_PRIVATE_NETWORKS: '::ffff:0:0/80' })).toThrow('write it in IPv4 form');
	});

	test('SUMMALY_ALLOWED_PRIVATE_NETWORKS の正規の IPv4 / IPv6 CIDR は受け付ける', () => {
		const value = '0.0.0.0/0,10.0.0.0/8,192.168.10.0/24,::/0,::1/128,fd00::/8,2001:db8::/32';
		expect(loadServerConfig({ SUMMALY_ALLOWED_PRIVATE_NETWORKS: value }).summarizeOptions).toEqual({
			allowedPrivateNetworks: value.split(','),
		});
	});

	describe('プロキシ', () => {
		test('HTTPS_PROXY / NO_PROXY を proxy に入れる、大文字が小文字より優先', () => {
			expect(loadServerConfig({
				HTTPS_PROXY: 'http://proxy.example:3128',
				NO_PROXY: 'localhost,.internal',
			}).summarizeOptions).toEqual({
				proxy: { https: 'http://proxy.example:3128', noProxy: 'localhost,.internal' },
			});

			expect(loadServerConfig({
				HTTP_PROXY: 'http://upper.example:3128',
				http_proxy: 'http://lower.example:3128',
				HTTPS_PROXY: 'https://upper.example:3129',
				https_proxy: 'https://lower.example:3129',
				NO_PROXY: 'upper.example',
				no_proxy: 'lower.example',
			}).summarizeOptions).toEqual({
				proxy: {
					http: 'http://upper.example:3128',
					https: 'https://upper.example:3129',
					noProxy: 'upper.example',
				},
			});
		});

		test('小文字の変数だけでも読む', () => {
			expect(loadServerConfig({
				http_proxy: 'http://lower.example:3128',
				https_proxy: 'http://lower.example:3129',
				no_proxy: '*',
			}).summarizeOptions).toEqual({
				proxy: {
					http: 'http://lower.example:3128',
					https: 'http://lower.example:3129',
					noProxy: '*',
				},
			});
		});

		test('大文字が空文字なら小文字を使う', () => {
			expect(loadServerConfig({ HTTP_PROXY: '', http_proxy: 'http://lower.example:3128' }).summarizeOptions).toEqual({
				proxy: { http: 'http://lower.example:3128' },
			});
		});

		test.each([
			'proxy.example:3128',
			'socks5://proxy.example:1080',
			'http://',
			'not a url',
			'file:///tmp/proxy',
		])('不正なプロキシ URL %j はエラーになる', (value) => {
			for (const name of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy']) {
				expect(() => loadServerConfig({ [name]: value })).toThrow(ServerConfigError);
				expect(() => loadServerConfig({ [name]: value })).toThrow(`Invalid value for ${name}: `);
			}
		});

		test.each([
			['socks5://user:secret@proxy.example:1080', '"socks5://***@proxy.example:1080"'],
			['user:secret@proxy.example:3128', '"***@proxy.example:3128"'],
			['http://user:sec@ret@', '"http://***@"'],
			['ftp://user:secret@proxy.example', '"ftp://***@proxy.example"'],
		])('エラーメッセージに認証情報を含めない (%j)', (value, shown) => {
			let message = '';
			try {
				loadServerConfig({ HTTPS_PROXY: value });
			} catch (err) {
				expect(err).toBeInstanceOf(ServerConfigError);
				message = (err as Error).message;
			}
			expect(message).toContain(`Invalid value for HTTPS_PROXY: ${shown}`);
			expect(message).not.toContain('secret');
			expect(message).not.toContain('sec@ret');
			expect(message).not.toContain('user');
		});
	});

	test('SUMMALY_CACHE_TTL / SUMMALY_ERROR_CACHE_TTL を読む', () => {
		expect(loadServerConfig({ SUMMALY_CACHE_TTL: '60000', SUMMALY_ERROR_CACHE_TTL: '5000' }).summarizeOptions).toEqual({
			cacheTtl: 60000,
			errorCacheTtl: 5000,
		});
		expect(loadServerConfig({ SUMMALY_CACHE_TTL: '0', SUMMALY_ERROR_CACHE_TTL: '0' }).summarizeOptions).toEqual({
			cacheTtl: 0,
			errorCacheTtl: 0,
		});
	});
});

describe('CHIRAMISS_* と SUMMALY_*', () => {
	type Case = {
		/** Name without the CHIRAMISS_ / SUMMALY_ prefix */
		suffix: string;
		/** A valid value, the config it gives, another valid value and the config that one gives */
		value: string;
		expected: Partial<ServerConfig>;
		other: string;
		otherExpected: Partial<ServerConfig>;
		/** A value that is rejected */
		invalid: string;
	};

	const cases: Case[] = [
		{ suffix: 'HOST', value: '0.0.0.0', expected: { host: '0.0.0.0' }, other: '::', otherExpected: { host: '::' }, invalid: '' },
		{ suffix: 'PORT', value: '8080', expected: { port: 8080 }, other: '9090', otherExpected: { port: 9090 }, invalid: 'abc' },
		{ suffix: 'LANG', value: 'ja-JP', expected: { summarizeOptions: { lang: 'ja-JP' } }, other: 'en-US', otherExpected: { summarizeOptions: { lang: 'en-US' } }, invalid: '' },
		{ suffix: 'USER_AGENT', value: 'ChiramissUA/1.0', expected: { summarizeOptions: { userAgent: 'ChiramissUA/1.0' } }, other: 'SummalyUA/1.0', otherExpected: { summarizeOptions: { userAgent: 'SummalyUA/1.0' } }, invalid: '' },
		{ suffix: 'FOLLOW_REDIRECTS', value: 'false', expected: { summarizeOptions: { followRedirects: false } }, other: 'true', otherExpected: { summarizeOptions: { followRedirects: true } }, invalid: 'yes' },
		{ suffix: 'RESPONSE_TIMEOUT', value: '1000', expected: { summarizeOptions: { responseTimeout: 1000 } }, other: '2000', otherExpected: { summarizeOptions: { responseTimeout: 2000 } }, invalid: '-1' },
		{ suffix: 'OPERATION_TIMEOUT', value: '5000', expected: { summarizeOptions: { operationTimeout: 5000 } }, other: '6000', otherExpected: { summarizeOptions: { operationTimeout: 6000 } }, invalid: '1.5' },
		{ suffix: 'CONTENT_LENGTH_LIMIT', value: '1048576', expected: { summarizeOptions: { contentLengthLimit: 1048576 } }, other: '2048', otherExpected: { summarizeOptions: { contentLengthLimit: 2048 } }, invalid: '1e3' },
		{ suffix: 'CONTENT_LENGTH_REQUIRED', value: 'true', expected: { summarizeOptions: { contentLengthRequired: true } }, other: 'false', otherExpected: { summarizeOptions: { contentLengthRequired: false } }, invalid: 'on' },
		{ suffix: 'ALLOWED_PRIVATE_NETWORKS', value: '10.0.0.0/8', expected: { summarizeOptions: { allowedPrivateNetworks: ['10.0.0.0/8'] } }, other: '192.168.0.0/16', otherExpected: { summarizeOptions: { allowedPrivateNetworks: ['192.168.0.0/16'] } }, invalid: 'nope' },
		{ suffix: 'CACHE_TTL', value: '60000', expected: { summarizeOptions: { cacheTtl: 60000 } }, other: '1000', otherExpected: { summarizeOptions: { cacheTtl: 1000 } }, invalid: 'NaN' },
		{ suffix: 'ERROR_CACHE_TTL', value: '5000', expected: { summarizeOptions: { errorCacheTtl: 5000 } }, other: '100', otherExpected: { summarizeOptions: { errorCacheTtl: 100 } }, invalid: '+1' },
	];

	const defaults: ServerConfig = { host: 'localhost', port: 3000, summarizeOptions: {} };

	test.each(cases)('CHIRAMISS_$suffix が読まれる', ({ suffix, value, expected }) => {
		expect(loadServerConfig({ [`CHIRAMISS_${suffix}`]: value })).toEqual({ ...defaults, ...expected });
	});

	test.each(cases)('CHIRAMISS_$suffix と SUMMALY_$suffix が両方あれば CHIRAMISS_$suffix が優先される', ({ suffix, value, expected, other }) => {
		expect(loadServerConfig({ [`CHIRAMISS_${suffix}`]: value, [`SUMMALY_${suffix}`]: other })).toEqual({ ...defaults, ...expected });
	});

	test.each(cases)('CHIRAMISS_$suffix が空文字なら SUMMALY_$suffix にフォールバックする', ({ suffix, other, otherExpected }) => {
		expect(loadServerConfig({ [`CHIRAMISS_${suffix}`]: '', [`SUMMALY_${suffix}`]: other })).toEqual({ ...defaults, ...otherExpected });
	});

	test.each(cases.filter(c => c.invalid !== ''))('$suffix の不正値のエラーメッセージは読んだ変数名を含む', ({ suffix, value, invalid }) => {
		expect(() => loadServerConfig({ [`CHIRAMISS_${suffix}`]: invalid })).toThrow(ServerConfigError);
		expect(() => loadServerConfig({ [`CHIRAMISS_${suffix}`]: invalid })).toThrow(`Invalid value for CHIRAMISS_${suffix}: ${JSON.stringify(invalid)}`);
		expect(() => loadServerConfig({ [`CHIRAMISS_${suffix}`]: invalid, [`SUMMALY_${suffix}`]: value })).toThrow(`Invalid value for CHIRAMISS_${suffix}: `);

		expect(() => loadServerConfig({ [`CHIRAMISS_${suffix}`]: '', [`SUMMALY_${suffix}`]: invalid })).toThrow(`Invalid value for SUMMALY_${suffix}: ${JSON.stringify(invalid)}`);
		expect(() => loadServerConfig({ [`SUMMALY_${suffix}`]: invalid })).toThrow(`Invalid value for SUMMALY_${suffix}: ${JSON.stringify(invalid)}`);
	});

	test.each(cases.filter(c => c.invalid !== ''))('CHIRAMISS_$suffix があれば SUMMALY_$suffix は読まれない (不正値でもエラーにならない)', ({ suffix, value, expected, invalid }) => {
		expect(loadServerConfig({ [`CHIRAMISS_${suffix}`]: value, [`SUMMALY_${suffix}`]: invalid })).toEqual({ ...defaults, ...expected });
	});

	test('すべての CHIRAMISS_* が反映される', () => {
		const env = Object.fromEntries(cases.map(c => [`CHIRAMISS_${c.suffix}`, c.value]));
		const expected = cases.reduce<ServerConfig>((config, c) => ({
			...config,
			...c.expected,
			summarizeOptions: { ...config.summarizeOptions, ...c.expected.summarizeOptions },
		}), defaults);
		expect(loadServerConfig(env)).toEqual(expected);
	});
});
