import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Rolldown, type UserConfig } from 'tsdown';

const common = {
	tsconfig: true,
	define: {
		_VERSION_: JSON.stringify(JSON.parse(readFileSync('./package.json', 'utf-8')).version),
	},
} satisfies UserConfig;

/** The directory of the npm package a bundled module belongs to, or null for summaly's own modules. */
function packageDirOf(id: string): string | null {
	const path = id.replaceAll('\\', '/');
	const marker = '/node_modules/';
	const index = path.lastIndexOf(marker);

	if (index === -1 || id.startsWith('\0')) {
		return null;
	}
	const [first, second] = path.slice(index + marker.length).split('/');

	return path.slice(0, index + marker.length) + (first.startsWith('@') ? `${first}/${second}` : first);
}

/**
 * Writes THIRD-PARTY-LICENSES.txt next to the bundle: the name, version, license and license files of every
 * package bundled into it, since the bundle ships their code without their own files.
 */
function thirdPartyLicenses(): Rolldown.Plugin {
	return {
		name: 'summaly:third-party-licenses',
		generateBundle(_options, bundle) {
			const dirs = new Set<string>();

			for (const output of Object.values(bundle)) {
				if (output.type === 'chunk') {
					for (const id of output.moduleIds) {
						const dir = packageDirOf(id);

						if (dir !== null) {
							dirs.add(dir);
						}
					}
				}
			}

			const sections = [...dirs].map(dir => {
				const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as { name: string; version: string; license?: string };
				const texts = readdirSync(dir)
					.filter(file => /^(?:licen[cs]e|copying|notice)(?:\.|-|$)/i.test(file))
					.sort()
					.map(file => readFileSync(join(dir, file), 'utf-8').trim());

				if (texts.length === 0) {
					this.warn(`${pkg.name}@${pkg.version} has no license file`);
				}

				return { title: `${pkg.name}@${pkg.version} (${pkg.license ?? 'unknown'})`, body: texts.join('\n\n') };
			}).sort((a, b) => a.title.localeCompare(b.title));

			this.emitFile({
				type: 'asset',
				fileName: 'THIRD-PARTY-LICENSES.txt',
				source: [
					'The standalone summaly server bundles the following packages.',
					...sections.map(({ title, body }) => `${'='.repeat(80)}\n${title}\n${'='.repeat(80)}\n\n${body}`),
				].join('\n\n') + '\n',
			});
		},
	};
}

export default defineConfig([
	// Library (published API): `.`, `./cache`, `./fastify` and `./plugin`
	{
		...common,
		entry: {
			index: './src/index.ts',
			cache: './src/cache.ts',
			fastify: './src/fastify.ts',
			plugin: './src/plugin.ts',
		},
		outDir: './built',
		outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
		deps: {
			neverBundle: true,
		},
		dts: true,
	},
	// Standalone server (`node built-server/server.mjs`), not published to npm.
	// Bundles every dependency (fastify included), so the Docker image needs no node_modules.
	{
		...common,
		entry: {
			server: './src/server/index.ts',
		},
		outDir: './built-server',
		outExtensions: () => ({ js: '.mjs' }),
		deps: {
			alwaysBundle: [/./],
			onlyBundle: false,
		},
		plugins: [thirdPartyLicenses()],
		dts: false,
		minify: true,
	},
]);
