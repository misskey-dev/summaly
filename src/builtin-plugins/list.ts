import type { SummalyPlugin } from '@/plugin/define.js';
import { amazon } from './amazon.js';
import { bluesky } from './bluesky.js';
import { branchioDeeplinks } from './branchio-deeplinks.js';
import { wikipedia } from './wikipedia.js';

/**
 * Built-in plugins, tried after the caller's plugins. The first whose `test()` matches is used.
 */
export const builtinPlugins: readonly SummalyPlugin[] = Object.freeze([
	amazon,
	bluesky,
	wikipedia,
	branchioDeeplinks,
]);

export const builtinPluginNames: readonly string[] = Object.freeze(builtinPlugins.map(plugin => plugin.name));
