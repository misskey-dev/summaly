import { describe, expect, expectTypeOf, test } from 'vitest';
import * as lib from '@/index.js';
import {
	createSummarizer,
	createSummaly,
	defaultSummarizeOptions,
	summalyDefaultOptions,
	summarize,
	summaly,
	type SummalyOptions,
	type SummalyPlugin,
	type SummalyResult,
	type SummarizeOptions,
	type SummaryPlugin,
	type SummaryResult,
} from '@/index.js';

describe('summaly 互換の別名', () => {
	test('別名は正式名と同じ実体を指す', () => {
		expect(summaly).toBe(summarize);
		expect(createSummaly).toBe(createSummarizer);
		expect(summalyDefaultOptions).toBe(defaultSummarizeOptions);
	});

	test('正式名も別名も index から export される', () => {
		for (const name of ['summarize', 'summaly', 'createSummarizer', 'createSummaly', 'defaultSummarizeOptions', 'summalyDefaultOptions']) {
			expect(lib).toHaveProperty(name);
		}
	});

	test('型の別名は正式名の型と同じ', () => {
		expectTypeOf<SummalyResult>().toEqualTypeOf<SummaryResult>();
		expectTypeOf<SummalyOptions>().toEqualTypeOf<SummarizeOptions>();
		expectTypeOf<SummalyPlugin>().toEqualTypeOf<SummaryPlugin>();
	});
});
