/**
 * Tests!
 */

'use strict';

/* dependencies below */

import fs, { readdirSync } from 'node:fs';
import process from 'node:process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent as httpAgent } from 'node:http';
import { Agent as httpsAgent } from 'node:https';
import { expect, test, describe, beforeEach, afterEach } from '@jest/globals';
import fastify from 'fastify';
import { summaly } from '../src/index.js';
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

afterEach(async () => {
	if (app) {
		await app.close();
		app = null;
	}
});

/* tests below */

test('basic', async () => {
	app = fastify();
	app.get('/', (request, reply) => {
		const content = fs.readFileSync(_dirname + '/htmls/basic.html');
		reply.header('content-length', content.length);
		reply.header('content-type', 'text/html');
		return reply.send(content);
	});
	await app.listen({ port });
	expect(await summaly(host)).toEqual({
		title: 'KISS principle',
		icon: null,
		description: null,
		thumbnail: null,
		player: {
			url: null,
			width: null,
			height: null,
			'allow': [
				'autoplay',
				'encrypted-media',
				'fullscreen',
			],
		},
		sitename: 'localhost:3060',
		sensitive: false,
		url: host,
		activityPub: null,
	});
});

test('Stage Bye Stage', async () => {
	// If this test fails, you must rewrite the result data and the example in README.md.

	const summary = await summaly('https://www.youtube.com/watch?v=NMIEAhH_fTU');
	expect(summary).toEqual(
		{
			'title': '【アイドルマスター】「Stage Bye Stage」(歌：島村卯月、渋谷凛、本田未央)',
			'icon': 'https://www.youtube.com/s/desktop/4feff1e2/img/favicon.ico',
			'description': 'Website▶https://columbia.jp/idolmaster/Playlist▶https://www.youtube.com/playlist?list=PL83A2998CF3BBC86D2018年7月18日発売予定THE IDOLM@STER CINDERELLA GIRLS CG STAR...',
			'thumbnail': 'https://i.ytimg.com/vi/NMIEAhH_fTU/maxresdefault.jpg',
			'player': {
				'url': 'https://www.youtube.com/embed/NMIEAhH_fTU?feature=oembed',
				'width': 200,
				'height': 113,
				'allow': [
					'autoplay',
					'clipboard-write',
					'encrypted-media',
					'picture-in-picture',
					'web-share',
					'fullscreen',
				],
			},
			'sitename': 'YouTube',
			'sensitive': false,
			'activityPub': null,
			'url': 'https://www.youtube.com/watch?v=NMIEAhH_fTU',
		},
	);
});

test('faviconがHTML上で指定されていないが、ルートに存在する場合、正しく設定される', async () => {
	app = fastify();
	app.get('/', (request, reply) => {
		const content = fs.readFileSync(_dirname + '/htmls/no-favicon.html');
		reply.header('content-length', content.length);
		reply.header('content-type', 'text/html');
		return reply.send(content);
	});
	app.get('/favicon.ico', (_, reply) => reply.status(200).send());
	await app.listen({ port });

	const summary = await summaly(host);
	expect(summary.icon).toBe(`${host}/favicon.ico`);
});

test('faviconがHTML上で指定されていなくて、ルートにも存在しなかった場合 null になる', async () => {
	app = fastify();
	app.get('/', (request, reply) => {
		const content = fs.readFileSync(_dirname + '/htmls/no-favicon.html');
		reply.header('content-length', content.length);
		reply.header('content-type', 'text/html');
		return reply.send(content);
	});
	app.get('*', (_, reply) => reply.status(404).send());
	await app.listen({ port });

	const summary = await summaly(host);
	expect(summary.icon).toBe(null);
});

test('titleがcleanupされる', async () => {
	app = fastify();
	app.get('/', (request, reply) => {
		const content = fs.readFileSync(_dirname + '/htmls/og-title.html');
		reply.header('content-length', content.length);
		reply.header('content-type', 'text/html');
		return reply.send(content);
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
			const content = fs.readFileSync(_dirname + '/htmls/og-title.html');
			reply.header('content-length', content.length);
			reply.header('content-type', 'text/html');
			return reply.send(content);
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
			},
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
			const content = fs.readFileSync(_dirname + '/htmls/og-title.html');
			reply.header('content-length', content.length);
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.title).toBe('Strawberry Pasta');
	});

	test('description', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			const content = fs.readFileSync(_dirname + '/htmls/og-description.html');
			reply.header('content-length', content.length);
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.description).toBe('Strawberry Pasta');
	});

	test('site_name', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			const content = fs.readFileSync(_dirname + '/htmls/og-site_name.html');
			reply.header('content-length', content.length);
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.sitename).toBe('Strawberry Pasta');
	});

	test('thumbnail', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			const content = fs.readFileSync(_dirname + '/htmls/og-image.html');
			reply.header('content-length', content.length);
			reply.header('content-type', 'text/html');
			return reply.send(content);
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
			const content = fs.readFileSync(_dirname + '/htmls/twitter-title.html');
			reply.header('content-length', content.length);
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.title).toBe('Strawberry Pasta');
	});

	test('description', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			const content = fs.readFileSync(_dirname + '/htmls/twitter-description.html');
			reply.header('content-length', content.length);
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.description).toBe('Strawberry Pasta');
	});

	test('thumbnail', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			const content = fs.readFileSync(_dirname + '/htmls/twitter-image.html');
			reply.header('content-length', content.length);
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.thumbnail).toBe('https://himasaku.net/himasaku.png');
	});

	test('Player detection - PeerTube:video => video', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			const content = fs.readFileSync(_dirname + '/htmls/player-peertube-video.html');
			reply.header('content-length', content.length);
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.player.url).toBe('https://example.com/embedurl');
		expect(summary.player.allow).toStrictEqual(['autoplay', 'encrypted-media', 'fullscreen']);
	});

	test('Player detection - Pleroma:video => video', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			const content = fs.readFileSync(_dirname + '/htmls/player-pleroma-video.html');
			reply.header('content-length', content.length);
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.player.url).toBe('https://example.com/embedurl');
		expect(summary.player.allow).toStrictEqual(['autoplay', 'encrypted-media', 'fullscreen']);
	});

	test('Player detection - Pleroma:image => image', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			const content = fs.readFileSync(_dirname + '/htmls/player-pleroma-image.html');
			reply.header('content-length', content.length);
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.thumbnail).toBe('https://example.com/imageurl');
	});
});

