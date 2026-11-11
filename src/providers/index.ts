// Derived from misskey-dev/summaly (MIT)
import { amazon } from './amazon.js';
import { bluesky } from './bluesky.js';
import { branchioDeeplinks } from './branchio-deeplinks.js';
import type { Provider } from './provider.js';
import { wikipedia } from './wikipedia.js';

/** Built-in providers, in upstream's order. The first whose `test()` matches is used. */
export const builtinProviders: Provider[] = [
	amazon,
	bluesky,
	wikipedia,
	branchioDeeplinks,
];
