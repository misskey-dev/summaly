import { spawn } from 'node:child_process';

const HOOKS = new URL('./source-hooks.mjs', import.meta.url).href;
const SOURCE_INDEX = new URL('../../src/index.ts', import.meta.url).href;

export type SourceScriptResult = {
	code: number | null;
	stdout: string;
	stderr: string;
	/** ms from the end of the script's top-level code to the process exit */
	exitDelay: number;
};

/**
 * Runs `body` as an ES module in a child Node.js process that loads the TypeScript sources directly (the
 * `SOURCE_INDEX` constant is the URL of src/index.ts). `args` are in `process.argv` from index 1.
 * The process is not told to exit: whatever the script leaves behind decides when it does.
 */
export function runSourceScript(body: string, args: string[] = []): Promise<SourceScriptResult> {
	const script = `
		import { register } from 'node:module';
		globalThis._VERSION_ = '0.0.0-test';
		register(${JSON.stringify(HOOKS)});
		const SOURCE_INDEX = ${JSON.stringify(SOURCE_INDEX)};
		${body}
		process.stderr.write('\\n__script_done__\\n');
	`;
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['--input-type=module', '--no-warnings', '-e', script, ...args], {
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		let doneAt: number | undefined;
		child.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
			if (doneAt === undefined && stderr.includes('__script_done__')) doneAt = Date.now();
		});
		child.on('error', reject);
		child.on('close', code => {
			const exitDelay = doneAt === undefined ? Number.NaN : Date.now() - doneAt;
			resolve({ code, stdout, stderr: stderr.replace('\n__script_done__\n', ''), exitDelay });
		});
	});
}
