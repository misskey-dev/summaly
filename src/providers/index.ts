// Derived from misskey-dev/summaly (MIT)
import { amazon } from './amazon.js';
import { bluesky } from './bluesky.js';
import { branchioDeeplinks } from './branchio-deeplinks.js';
import { nvd } from './nvd.js';
import type { Provider } from './provider.js';
import { wikipedia } from './wikipedia.js';

/**
 * Built-in providers: upstream's four in upstream's order, then chiramiss's own. The first whose `test()` matches is used.
 */
export const builtinProviders: Provider[] = [
	amazon,
	bluesky,
	wikipedia,
	branchioDeeplinks,
	nvd,
];
