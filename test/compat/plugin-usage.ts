// How a plugin package and its user use @misskey-dev/summaly/plugin.
// Checked against built/plugin.d.ts and built/index.d.ts by `pnpm typecheck:compat`.
import { defineSummalyPlugin } from '../../built/plugin.js';
import type { SummalyPlugin, SummalyPluginContext, Summary } from '../../built/plugin.js';
import type { SummalyResult } from '../../built/index.js';

type ApiResponse = { title: string; text: string };

// A plugin package: `export default defineSummalyPlugin({ ... })`
const examplePlugin: SummalyPlugin = defineSummalyPlugin({
	name: 'example',
	test: url => url.hostname === 'example.com',
	async summarize({ url, fetch, options }) {
		if (url.pathname === '/') {
			// Leave the top page to the generic rules.
			return null;
		}
		const api = (await fetch(`/api${url.pathname}`, { headers: { accept: 'application/json' } })).json() as ApiResponse;

		return { title: api.title, description: api.text, sitename: options.lang === 'ja' ? '例' : 'Example' };
	},
});

// A plugin built on the generic rules
export const genericPlugin = defineSummalyPlugin({
	name: 'generic',
	test: url => url.hostname.endsWith('.example.net'),
	async summarize(ctx: SummalyPluginContext): Promise<Summary> {
		const page = await ctx.fetchPage(ctx.url, { followRedirects: true });
		const summary = await ctx.summarizePage(page);

		return { ...summary, sitename: 'Example Net' };
	},
});

// The plugin's user
export async function summarizeWithPlugins(url: string): Promise<SummalyResult> {
	const { summaly } = await import('../../built/index.js');

	return summaly(url, { plugins: [examplePlugin, genericPlugin] });
}
