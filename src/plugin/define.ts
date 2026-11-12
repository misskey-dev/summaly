import type { Summary } from '@/types.js';

/**
 * Marks the objects made by defineSummalyPlugin. A registered symbol (Symbol.for), so that a plugin made with
 * another copy of summaly (e.g. one a plugin package resolved on its own) is recognized too.
 */
export const SUMMALY_PLUGIN: unique symbol = Symbol.for('summaly.plugin');

/** Version of the plugin interface. Raised when SummalyPluginContext or the plugin shape changes incompatibly. */
export const PLUGIN_API_VERSION = 1 as const;

/** Names starting with this are reserved for the built-in plugins. */
export const BUILTIN_PLUGIN_PREFIX = 'summaly:';

/** The settings of the current summary, with every default filled in. */
export type SummalyPluginOptions = {
	/** Accept-Language, or null when the caller gave none (or a malformed one) */
	readonly lang: string | null;
	readonly userAgent: string;
	readonly followRedirects: boolean;
	readonly responseTimeout: number;
	readonly operationTimeout: number;
	readonly contentLengthLimit: number;
	readonly contentLengthRequired: boolean;
};

export type SummalyPluginFetchInit = {
	/** Defaults to GET */
	method?: 'GET' | 'HEAD';
	/** Extra request headers. `user-agent` is always the summary's User-Agent and cannot be changed. */
	headers?: Record<string, string>;
};

export type SummalyPluginResponse = {
	/** Final URL after redirects */
	url: string;
	status: number;
	headers: Readonly<Record<string, string | string[] | undefined>>;
	/** Decompressed body */
	body: Uint8Array;
	/** The body decoded as UTF-8 */
	text(): string;
	/** The body parsed as JSON */
	json(): unknown;
};

/** Settings fetchPage may change for its request; everything else comes from the summary. */
export type SummalyPluginPageOptions = {
	followRedirects?: boolean;
	contentLengthRequired?: boolean;
};

export type SummalyPluginPage = {
	/** The URL given to fetchPage. summarizePage resolves relative links and the site name against it. */
	url: URL;
	/** Final URL after redirects */
	finalUrl: URL;
	/** Decoded HTML */
	html: string;
	headers: Readonly<Record<string, string | string[] | undefined>>;
};

/**
 * What a plugin gets for one summary. Every request made through it uses the summary's connection settings:
 * the private IP block, `allowedPrivateNetworks`, `proxy`, `agent`, the User-Agent, the timeouts and the size limit.
 * The functions do not depend on `this`, so the context can be destructured.
 */
export type SummalyPluginContext = {
	/** The URL to summarize (after redirects when `followRedirects` is on) */
	url: URL;
	options: SummalyPluginOptions;
	/**
	 * Sends a request. A relative URL is resolved against `url`. Redirects are followed and any content type is
	 * accepted. Rejects when the response status is not a success.
	 */
	fetch: (url: string | URL, init?: SummalyPluginFetchInit) => Promise<SummalyPluginResponse>;
	/**
	 * GETs an HTML page (a relative URL is resolved against `url`). Rejects a response that is not HTML.
	 */
	fetchPage: (url: string | URL, options?: SummalyPluginPageOptions) => Promise<SummalyPluginPage>;
	/** Builds a summary from a page with the generic rules (meta tags, oEmbed, favicon). */
	summarizePage: (page: SummalyPluginPage) => Promise<Summary>;
	/** Fetches and summarizes a page with the generic rules. Defaults to `url`. */
	general: (url?: string | URL) => Promise<Summary>;
};

/**
 * What `summarize` returns. Missing fields are filled in (null, an empty player, `sensitive: false`).
 * null hands the URL over to the generic rules. To fail the summary, throw.
 */
export type SummalyPluginResult = Partial<Summary> | null;

export type SummalyPluginDefinition = {
	/**
	 * Identifies the plugin. Part of the cache key, so two plugins with the same name must behave the same.
	 * Must be unique among the plugins of a summary; names starting with `summaly:` are reserved.
	 */
	name: string;
	/** Whether this plugin summarizes `url` (after redirects when `followRedirects` is on). */
	test(url: URL): boolean;
	summarize(ctx: SummalyPluginContext): Promise<SummalyPluginResult>;
};

