import { afterEach, describe, expect, test } from 'vitest';
import { sanitizeUrls } from '@/extract/urls.js';
import { createSummaly } from '@/index.js';
import { defineSummalyPlugin } from '@/plugin/index.js';
import type { Summary } from '@/types.js';
import { startTestServer, type TestServer } from './helpers/test-server.js';

const servers: TestServer[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map(s => s.close()));
});

const base: Summary = {
	title: 't',
	icon: null,
	description: null,
	thumbnail: null,
	thumbnailStyle: null,
	sitename: null,
	player: { url: null, width: 640, height: 360, allow: ['autoplay'] },
	activityPub: null,
	fediverseCreator: null,
};

describe('sanitizeUrls', () => {
	test.each([
		['https://example.com/a.png', 'https://example.com/a.png'],
		['http://example.com/a.png', 'http://example.com/a.png'],
		['data:image/png;base64,AAAA', 'data:image/png;base64,AAAA'],
		['DATA:image/svg+xml,<svg/>', 'DATA:image/svg+xml,<svg/>'],
		['data:text/html,<script>alert(1)</script>', null],
		['javascript:alert(1)', null],
		['JavaScript:alert(1)', null],
		['vbscript:x', null],
		['file:///etc/passwd', null],
		['//example.com/a.png', null],
		['not a url', null],
	])('icon / thumbnail: %s → %s', (value, expected) => {
		expect(sanitizeUrls({ ...base, icon: value, thumbnail: value })).toMatchObject({ icon: expected, thumbnail: expected });
	});

	test.each([
		['https://player.example/embed', 'https://player.example/embed'],
		['http://player.example/embed', 'http://player.example/embed'],
		['data:image/png;base64,AAAA', null],
		['data:text/html,<script>alert(1)</script>', null],
		['javascript:alert(1)', null],
	])('player.url / activityPub: %s → %s', (value, expected) => {
		const result = sanitizeUrls({ ...base, player: { ...base.player, url: value }, activityPub: value });

		expect(result.player.url).toBe(expected);
		expect(result.activityPub).toBe(expected);
	});

	test('player の他の値と、URL 以外のフィールドはそのまま', () => {
		const result = sanitizeUrls({ ...base, player: { ...base.player, url: 'javascript:x' }, fediverseCreator: '@a@example.com' });

		expect(result.player).toEqual({ url: null, width: 640, height: 360, allow: ['autoplay'] });
		expect(result.fediverseCreator).toBe('@a@example.com');
	});
});

describe('要約の結果', () => {
	test('ページの meta や link にある javascript: の URL を出力しない', async () => {
		const page = `<html><head>
			<title>t</title>
			<meta property="og:image" content="javascript:alert(1)">
			<meta name="twitter:player" content="javascript:alert(2)">
			<link rel="alternate" type="application/activity+json" href="javascript:alert(3)">
		</head></html>`;
		const server = await startTestServer((_req, res) => {
			res.writeHead(200, { 'content-type': 'text/html', 'content-length': Buffer.byteLength(page) });
			res.end(page);
		});

		servers.push(server);
		const summary = await createSummaly({ allowedPrivateNetworks: ['127.0.0.0/8'], followRedirects: false })(server.url);

		expect(summary).toMatchObject({ title: 't', thumbnail: null, activityPub: null, player: { url: null } });
	});

	test('プラグインが返した URL も同じように扱う', async () => {
		const plugin = defineSummalyPlugin({
			name: 'bad-urls',
			test: () => true,
			summarize: async () => ({
				title: 'p',
				icon: 'javascript:alert(1)',
				thumbnail: 'data:image/png;base64,AAAA',
				player: { url: 'data:text/html,x', width: 1, height: 1, allow: [] },
				activityPub: 'https://example.com/ap',
			}),
		});
		const summary = await createSummaly({ plugins: [plugin], followRedirects: false })('https://example.com/');

		expect(summary).toMatchObject({
			title: 'p',
			icon: null,
			thumbnail: 'data:image/png;base64,AAAA',
			player: { url: null },
			activityPub: 'https://example.com/ap',
		});
	});
});
