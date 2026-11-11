import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { detect } from 'chardet';
import { decodeHtml, detectEncoding } from '@/http/decode.js';

vi.mock('chardet', async (importOriginal) => {
	const actual = await importOriginal<typeof import('chardet')>();
	return { ...actual, detect: vi.fn(actual.detect) };
});

const detectSpy = vi.mocked(detect);

const SJIS_HTML = readFileSync(new URL('./fixtures/sjis.html', import.meta.url));
const SJIS_TITLE = 'シフトJISで書かれた日本語のページ';

/** The Shift_JIS fixture with its <meta charset> removed, so only byte-level detection can identify it. */
const SJIS_HTML_WITHOUT_META = Buffer.from(SJIS_HTML.toString('latin1').replace('<meta charset="Shift_JIS">', ''), 'latin1');

function ascii(s: string): Buffer {
	return Buffer.from(s, 'latin1');
}

afterEach(() => {
	detectSpy.mockClear();
});

describe('detectEncoding', () => {
	test('BOM がなければ content-type の charset を使い、chardet を呼ばない', () => {
		expect(detectEncoding(SJIS_HTML, 'text/html; charset=euc-jp')).toBe('euc-jp');
		expect(detectSpy).not.toHaveBeenCalled();
	});

	test('BOM を最優先する（content-type より前。HTML の仕様どおり）', () => {
		expect(detectEncoding(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), ascii('<p>a</p>')]), 'text/html; charset=euc-jp')).toBe('utf-8');
		expect(detectEncoding(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<p>a</p>', 'utf16le')]))).toBe('utf-16le');
		expect(detectEncoding(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('<p>a</p>', 'utf16le').swap16()]))).toBe('utf-16be');
		expect(detectSpy).not.toHaveBeenCalled();
	});

	test('<meta charset> を見つけたら chardet を呼ばない', () => {
		expect(detectEncoding(SJIS_HTML)).toBe('shift_jis');
		expect(detectSpy).not.toHaveBeenCalled();
	});

	test('<meta http-equiv="Content-Type" content="...; charset=..."> も読む', () => {
		const html = ascii('<html><head><meta http-equiv="Content-Type" content="text/html; charset=EUC-JP"></head></html>');
		expect(detectEncoding(html)).toBe('euc-jp');
		expect(detectSpy).not.toHaveBeenCalled();
	});

	test('meta が utf-16 系（別名を含む）を名乗っていたら utf-8 として扱う（HTML の仕様どおり）', () => {
		for (const label of ['utf-16', 'UTF-16BE', 'unicode', 'ucs-2', 'csunicode', 'unicodefffe']) {
			expect(detectEncoding(ascii(`<meta charset="${label}">`))).toBe('utf-8');
		}
	});

	test('meta の x-user-defined は windows-1252 として扱う（HTML の仕様どおり）', () => {
		expect(detectEncoding(ascii('<meta charset="x-user-defined">'))).toBe('windows-1252');
	});

	test('ラベルは正規名に揃える', () => {
		expect(detectEncoding(ascii('<meta charset="x-sjis">'))).toBe('shift_jis');
		expect(detectEncoding(SJIS_HTML, 'text/html; charset=Windows-31J')).toBe('shift_jis');
	});

	test('コメントの中の meta や、ほかの属性値の中の charset= は読まない', () => {
		expect(detectEncoding(ascii('<!-- <meta charset="euc-jp"> --><meta charset="utf-8">'))).toBe('utf-8');
		expect(detectEncoding(ascii('<meta name="description" content="Set charset=euc-jp in header"><meta charset="utf-8">'))).toBe('utf-8');
		expect(detectEncoding(ascii('<meta http-equiv="refresh" content="0; charset=euc-jp"><meta charset="utf-8">'))).toBe('utf-8');
	});

	test('解釈できない charset の meta は無視して次の手段に進む', () => {
		expect(detectEncoding(ascii('<meta charset="no-such-charset"><p>hello</p>'))).toBe('utf-8');
	});

	test('先頭 8KB より後ろにある meta は読まない', () => {
		const html = ascii(`<html><head><script>${'x'.repeat(10 * 1024)}</script><meta charset="euc-jp"></head></html>`);
		expect(detectEncoding(html)).toBe('utf-8');
	});

	test('手がかりがなければ chardet で先頭 16KB だけを判定する', () => {
		const large = Buffer.concat([SJIS_HTML_WITHOUT_META, ascii(`<!-- ${'x'.repeat(200 * 1024)} -->`)]);
		expect(detectEncoding(large)).toBe('shift_jis');
		expect(detectSpy).toHaveBeenCalledTimes(1);
		expect(detectSpy.mock.calls[0]![0].length).toBeLessThanOrEqual(16 * 1024);
	});

	test('先頭 16KB が ASCII だけでも、後ろに UTF-8 があれば utf-8 として読む', () => {
		const html = Buffer.from(`<html><head><style>${'a{b:c}'.repeat(3000)}</style></head><body><p>日本語の本文</p></body></html>`);
		expect(detectEncoding(html)).toBe('utf-8');
		expect(decodeHtml(html)).toContain('日本語の本文');
	});

	test('先頭 16KB が ASCII だけで、後ろが UTF-8 でなければ全体で判定し直す', () => {
		const html = Buffer.concat([ascii(`<html><head><style>${'a{b:c}'.repeat(3000)}</style></head>`), SJIS_HTML_WITHOUT_META]);
		expect(decodeHtml(html)).toContain(SJIS_TITLE);
	});

	test('何もわからなければ utf-8', () => {
		expect(detectEncoding(Buffer.alloc(0))).toBe('utf-8');
	});
});

describe('decodeHtml', () => {
	test('meta charset のない Shift_JIS も chardet で読める', () => {
		expect(decodeHtml(SJIS_HTML_WITHOUT_META)).toContain(SJIS_TITLE);
	});

	test('BOM は結果に含めない', () => {
		expect(decodeHtml(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<p>あ</p>')]))).toBe('<p>あ</p>');
	});
});
