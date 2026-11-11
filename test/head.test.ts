import { describe, expect, test } from 'vitest';
import { parseHead } from '@/html/head.js';
import { loadDom } from '@/html/dom.js';

describe('parseHead', () => {
	test('og:title / name=description / link rel=icon を読む', () => {
		const h = parseHead('<html><head><title>T</title><meta property="og:title" content="OG"><meta name="description" content="D"><link rel="icon" type="image/png" href="/i.png"><link rel="stylesheet" href="/a.css"></head><body></body></html>');
		expect(h.title).toBe('T');
		expect(h.meta('property:og:title')).toBe('OG');
		expect(h.meta('name:description')).toBe('D');
		expect(h.meta('name:nothing')).toBeUndefined();
		expect(h.links).toEqual([
			{ rel: 'icon', type: 'image/png', href: '/i.png' },
			{ rel: 'stylesheet', type: null, href: '/a.css' },
		]);
	});

	test('rel のない link も読む（oEmbed の link は type だけのことがある）', () => {
		const h = parseHead('<head><link type="application/json+oembed" href="/oembed.json"><link rel="icon"></head>');
		expect(h.links).toEqual([
			{ rel: null, type: 'application/json+oembed', href: '/oembed.json' },
		]);
	});

	test('同じ meta が複数あれば最初のもの', () => {
		const h = parseHead('<head><meta property="og:title" content="first"><meta property="og:title" content="second"></head>');
		expect(h.meta('property:og:title')).toBe('first');
	});

	test('属性名は大文字小文字を区別せず、値は区別する', () => {
		const h = parseHead('<head><META PROPERTY="og:Title" CONTENT="Abc"></head>');
		expect(h.meta('property:og:Title')).toBe('Abc');
		expect(h.meta('property:og:title')).toBeUndefined();
	});

	test('</head> 以降の meta は読まない', () => {
		const h = parseHead('<head><meta property="og:title" content="in"></head><body><meta property="og:description" content="out"><meta property="og:title" content="body"></body>');
		expect(h.meta('property:og:title')).toBe('in');
		expect(h.meta('property:og:description')).toBeUndefined();
	});

	test('<body> の開始で止まる (</head> がなくても)', () => {
		const h = parseHead('<head><meta name="a" content="1"><body><meta name="b" content="2">');
		expect(h.meta('name:a')).toBe('1');
		expect(h.meta('name:b')).toBeUndefined();
	});

	test('<head> タグのない HTML でも title と meta を読む', () => {
		const h = parseHead('<title>T</title><meta name="description" content="D"><p>x</p>');
		expect(h.title).toBe('T');
		expect(h.meta('name:description')).toBe('D');
	});

	test('<title> が body 側にしかなくても読む', () => {
		const h = parseHead('<head><meta name="a" content="1"></head><body><p>x</p><title>Late</title></body>');
		expect(h.title).toBe('Late');
		expect(h.meta('name:a')).toBe('1');
	});

	test('閉じられていない <title> も読む', () => {
		expect(parseHead('<head><title>Open').title).toBe('Open');
	});

	test('title がどこにもなければ null', () => {
		expect(parseHead('<head></head><body>x</body>').title).toBeNull();
	});

	test('<head> 内の巨大な <script>（1MB）を挟んでも後続の meta を読む', () => {
		const big = 'a'.repeat(1024 * 1024);
		const h = parseHead(`<head><script>var x = "${big}";</script><meta property="og:title" content="after"></head>`);
		expect(h.meta('property:og:title')).toBe('after');
	});

	test('エンティティはデコードしない', () => {
		const h = parseHead('<head><title>A &amp; B</title><meta property="og:title" content="&lt;x&gt; &quot;q&quot;"></head>');
		expect(h.title).toBe('A &amp; B');
		expect(h.meta('property:og:title')).toBe('&lt;x&gt; &quot;q&quot;');
	});
});

describe('loadDom', () => {
	test('cheerio の API を返す', () => {
		expect(loadDom('<p id="a">x</p>')('#a').text()).toBe('x');
	});
});
