import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { DEFAULT_BOT_UA, VERSION } from '@/version.js';

test('VERSION は package.json の version と一致する', () => {
	expect(VERSION).toBe(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version);
});

test('既定 UA は SummalyBot 名義', () => {
	expect(DEFAULT_BOT_UA).toBe(`SummalyBot/${VERSION} (+https://github.com/misskey-dev/summaly/blob/master/README.md)`);
});

test('index から version が export されている', async () => {
	expect((await import('@/index.js')).version).toBe(VERSION);
});