describe('oEmbed', () => {
	const setUpFastify = async (oEmbedPath: string, htmlPath = 'htmls/oembed.html') => {
		app = fastify();
		app.get('/', (request, reply) => {
			const content = fs.readFileSync(new URL(htmlPath, import.meta.url));
			reply.header('content-length', content.length);
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		app.get('/oembed.json', (request, reply) => {
			const content = fs.readFileSync(new URL(oEmbedPath, new URL('oembed/', import.meta.url)));
			reply.header('content-length', content.length);
			reply.header('content-type', 'application/json');
			return reply.send(content);
		});
		await app.listen({ port });
	};

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

describe('ActivityPub', () => {
	test('Basic', async () => {
		app = fastify();
		app.get('*', (request, reply) => {
			const content = fs.readFileSync(_dirname + '/htmls/activitypub.html');
			reply.header('content-length', content.length);
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.activityPub).toBe('https://misskey.test/notes/abcdefg');
	});

	test('Null', async () => {
		app = fastify();
		app.get('*', (request, reply) => {
			const content = fs.readFileSync(_dirname + '/htmls/basic.html');
			reply.header('content-length', content.length);
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		await app.listen({ port });

		const summary = await summaly(host);
		expect(summary.activityPub).toBe(null);
	});
});

describe('sensitive', () => {
	test('default', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			const content = fs.readFileSync(_dirname + '/htmls/basic.html');
			reply.header('content-length', content.length);
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		await app.listen({ port });
		expect((await summaly(host)).sensitive).toBe(false);
	});

	test('mixi:content-rating 1', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			const content = fs.readFileSync(_dirname + '/htmls/mixi-sensitive.html');
			reply.header('content-length', content.length);
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		await app.listen({ port });
		expect((await summaly(host)).sensitive).toBe(true);
	});
});

describe('UserAgent', () => {
	test('UA設定が反映されていること', async () => {
		const content = fs.readFileSync(_dirname + '/htmls/basic.html');
		let ua: string | undefined = undefined;

		app = fastify();
		app.get('/', (request, reply) => {
			reply.header('content-length', content.byteLength);
			reply.header('content-type', 'text/html');
			ua = request.headers['user-agent'];
			return reply.send(content);
		});
		await app.listen({ port });
		await summaly(host, { userAgent: 'test-ua' });

		expect(ua).toBe('test-ua');
	});
});

describe('content-length limit', () => {
	test('content-lengthの上限以内であればエラーが起こらないこと', async () => {
		const content = fs.readFileSync(_dirname + '/htmls/basic.html');

		app = fastify();
		app.get('/', (request, reply) => {
			reply.header('content-length', content.byteLength);
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		await app.listen({ port });

		expect(await summaly(host, { contentLengthLimit: content.byteLength })).toBeDefined();
	});

	test('content-lengthの上限を超えているとエラーになる事', async () => {
		const content = fs.readFileSync(_dirname + '/htmls/basic.html');

		app = fastify();
		app.get('/', (request, reply) => {
			reply.header('content-length', content.byteLength);
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		await app.listen({ port });

		await expect(summaly(host, { contentLengthLimit: content.byteLength - 1 })).rejects.toThrow();
	});
});

describe('content-length required', () => {
	test('[オプション有効化時] content-lengthが返された場合はエラーとならないこと', async () => {
		const content = fs.readFileSync(_dirname + '/htmls/basic.html');

		app = fastify();
		app.get('/', (request, reply) => {
			reply.header('content-length', content.byteLength);
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		await app.listen({ port });

		expect(await summaly(host, { contentLengthRequired: true, contentLengthLimit: content.byteLength })).toBeDefined();
	});

	test('[オプション有効化時] content-lengthが返されない場合はエラーとなること', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			reply.header('content-type', 'text/html');
			// streamで渡さないとcontent-lengthを自動で設定されてしまう
			return reply.send(fs.createReadStream(_dirname + '/htmls/basic.html'));
		});
		await app.listen({ port });

		await expect(summaly(host, { contentLengthRequired: true })).rejects.toThrow();
	});

	test('[オプション無効化時] content-lengthが返された場合はエラーとならないこと', async () => {
		const content = fs.readFileSync(_dirname + '/htmls/basic.html');

		app = fastify();
		app.get('/', (request, reply) => {
			reply.header('content-length', content.byteLength);
			reply.header('content-type', 'text/html');
			return reply.send(content);
		});
		await app.listen({ port });

		expect(await summaly(host, { contentLengthRequired: false, contentLengthLimit: content.byteLength })).toBeDefined();
	});

	test('[オプション無効化時] content-lengthが返されなくてもエラーとならないこと', async () => {
		app = fastify();
		app.get('/', (request, reply) => {
			reply.header('content-type', 'text/html');
			// streamで渡さないとcontent-lengthを自動で設定されてしまう
			return reply.send(fs.createReadStream(_dirname + '/htmls/basic.html'));
		});
		await app.listen({ port });

		expect(await summaly(host, { contentLengthRequired: false })).toBeDefined();
	});
});
