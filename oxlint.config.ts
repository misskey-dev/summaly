import { defineMisskeyDevOxlintConfig } from '@misskey-dev/oxlint-fmt-config';

export default defineMisskeyDevOxlintConfig({
	overrides: {
		ignorePatterns: [
			'src/@types/package.json.d.ts',
			'built',
			'built-server',
			'test',
		],
		rules: {
			// fastify is an optional peer dependency: only the `./fastify` entry and the standalone server may use it,
			// so that the declarations of `.`, `./cache` and `./plugin` never reference it.
			'no-restricted-imports': ['error', {
				paths: [{ name: 'fastify', message: 'fastify may only be used in src/fastify.ts and src/server/' }],
				patterns: [{ group: ['@/fastify.js', '@/server/*'], message: 'Only src/server/ may import the Fastify plugin and the server' }],
			}],
			'typescript/triple-slash-reference': ['error', { types: 'never' }],
		},
		overrides: [
			{
				// An override, so that it wins over the shared config's TypeScript override, which turns the rule off.
				files: ['**/*.ts'],
				rules: {
					// Also forbids `import('...')` type annotations, which no-restricted-imports does not see.
					'typescript/consistent-type-imports': ['error', { prefer: 'type-imports', disallowTypeAnnotations: true }],
				},
			},
			{
				files: ['src/fastify.ts', 'src/server/**'],
				rules: {
					'no-restricted-imports': 'off',
				},
			},
		],
	},
});
