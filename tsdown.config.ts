import { readFileSync } from 'node:fs';
import { defineConfig, type UserConfig } from 'tsdown';

const common = {
	outExtensions: (_) => ({ js: '.js', dts: '.d.ts' }),
	tsconfig: true,
	deps: {
		neverBundle: true,
	},
	outDir: './built',
	define: {
		_VERSION_: JSON.stringify(JSON.parse(readFileSync('./package.json', 'utf-8')).version),
	},
} satisfies UserConfig;

export default defineConfig([
	// Library (published API): `.` and `./plugin`
	{
		...common,
		entry: {
			index: './src/index.ts',
			plugin: './src/plugin.ts',
		},
		dts: true,
	},
	// Standalone server (`node built/server.js`)
	{
		...common,
		entry: {
			server: './src/server/index.ts',
		},
		dts: false,
	},
]);
