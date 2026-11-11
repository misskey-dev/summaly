import { createHash, randomUUID } from 'node:crypto';
import type { SummalyOptions } from '@/types.js';

const ids = new WeakMap<object, number>();
let nextId = 1;

/**
 * Chosen once per process and part of every object identity in a key: objectId numbers restart at 1 in each
 * process, so without it two processes sharing an external cache could give different agents or plugins the same key.
 */
const PROCESS_NONCE = randomUUID();

/** A number unique to `obj` for as long as it lives, so objects that cannot be serialized (agents, plugins) can be part of a key. */
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
	if (value === undefined) return 'u';
	if (value === null) return 'n';
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	switch (typeof value) {
		case 'string': return `s${JSON.stringify(value)}`;
		case 'number': return `d${String(value)}`;
		case 'boolean': return value ? 't' : 'f';
		case 'object': {
			const record = value as Record<string, unknown>;
			const fields = Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`);
			return `{${fields.join(',')}}`;
		}
		case 'bigint': return `b${value.toString()}`;
		case 'symbol': return `y${value.toString()}`;
		case 'function': return `f${PROCESS_NONCE}:${objectId(value)}`;
		default: return `${typeof value}`;
	}
}

/**
 * Key for the cache and in-flight sharing: the URL plus every option that can change the result.
 * `cache`, `coordinator`, `cacheTtl` and `errorCacheTtl` do not change the result and are left out.
 * Returned as a SHA-256 hex digest, because the parts include proxy URLs that may carry credentials
 * and the key may be stored outside the process (e.g. Redis).
 */
export function buildRequestKey(url: string, opts: SummalyOptions): string {
	const parts = {
		url,
		lang: opts.lang,
		userAgent: opts.userAgent,
		followRedirects: opts.followRedirects,
		responseTimeout: opts.responseTimeout,
		operationTimeout: opts.operationTimeout,
		contentLengthLimit: opts.contentLengthLimit,
		contentLengthRequired: opts.contentLengthRequired,
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
		plugins: opts.plugins?.map(identity),
		allowPrivateIp: process.env.SUMMALY_ALLOW_PRIVATE_IP,
	};
	return createHash('sha256').update(canonical(parts)).digest('hex');
}
