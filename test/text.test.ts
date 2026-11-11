import { afterEach, describe, expect, test } from 'vitest';
import { cleanupTitle, clip } from '@/extract/text.js';

describe('clip', () => {
	test('上限以内なら前後の空白を除いてそのまま返す', () => {
		expect(clip('  abc  ', 3)).toBe('abc');
	});

	test('上限を超えたら切り詰めて ... を付ける', () => {
		expect(clip('abcdef', 3)).toBe('abc...');
	});

	test('空文字列や空白だけの文字列は手を付けずに返す', () => {
		expect(clip('', 3)).toBe('');
		expect(clip('     ', 3)).toBe('     ');
	});
});

describe('cleanupTitle', () => {
	test.each([
		['Strawberry Pasta | Alice\'s Site', 'Strawberry Pasta'],
		['Strawberry Pasta - Alice\'s Site', 'Strawberry Pasta'],
		['Strawberry Pasta: Alice\'s Site', 'Strawberry Pasta'],
		['Strawberry Pasta・Alice\'s Site', 'Strawberry Pasta'],
		['Strawberry Pasta|Alice\'s Site', 'Strawberry Pasta'],
	])('末尾のサイト名と区切りを取り除く: %s', (title, expected) => {
		expect(cleanupTitle(title, 'Alice\'s Site')).toBe(expected);
	});

	test('前後の空白を除く', () => {
		expect(cleanupTitle('  Strawberry Pasta | Site  ', ' Site ')).toBe('Strawberry Pasta');
	});

	test('サイト名だけのタイトルはそのまま', () => {
		expect(cleanupTitle('Alice\'s Site', 'Alice\'s Site')).toBe('Alice\'s Site');
	});

	test('サイト名の正規表現の記号は文字どおりに扱う', () => {
		expect(cleanupTitle('Page - a.b (c)*', 'a.b (c)*')).toBe('Page');
		expect(cleanupTitle('Page - aXb', 'a.b')).toBe('Page - aXb');
	});

	describe('RegExp.escape がない環境（Node 22）', () => {
		const original = Object.getOwnPropertyDescriptor(RegExp, 'escape');

		afterEach(() => {
			if (original) {
				Object.defineProperty(RegExp, 'escape', original);
			}
		});

		test('サイト名の正規表現の記号は文字どおりに扱う', () => {
			Object.defineProperty(RegExp, 'escape', { value: undefined, configurable: true, writable: true });

			const siteName = 'a.b (c)*+?^$ [d]{2}|e\\f/g-h';

			expect(cleanupTitle(`Page - ${siteName}`, siteName)).toBe('Page');
			expect(cleanupTitle('Page - aXb', 'a.b')).toBe('Page - aXb');
			expect(cleanupTitle('Page - ab', 'a*b')).toBe('Page - ab');
		});
	});

	test('サイト名がなければ空白を除くだけ', () => {
		expect(cleanupTitle(' Page - Site ', null)).toBe('Page - Site');
		expect(cleanupTitle(' Page - Site ')).toBe('Page - Site');
	});
});
