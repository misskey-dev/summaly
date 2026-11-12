import { defineMisskeyDevOxlintConfig } from '@misskey-dev/oxlint-fmt-config';

/**
 * Every index.ts is an entry point that only re-exports (see src/index.ts). Modules import each other directly,
 * so that the public surface is what the entries list and no module depends on an entry.
 */
const noEntryImports = {
	group: ['**/index.js'],
	message: 'Import the module itself: index.ts files are entry points that only re-export',
};

/** Only the standalone server builds on the server's own modules. */
const noServerImports = {
	group: ['@/server/*'],
	message: 'Only src/server/ may import the standalone server',
};

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
				paths: [{ name: 'fastify', message: 'fastify may only be used in src/fastify/ and src/server/' }],
				patterns: [
					noEntryImports,
					noServerImports,
					{ group: ['@/fastify/*'], message: 'Only src/fastify/ and src/server/ may import the Fastify plugin' },
				],
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
				files: ['src/fastify/**'],
				rules: {
					'no-restricted-imports': ['error', { patterns: [noEntryImports, noServerImports] }],
				},
			},
			{
				// The server uses the library as any host would, through its entry points.
				files: ['src/server/**'],
				rules: {
					'no-restricted-imports': 'off',
				},
			},
		],
	},
});
