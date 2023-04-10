/**
 * Tests!
 */

'use strict';

/* dependencies below */

import fs, { readdirSync } from 'node:fs';
import process from 'node:process';
import fastify from 'fastify';
import { summaly } from '../src/index.js';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, jest, test, describe, beforeEach, afterEach } from '@jest/globals';
import { Agent as httpAgent } from 'node:http';
import { Agent as httpsAgent } from 'node:https';
import { StatusError } from '../src/utils/status-error.js';

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);

/* settings below */

Error.stackTraceLimit = Infinity;

// During the test the env variable is set to test
process.env.NODE_ENV = 'test';
process.env.SUMMALY_ALLOW_PRIVATE_IP = 'true';

const port = 3060;
const host = `http://localhost:${port}`;

// Display detail of unhandled promise rejection
process.on('unhandledRejection', console.dir);

let app: ReturnType<typeof fastify> | null = null;
let n = 0;

afterEach(async () => {
	if (app) {
		await app.close();
		app = null;
	}
});

/* tests below */

test('faviconがHTML上で指定されていないが、ルートに存在する場合、正しく設定される', async () => {
	app = fastify();
	app.get('/', (request, reply) => {
		return reply.send(fs.createReadStream(_dirname + '/htmls/no-favicon.html'));
	});
	app.get('/favicon.ico', (_, reply) => reply.status(200).send());
	await app.listen({ port });

	const summary = await summaly(host);
	expect(summary.icon).toBe(`${host}/favicon.ico`);
});

test('faviconがHTML上で指定されていなくて、ルートにも存在しなかった場合 null になる', async () => {
	app = fastify();
	app.get('/', (request, reply) => {
		return reply.send(fs.createReadStream(_dirname + '/htmls/no-favicon.html'));
	});
	app.get('*', (_, reply) => reply.status(404).send());
	await app.listen({ port });

	const summary = await summaly(host);
	expect(summary.icon).toBe(null);
});

test('titleがcleanupされる', async () => {
	app = fastify();
	app.get('/', (request, reply) => {
		return reply.send(fs.createReadStream(_dirname + '/htmls/dirty-title.html'));
	});
	await app.listen({ port });

	const summary = await summaly(host);
	expect(summary.title).toBe('Strawberry Pasta');
});

describe('Private IP blocking', () => {
	beforeEach(() => {
		process.env.SUMMALY_ALLOW_PRIVATE_IP = 'false';
		app = fastify();
		app.get('*', (request, reply) => {
			return reply.send(fs.createReadStream(_dirname + '/htmls/og-title.html'));
		});
		return app.listen({ port });
	});

	test('private ipなサーバーの情報を取得できない', async () => {
		const summary = await summaly(host).catch((e: StatusError) => e);
		if (summary instanceof StatusError) {
			expect(summary.name).toBe('StatusError');
		} else {
			expect(summary).toBeInstanceOf(StatusError);
		}
	});

	test('agentが指定されている場合はprivate ipを許可', async () => {
		const summary = await summaly(host, {
			agent: {
				http: new httpAgent({ keepAlive: true }),
				https: new httpsAgent({ keepAlive: true }),
			}
		});
		expect(summary.title).toBe('Strawberry Pasta');
	});

	test('agentが空のオブジェクトの場合はprivate ipを許可しない', async () => {
		const summary = await summaly(host, { agent: {} }).catch((e: StatusError) => e);
		if (summary instanceof StatusError) {
			expect(summary.name).toBe('StatusError');
		} else {
			expect(summary).toBeInstanceOf(StatusError);
		}
	});

	afterEach(() => {
		process.env.SUMMALY_ALLOW_PRIVATE_IP = 'true';
	});
});

describe('OGP', () => {
	test('title', async () => {
		app = fastify();
		app.get('*', (request, reply) => {
			return reply.send(fs.createReadStream(_dirname + '/htmls/og-title.html'));
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.title).toBe('Strawberry Pasta');
	});

	test('description', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			return reply.send(fs.createReadStream(_dirname + '/htmls/og-description.html'));
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.description).toBe('Strawberry Pasta');
	});

	test('site_name', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			return reply.send(fs.createReadStream(_dirname + '/htmls/og-site_name.html'));
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.sitename).toBe('Strawberry Pasta');
	});

	test('thumbnail', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			return reply.send(fs.createReadStream(_dirname + '/htmls/og-image.html'));
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.thumbnail).toBe('https://himasaku.net/himasaku.png');
	});
});

describe('TwitterCard', () => {
	test('title', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			return reply.send(fs.createReadStream(_dirname + '/htmls/twitter-title.html'));
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.title).toBe('Strawberry Pasta');
	});

	test('description', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			return reply.send(fs.createReadStream(_dirname + '/htmls/twitter-description.html'));
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.description).toBe('Strawberry Pasta');
	});

	test('thumbnail', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			return reply.send(fs.createReadStream(_dirname + '/htmls/twitter-image.html'));
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.thumbnail).toBe('https://himasaku.net/himasaku.png');
	});

	test('Player detection - PeerTube:video => video', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			return reply.send(fs.createReadStream(_dirname + '/htmls/player-peertube-video.html'));
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.player.url).toBe('https://example.com/embedurl');
		expect(summary.player.allow).toStrictEqual(['autoplay', 'encrypted-media', 'fullscreen']);
	});

	test('Player detection - Pleroma:video => video', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			return reply.send(fs.createReadStream(_dirname + '/htmls/player-pleroma-video.html'));
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.player.url).toBe('https://example.com/embedurl');
		expect(summary.player.allow).toStrictEqual(['autoplay', 'encrypted-media', 'fullscreen']);
	});

	test('Player detection - Pleroma:image => image', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			return reply.send(fs.createReadStream(_dirname + '/htmls/player-pleroma-image.html'));
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.thumbnail).toBe('https://example.com/imageurl');
	});
});

