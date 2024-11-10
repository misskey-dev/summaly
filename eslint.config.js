import pluginMisskey from '@misskey-dev/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

//@ts-check
/** @type {import('eslint').Linter.Config[]}  */
export default [ // eslint-disable-line import/no-default-export
	...pluginMisskey.configs['recommended'],
	{
		ignores: [
			'**/node_modules',
			'src/@types/package.json.d.ts',
			'built',
			'jest.config.js',
			'test',
		],
	},
	{
		files: ['**/*.ts', '**/*.tsx'],
		languageOptions: {
			parserOptions: {
				parser: tsParser,
				project: ['./tsconfig.json', './test/tsconfig.json'],
				sourceType: 'module',
				tsConfigRootDir: import.meta.dirname,	
			},
		},
		rules: {
			// 空文字でもフォールバックしたいので無効
			'@typescript-eslint/prefer-nullish-coalescing': 'off',
		},
	},
	{
		files: ['**/*.js', '**/*.cjs'],
		rules: {
			'@typescript-eslint/no-var-requires': 'off',
		},
	},
];
