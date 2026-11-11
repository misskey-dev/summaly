// Fails if any built declaration file references the fastify module (the published types must not depend on it).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../built', import.meta.url).pathname;
const patterns = [
	/\b(?:from|import)\s*\(?\s*['"]fastify(?:\/[^'"]*)?['"]/,
	/\bexport\s+[^;]*?\bfrom\s*['"]fastify(?:\/[^'"]*)?['"]/,
	/\/\/\/\s*<reference\s+types\s*=\s*['"]fastify(?:\/[^'"]*)?['"]/,
];

function* walk(dir) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);

		if (statSync(p).isDirectory()) {
			yield* walk(p);
		} else if (/\.d\.m?ts$/.test(name)) {
			yield p;
		}
	}
}

let found = false;
let count = 0;

for (const file of walk(root)) {
	count++;
	readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
		if (patterns.some(r => r.test(line))) {
			console.error(`${file}:${i + 1}: references the fastify module: ${line.trim()}`);
			found = true;
		}
	});
}
if (count === 0) {
	console.error(`no .d.ts files found under ${root}; build first`);
	process.exit(1);
}
process.exit(found ? 1 : 0);