describe("oEmbed", () => {
	const setUpFastify = async (oEmbedPath: string, htmlPath = 'htmls/oembed.html') => {
		app = fastify();
		app.get('/', (request, reply) => {
			return reply.send(fs.createReadStream(new URL(htmlPath, import.meta.url)));
		});
		app.get('/oembed.json', (request, reply) => {
			return reply.send(fs.createReadStream(
				new URL(oEmbedPath, new URL('oembed/', import.meta.url))
			));
		});
		await app.listen({ port });
	}

	for (const filename of readdirSync(new URL('oembed/invalid', import.meta.url))) {
		test(`Invalidity test: ${filename}`, async () => {
			await setUpFastify(`invalid/${filename}`);
			const summary = await summaly(host);
			expect(summary.player.url).toBe(null);
		});
	}

	test('basic properties', async () => {
		await setUpFastify('oembed.json');
		const summary = await summaly(host);
		expect(summary.player.url).toBe('https://example.com/');
		expect(summary.player.width).toBe(500);
		expect(summary.player.height).toBe(300);
	});

	test('type: video', async () => {
		await setUpFastify('oembed-video.json');
		const summary = await summaly(host);
		expect(summary.player.url).toBe('https://example.com/');
		expect(summary.player.width).toBe(500);
		expect(summary.player.height).toBe(300);
	});

	test('max height', async () => {
		await setUpFastify('oembed-too-tall.json');
		const summary = await summaly(host);
		expect(summary.player.height).toBe(1024);
	});

	test('children are ignored', async () => {
		await setUpFastify('oembed-iframe-child.json');
		const summary = await summaly(host);
		expect(summary.player.url).toBe('https://example.com/');
	});

	test('allows fullscreen', async () => {
		await setUpFastify('oembed-allow-fullscreen.json');
		const summary = await summaly(host);
		expect(summary.player.url).toBe('https://example.com/');
		expect(summary.player.allow).toStrictEqual(['fullscreen']);
	});

	test('allows legacy allowfullscreen', async () => {
		await setUpFastify('oembed-allow-fullscreen-legacy.json');
		const summary = await summaly(host);
		expect(summary.player.url).toBe('https://example.com/');
		expect(summary.player.allow).toStrictEqual(['fullscreen']);
	});

	test('allows safelisted permissions', async () => {
		await setUpFastify('oembed-allow-safelisted-permissions.json');
		const summary = await summaly(host);
		expect(summary.player.url).toBe('https://example.com/');
		expect(summary.player.allow).toStrictEqual([
			'autoplay', 'clipboard-write', 'fullscreen',
			'encrypted-media', 'picture-in-picture', 'web-share',
		]);
	});

	test('ignores rare permissions', async () => {
		await setUpFastify('oembed-ignore-rare-permissions.json');
		const summary = await summaly(host);
		expect(summary.player.url).toBe('https://example.com/');
		expect(summary.player.allow).toStrictEqual(['autoplay']);
	});

	test('oEmbed with relative path', async () => {
		await setUpFastify('oembed.json', 'htmls/oembed-relative.html');
		const summary = await summaly(host);
		expect(summary.player.url).toBe('https://example.com/');
	});

	test('oEmbed with nonexistent path', async () => {
		await setUpFastify('oembed.json', 'htmls/oembed-nonexistent-path.html');
		const summary = await summaly(host);
		expect(summary.player.url).toBe(null);
		expect(summary.description).toBe('nonexistent');
	});

	test('oEmbed with wrong path', async () => {
		await setUpFastify('oembed.json', 'htmls/oembed-wrong-path.html');
		const summary = await summaly(host);
		expect(summary.player.url).toBe(null);
		expect(summary.description).toBe('wrong url');
	});

	test('oEmbed with OpenGraph', async () => {
		await setUpFastify('oembed.json', 'htmls/oembed-and-og.html');
		const summary = await summaly(host);
		expect(summary.player.url).toBe('https://example.com/');
		expect(summary.description).toBe('blobcats rule the world');
	});

	test('Invalid oEmbed with valid OpenGraph', async () => {
		await setUpFastify('invalid/oembed-insecure.json', 'htmls/oembed-and-og.html');
		const summary = await summaly(host);
		expect(summary.player.url).toBe(null);
		expect(summary.description).toBe('blobcats rule the world');
	});

	test('oEmbed with og:video', async () => {
		await setUpFastify('oembed.json', 'htmls/oembed-and-og-video.html');
		const summary = await summaly(host);
		expect(summary.player.url).toBe('https://example.com/');
		expect(summary.player.allow).toStrictEqual([]);
	});

	test('width: 100%', async () => {
		await setUpFastify('oembed-percentage-width.json');
		const summary = await summaly(host);
		expect(summary.player.width).toBe(null);
		expect(summary.player.height).toBe(300);
	});
});
