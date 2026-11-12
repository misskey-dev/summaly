// Module hooks for running the TypeScript sources in a child Node.js process (see run-source.ts), with Node's
// built-in type stripping: resolves the `@/` alias to src/ and a relative `.js` import to the `.ts` file next to it.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = new URL('../../src/', import.meta.url);

export async function resolve(specifier, context, next) {
	let target = specifier;

	if (target.startsWith('@/')) {
		target = new URL(target.slice(2), SRC).href;
	}
	if (target.endsWith('.js') && (target.startsWith('.') || target.startsWith('file:')) && context.parentURL) {
		const ts = new URL(target.replace(/\.js$/, '.ts'), context.parentURL);

		if (existsSync(fileURLToPath(ts))) {
			return next(ts.href, context);
		}
	}

	return next(target, context);
}