export type SummalyPlugin = Readonly<SummalyPluginDefinition> & {
	readonly [SUMMALY_PLUGIN]: typeof PLUGIN_API_VERSION;
};

function createPlugin(definition: SummalyPluginDefinition, builtin: boolean): SummalyPlugin {
	// oxlint-disable-next-line typescript/no-unnecessary-condition -- checked for callers without types
	if (definition == null || typeof definition !== 'object') {
		throw new TypeError('defineSummalyPlugin() takes an object');
	}
	const { name } = definition;

	// oxlint-disable-next-line typescript/no-unnecessary-condition -- checked for callers without types
	if (typeof name !== 'string' || name === '') {
		throw new TypeError('A summaly plugin needs a non-empty name');
	}
	if (!builtin && name.startsWith(BUILTIN_PLUGIN_PREFIX)) {
		throw new TypeError(`Plugin names starting with "${BUILTIN_PLUGIN_PREFIX}" are reserved: ${name}`);
	}
	// oxlint-disable-next-line typescript/no-unnecessary-condition -- checked for callers without types
	if (typeof definition.test !== 'function' || typeof definition.summarize !== 'function') {
		throw new TypeError(`Plugin ${name} needs test() and summarize()`);
	}

	return Object.freeze({
		name,
		// Called through the definition, so that methods using `this` keep working.
		test: (url: URL) => definition.test(url),
		summarize: (ctx: SummalyPluginContext) => definition.summarize(ctx),
		[SUMMALY_PLUGIN]: PLUGIN_API_VERSION,
	});
}

/**
 * Defines a summaly plugin.
 *
 * ```ts
 * import { defineSummalyPlugin } from '@misskey-dev/summaly/plugin';
 *
 * export default defineSummalyPlugin({
 * 	name: 'example',
 * 	test: url => url.hostname === 'example.com',
 * 	async summarize({ url, fetchPage, summarizePage }) {
 * 		return summarizePage(await fetchPage(url));
 * 	},
 * });
 * ```
 */
export function defineSummalyPlugin(definition: SummalyPluginDefinition): SummalyPlugin {
	return createPlugin(definition, false);
}

/** defineSummalyPlugin for the built-in plugins, whose names use the reserved prefix. */
export function defineBuiltinPlugin(definition: SummalyPluginDefinition): SummalyPlugin {
	return createPlugin(definition, true);
}

/** Whether `value` is a plugin made by defineSummalyPlugin with this version of the plugin interface. */
export function isSummalyPlugin(value: unknown): value is SummalyPlugin {
	return typeof value === 'object' && value !== null && (value as Partial<SummalyPlugin>)[SUMMALY_PLUGIN] === PLUGIN_API_VERSION;
}

/**
 * Checks the plugins given to a summary: each made by defineSummalyPlugin, with a name unique among them and the
 * built-in plugins (`builtinNames`).
 * @throws {TypeError}
 */
export function assertPlugins(plugins: readonly unknown[] | undefined, builtinNames: readonly string[]): void {
	if (plugins === undefined) {
		return;
	}
	const names = new Set(builtinNames);

	for (const plugin of plugins) {
		if (!isSummalyPlugin(plugin)) {
			const version = typeof plugin === 'object' && plugin !== null ? (plugin as Record<symbol, unknown>)[SUMMALY_PLUGIN] : undefined;

			throw new TypeError(version === undefined
				? 'Plugins must be made with defineSummalyPlugin() from @misskey-dev/summaly/plugin'
				: `Plugin made for another version of the plugin interface (${typeof version === 'number' ? version : 'unknown'}; this summaly supports ${PLUGIN_API_VERSION})`);
		}
		if (names.has(plugin.name)) {
			throw new TypeError(`Duplicate plugin name: ${plugin.name}`);
		}
		names.add(plugin.name);
	}
}
