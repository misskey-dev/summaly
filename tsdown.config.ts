import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsdown';
import { replacePlugin } from 'rolldown/plugins';

export default defineConfig({
	entry: './src/index.ts',
	outExtensions: (_) => ({ js: '.js', dts: '.d.ts' }),
	tsconfig: true,
	dts: true,
	deps: {
		skipNodeModulesBundle: true,
	},
	outDir: './built',
	plugins: [
		replacePlugin({
			_VERSION_: JSON.stringify(JSON.parse(readFileSync('./package.json', 'utf-8')).version),
		}),
	],
});
