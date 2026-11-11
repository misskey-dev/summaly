import { fetchSubresource } from '@/context.js';
import { clip } from '@/extract/text.js';
import type { Provider } from './provider.js';

/** Path of a CVE detail page. The site redirects `/vuln/detail/CVE-...` to the lowercase form. */
const PATH = /^\/vuln\/detail\/(CVE-\d{4}-\d{4,})\/?$/i;

const API = 'https://services.nvd.nist.gov/rest/json/cves/2.0';

/** One entry of a `cvssMetricV*` array. V2 keeps `baseSeverity` on the entry itself; later versions keep it in `cvssData`. */
type CvssMetric = {
	type?: string;
	cvssData?: { baseScore?: number; baseSeverity?: string };
	baseSeverity?: string;
};

/** The parts of an NVD API 2.0 response that are used. Every field is optional: none is trusted to be present. */
type CveResponse = {
	vulnerabilities?: {
		cve?: {
			descriptions?: { lang?: string; value?: string }[];
			metrics?: {
				cvssMetricV40?: CvssMetric[];
				cvssMetricV31?: CvssMetric[];
				cvssMetricV30?: CvssMetric[];
				cvssMetricV2?: CvssMetric[];
			};
		};
	}[];
};

type Cve = NonNullable<NonNullable<CveResponse['vulnerabilities']>[number]['cve']>;

/**
 * CVE detail pages on nvd.nist.gov. The page is a script-rendered app with no metadata in its HTML,
 * so the summary is built from the NVD API instead.
 */
export const nvd: Provider = {
	name: 'nvd',

	test: url => url.hostname === 'nvd.nist.gov' && PATH.test(url.pathname),

	async summarize(ctx, url) {
		const match = PATH.exec(url.pathname);

		if (!match) {
			throw new Error('not a CVE detail URL');
		}

		// The API answers 404 (Invalid cveId parameter) for a lowercase ID.
		const id = match[1].toUpperCase();
		const endpoint = new URL(API);

		endpoint.searchParams.set('cveId', id);

		const res = await fetchSubresource(ctx, endpoint.href, 'GET');
		const body = JSON.parse(res.body.toString('utf-8')) as CveResponse;

		const cve = body.vulnerabilities && body.vulnerabilities.length > 0 ? body.vulnerabilities[0].cve : undefined;

		if (!cve) {
			throw new Error('CVE not found');
		}

		return {
			title: titleOf(id, cve),
			icon: 'https://nvd.nist.gov/favicon.ico',
			description: descriptionOf(cve),
			thumbnail: null,
			thumbnailStyle: null,
			player: {
				url: null,
				width: null,
				height: null,
				allow: [],
			},
			sitename: 'NVD',
			activityPub: null,
			fediverseCreator: null,
		};
	},
};

/** The English description (or the first one), on one line and clipped. */
function descriptionOf(cve: Cve): string | null {
	const descriptions = cve.descriptions ?? [];
	const chosen = descriptions.find(d => d.lang === 'en') ?? (descriptions.length > 0 ? descriptions[0] : undefined);
	const text = chosen?.value;

	if (text == null) {
		return null;
	}

	return clip(text.replace(/\s+/g, ' '), 300);
}

/** `CVE-2026-16478 (HIGH 7.0)` from the newest CVSS version present, preferring the primary source's score. */
function titleOf(id: string, cve: Cve): string {
	const metrics = cve.metrics ?? {};
	const versions = [metrics.cvssMetricV40, metrics.cvssMetricV31, metrics.cvssMetricV30, metrics.cvssMetricV2];
	const entries = versions.find(v => v != null && v.length > 0);

	if (!entries) {
		return id;
	}

	const metric = entries.find(m => m.type === 'Primary') ?? entries[0];
	const score = metric.cvssData?.baseScore;
	const severity = metric.cvssData?.baseSeverity ?? metric.baseSeverity;

	if (typeof score !== 'number') {
		return id;
	}

	return severity ? `${id} (${severity} ${score.toFixed(1)})` : `${id} (${score.toFixed(1)})`;
}
