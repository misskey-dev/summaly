/**
 * @misskey-dev/summaly: summarizes web pages.
 *
 * Entry points (each an index.ts that only re-exports):
 * - `.` (this file): summaly, createSummaly and the types of their options and results
 * - `./cache` (src/cache/index.ts): cache and in-flight sharing
 * - `./fastify` (src/fastify/index.ts): the Fastify plugin
 * - `./plugin` (src/plugin/index.ts): defineSummalyPlugin and the plugin types
 */

export { createSummaly, summaly } from '@/summaly.js';
export type { SummalyInstance } from '@/summaly.js';
export { StatusError } from '@/http/status-error.js';
export { VERSION as version } from '@/version.js';
export type { Player, SummalyOptions, SummalyResult } from '@/types.js';
