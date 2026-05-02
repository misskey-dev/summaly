import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { replacePlugin } from 'rolldown/plugins';

export default defineConfig({
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	plugins: [
		replacePlugin({
			_VERSION_: JSON.stringify(JSON.parse(readFileSync('./package.json', 'utf-8')).version),
		}),
	],
});
