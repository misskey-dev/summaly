import { createHash, randomUUID } from 'node:crypto';
import { privateIpAllowedByEnv } from '@/http/address-guard.js';
import type { SummalyOptions } from '@/types.js';
import { VERSION } from '@/version.js';

const ids = new WeakMap<object, number>();
let nextId = 1;

/**
 * Chosen once per process and part of every object identity in a key: objectId numbers restart at 1 in each
 * process, so without it two processes sharing an external cache could give different agents the same key.
 */
const PROCESS_NONCE = randomUUID();

/** A number unique to `obj` for as long as it lives, so objects that cannot be serialized (agents) can be part of a key. */
export function objectId(obj: object): number {
	let id = ids.get(obj);

	if (id === undefined) {
		id = nextId++;
		ids.set(obj, id);
	}

	return id;
}

/** Objects are identified by identity (only meaningful within this process); anything else is kept as a value. */
function identity(value: unknown): unknown {
	return (typeof value === 'object' && value !== null) || typeof value === 'function'
		? { process: PROCESS_NONCE, id: objectId(value) }
		: value;
}

/**
 * Type-tagged serialization: unlike JSON, undefined / null / NaN / Infinity / "1" / 1 all stay distinct,
 * and object keys are sorted so the result does not depend on property order.
 */
function canonical(value: unknown): string {
	if (value === undefined) {
		return 'u';
	}
	if (value === null) {
		return 'n';
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonical).join(',')}]`;
	}
	switch (typeof value) {
		case 'string':
			return `s${JSON.stringify(value)}`;
		case 'number':
			return `d${String(value)}`;
		case 'boolean':
			return value ? 't' : 'f';
		case 'object': {
			const record = value as Record<string, unknown>;
			const fields = Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`);

			return `{${fields.join(',')}}`;
		}
		case 'bigint':
			return `b${value.toString()}`;
		case 'symbol':
			return `y${value.toString()}`;
		case 'function':
			return `f${PROCESS_NONCE}:${objectId(value)}`;
		default:
			return `${typeof value}`;
	}
}

/**
 * Options that change how any request of a summary is sent or what it may reach, so they change every result
 * built from requests (the summary and each favicon check). Both keys take them from here, so they are listed once.
 */
function requestParts(opts: SummalyOptions, allowPrivateIp: boolean): Record<string, unknown> {
	return {
		userAgent: opts.userAgent,
		responseTimeout: opts.responseTimeout,
		operationTimeout: opts.operationTimeout,
		contentLengthLimit: opts.contentLengthLimit,
		allowedPrivateNetworks: opts.allowedPrivateNetworks,
		proxy: opts.proxy === undefined ? undefined : {
			http: opts.proxy.http,
			https: opts.proxy.https,
			noProxy: opts.proxy.noProxy,
		},
		agent: {
			http: identity(opts.agent?.http),
			https: identity(opts.agent?.https),
		},
		allowPrivateIp,
		// The built-in plugins and the extraction rules can change between versions.
		version: VERSION,
	};
}

/**
 * Returned as a SHA-256 hex digest, because the parts include proxy URLs that may carry credentials
 * and the key may be stored outside the process (e.g. Redis).
 */
function digest(parts: Record<string, unknown>): string {
	return createHash('sha256').update(canonical(parts)).digest('hex');
}

/**
 * Key for the cache and in-flight sharing of a summary: the URL plus every option that can change the result.
 * `cache` and `coordinator` do not change the result and are left out.
 * Plugins are identified by their names (unique within a summary), so the key is the same in every process.
 * `purpose` keeps it apart from every favicon check key.
 * `allowPrivateIp` is whether the environment allows private IPs (see privateIpAllowedByEnv); a call passes the value
 * its transport was built with.
 */
export function buildRequestKey(url: string, opts: SummalyOptions, allowPrivateIp = privateIpAllowedByEnv()): string {
	return digest({
		...requestParts(opts, allowPrivateIp),
		purpose: 'summary',
		url,
		lang: opts.lang,
		followRedirects: opts.followRedirects,
		contentLengthRequired: opts.contentLengthRequired,
		plugins: opts.plugins?.map(plugin => plugin.name),
	});
}

/**
 * Key for the cache and in-flight sharing of a favicon check: the icon's absolute URL plus the options that can
 * change a HEAD for it. The HEAD sends no Accept-Language, always follows redirects and never requires
 * content-length, so `lang`, `followRedirects` and `contentLengthRequired` are left out. So are `plugins`: which plugin
 * summarizes the page does not change a check's result.
 * `purpose` keeps it apart from every summary key. `allowPrivateIp` is as in buildRequestKey.
 */
export function buildIconKey(url: string, opts: SummalyOptions, allowPrivateIp = privateIpAllowedByEnv()): string {
	return digest({ ...requestParts(opts, allowPrivateIp), purpose: 'icon', url });
}
