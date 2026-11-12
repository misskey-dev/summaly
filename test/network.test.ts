/**
 * Tests against real sites. Skipped when SKIP_NETWORK_TEST=true (as in CI), since their pages change over time.
 */

import { describe, expect, test } from 'vitest';
import { summaly } from '@/index.js';

const skip = process.env.SKIP_NETWORK_TEST === 'true';

describe.skipIf(skip)('network tests', () => {
	test('Stage Bye Stage', async () => {
		// If this test fails, you must rewrite the result data and the example in README.md.
		const summary = await summaly('https://www.youtube.com/watch?v=NMIEAhH_fTU');

		expect(summary).toEqual({
			title: '【アイドルマスター】「Stage Bye Stage」(歌：島村卯月、渋谷凛、本田未央)',
			icon: 'https://www.youtube.com/s/desktop/cb518cf3/img/favicon.ico',
			description: 'Website▶https://columbia.jp/idolmaster/Playlist▶https://www.youtube.com/playlist?list=PL83A2998CF3BBC86D2018年7月18日発売THE IDOLM@STER CINDERELLA GIRLS CG STAR L...',
			thumbnail: 'https://i.ytimg.com/vi/NMIEAhH_fTU/maxresdefault.jpg',
			thumbnailStyle: 'summary_large_image',
			player: {
				url: 'https://www.youtube.com/embed/NMIEAhH_fTU?feature=oembed',
				width: 200,
				height: 113,
				allow: [
					'autoplay',
					'clipboard-write',
					'encrypted-media',
					'picture-in-picture',
					'web-share',
					'fullscreen',
				],
			},
			sitename: 'YouTube',
			sensitive: false,
			activityPub: null,
			fediverseCreator: null,
			url: 'https://www.youtube.com/watch?v=NMIEAhH_fTU',
		});
	}, 30_000);
});
