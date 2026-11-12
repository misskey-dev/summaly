/**
 * @misskey-dev/summaly/plugin: what a summaly plugin needs. Holds no state and loads nothing else at run time,
 * so a plugin package can depend on it without pulling in the rest of summaly.
 */

export { defineSummalyPlugin } from '@/plugin/define.js';
export type {
	SummalyPlugin,
	SummalyPluginContext,
	SummalyPluginDefinition,
	SummalyPluginFetchInit,
	SummalyPluginOptions,
	SummalyPluginPage,
	SummalyPluginPageOptions,
	SummalyPluginResponse,
	SummalyPluginResult,
} from '@/plugin/define.js';
export type { Player, Summary } from '@/types.js';
