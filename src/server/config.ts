// Derived from misskey-dev/summaly (MIT)
/**
 * Configuration loader for the standalone chiramiss server
 */

import ipaddr from 'ipaddr.js';
import type { ProxyOptions, SummarizeOptions } from '@tiramiss-community/chiramiss';

export type ServerConfig = {
	/**
	 * Address the server listens on
	 */
	host: string;

	/**
	 * Port the server listens on
	 */
	port: number;

	/**
	 * Options passed to summarize
	 */
	summarizeOptions: SummarizeOptions;
};

export const DEFAULT_SERVER_HOST = 'localhost';
export const DEFAULT_SERVER_PORT = 3000;

const MAX_PORT = 65535;

/**
 * Largest delay accepted by setTimeout (2^31 - 1 ms).
 * Larger values are silently replaced with 1 ms by Node.js, which would make every request time out.
 */
export const MAX_TIMEOUT = 2147483647;

export class ServerConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ServerConfigError';
	}
}

/**
 * Returns the value of the variable, or undefined if it is unset or an empty string.
 */
function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
	const value = env[name];
	if (value == null || value === '') return undefined;
	return value;
}

/**
 * Reads the first of `names` that is set (see readEnv) and returns it together with the name it came from.
 */
function readFirstEnv(env: NodeJS.ProcessEnv, names: string[]): { name: string; value: string } | undefined {
	for (const name of names) {
		const value = readEnv(env, name);
		if (value != null) return { name, value };
	}
	return undefined;
}

function invalidValue(name: string, value: string, expected: string): ServerConfigError {
	return new ServerConfigError(`Invalid value for ${name}: ${JSON.stringify(value)} (expected ${expected})`);
}

function parseBoolean(name: string, value: string): boolean {
	switch (value.toLowerCase()) {
		case 'true':
		case '1':
			return true;
		case 'false':
		case '0':
			return false;
		default:
			throw invalidValue(name, value, 'one of true, false, 1, 0');
	}
}

/**
 * Parses a decimal integer between 0 and `max`, or returns undefined when `value` is not one.
 * Only plain digits are accepted (no sign, exponent, fraction or surrounding spaces).
 */
export function toNonNegativeInteger(value: string, max = Number.MAX_SAFE_INTEGER): number | undefined {
	if (!/^\d+$/.test(value)) return undefined;

	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed > max) return undefined;

	return parsed;
}

function parseNonNegativeInteger(name: string, value: string, max = Number.MAX_SAFE_INTEGER): number {
	const parsed = toNonNegativeInteger(value, max);
	if (parsed == null) throw invalidValue(name, value, `an integer between 0 and ${max}`);
	return parsed;
}

/**
 * Parses a comma-separated CIDR list. Spaces around entries and empty entries are ignored,
 * but at least one CIDR is required. Each CIDR must be canonical (see checkCidr).
 */
function parseCidrList(name: string, value: string): string[] {
	const cidrs = value.split(',').map(entry => entry.trim()).filter(entry => entry !== '');
	const expected = 'a comma-separated list of CIDRs such as 10.0.0.0/8,fd00::/8';
	if (cidrs.length === 0) throw invalidValue(name, value, expected);
	for (const cidr of cidrs) {
		const problem = checkCidr(cidr);
		if (problem === 'invalid') throw invalidValue(name, value, expected);
		if (problem != null) {
			throw new ServerConfigError(`Invalid value for ${name}: ${JSON.stringify(value)} (${cidr} is an IPv4-mapped IPv6 CIDR, which never matches; write it in IPv4 form${problem.ipv4 != null ? ` (${problem.ipv4})` : ''})`);
		}
	}
	return cidrs;
}

/**
 * Same checks as the lib's parseAllowedNetwork (packages/chiramiss/src/http/address-guard.ts), repeated here
 * so a bad value stops the server at startup instead of failing every request; change both together.
 * - IPv4 must be four plain decimal parts without leading zeros: ipaddr.parseCIDR also reads octal, hex and
 *   short forms ('192.168.010.0/24' is 192.168.8.0/24), which would allow a network other than the one meant.
 * - IPv4-mapped IPv6 (::ffff:0:0/96) never matches, since addresses are checked in their IPv4 form.
 *   The IPv4 form of the network is returned for the error message when the prefix is /96 or longer.
 */
function checkCidr(cidr: string): 'invalid' | { ipv4: string | undefined } | undefined {
	let addr: ipaddr.IPv4 | ipaddr.IPv6;
	let bits: number;
	try {
		[addr, bits] = ipaddr.parseCIDR(cidr);
	} catch {
		return 'invalid';
	}
	if (addr.kind() === 'ipv4') {
		return ipaddr.IPv4.isValidCIDRFourPartDecimal(cidr) ? undefined : 'invalid';
	}
	if ((addr as ipaddr.IPv6).isIPv4MappedAddress()) {
		return { ipv4: bits >= 96 ? `${(addr as ipaddr.IPv6).toIPv4Address().toString()}/${bits - 96}` : undefined };
	}
	return undefined;
}

/**
 * Checks that a proxy URL is http: or https: with a host name. The error message shows the value
 * with any user name and password redacted.
 */
function parseProxyUrl(name: string, value: string): string {
	let url: URL | undefined;
	try {
		url = new URL(value);
	} catch {
		// Reported below
	}
	if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '') {
		throw invalidValue(name, redactUserinfo(value), 'an http: or https: URL with a host');
	}
	return value;
}

/**
 * Replaces everything between the scheme separator (`scheme://`, or the start when there is none) and the last `@`
 * with `***`. Works on the raw text, so it also covers values `new URL()` cannot parse.
 *
 * A copy of the lib's redactUserinfo in packages/chiramiss/src/http/proxy/proxy-url.ts (internal there, not exported).
 * Both must change together, so that a proxy URL is redacted the same way at startup and at request time.
 */
function redactUserinfo(value: string): string {
	const at = value.lastIndexOf('@');
	if (at === -1) return value;
	const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(value);
	const start = scheme && scheme[0].length <= at ? scheme[0].length : 0;
	return `${value.slice(0, start)}***${value.slice(at)}`;
}

/**
 * Reads the conventional proxy variables. Upper case names win over lower case ones.
 * Returns undefined when none of them is set.
 */
function loadProxyOptions(env: NodeJS.ProcessEnv): ProxyOptions | undefined {
	const proxy: ProxyOptions = {};

	const http = readFirstEnv(env, ['HTTP_PROXY', 'http_proxy']);
	if (http != null) proxy.http = parseProxyUrl(http.name, http.value);

	const https = readFirstEnv(env, ['HTTPS_PROXY', 'https_proxy']);
	if (https != null) proxy.https = parseProxyUrl(https.name, https.value);

	const noProxy = readFirstEnv(env, ['NO_PROXY', 'no_proxy']);
	if (noProxy != null) proxy.noProxy = noProxy.value;

	return Object.keys(proxy).length > 0 ? proxy : undefined;
}

/**
 * Reads a server setting: `CHIRAMISS_<suffix>`, or `SUMMALY_<suffix>` (kept for summaly compatibility) when that is
 * unset or empty. Returns the value together with the name it came from, so error messages show the variable read.
 */
function readSetting(env: NodeJS.ProcessEnv, suffix: string): { name: string; value: string } | undefined {
	return readFirstEnv(env, [`CHIRAMISS_${suffix}`, `SUMMALY_${suffix}`]);
}

/**
 * Builds the standalone server configuration from environment variables.
 *
 * Each setting is read from `CHIRAMISS_<NAME>`, falling back to `SUMMALY_<NAME>` when that is unset or empty.
 * Unset or empty variables are omitted from `summarizeOptions` entirely, so that they do not
 * override values taken from the request (e.g. the `lang` query parameter).
 *
 * @throws {ServerConfigError} if a variable has an invalid value
 */
export function loadServerConfig(env: NodeJS.ProcessEnv): ServerConfig {
	const host = readSetting(env, 'HOST')?.value ?? DEFAULT_SERVER_HOST;

	const rawPort = readSetting(env, 'PORT');
	const port = rawPort != null ? parseNonNegativeInteger(rawPort.name, rawPort.value, MAX_PORT) : DEFAULT_SERVER_PORT;

	const summarizeOptions: SummarizeOptions = {};

	const lang = readSetting(env, 'LANG');
	if (lang != null) summarizeOptions.lang = lang.value;

	const userAgent = readSetting(env, 'USER_AGENT');
	if (userAgent != null) summarizeOptions.userAgent = userAgent.value;

	const followRedirects = readSetting(env, 'FOLLOW_REDIRECTS');
	if (followRedirects != null) summarizeOptions.followRedirects = parseBoolean(followRedirects.name, followRedirects.value);

	const responseTimeout = readSetting(env, 'RESPONSE_TIMEOUT');
	if (responseTimeout != null) summarizeOptions.responseTimeout = parseNonNegativeInteger(responseTimeout.name, responseTimeout.value, MAX_TIMEOUT);

	const operationTimeout = readSetting(env, 'OPERATION_TIMEOUT');
	if (operationTimeout != null) summarizeOptions.operationTimeout = parseNonNegativeInteger(operationTimeout.name, operationTimeout.value, MAX_TIMEOUT);

	const contentLengthLimit = readSetting(env, 'CONTENT_LENGTH_LIMIT');
	if (contentLengthLimit != null) summarizeOptions.contentLengthLimit = parseNonNegativeInteger(contentLengthLimit.name, contentLengthLimit.value);

	const contentLengthRequired = readSetting(env, 'CONTENT_LENGTH_REQUIRED');
	if (contentLengthRequired != null) summarizeOptions.contentLengthRequired = parseBoolean(contentLengthRequired.name, contentLengthRequired.value);

	const allowedPrivateNetworks = readSetting(env, 'ALLOWED_PRIVATE_NETWORKS');
	if (allowedPrivateNetworks != null) summarizeOptions.allowedPrivateNetworks = parseCidrList(allowedPrivateNetworks.name, allowedPrivateNetworks.value);

	const proxy = loadProxyOptions(env);
	if (proxy != null) summarizeOptions.proxy = proxy;

	const cacheTtl = readSetting(env, 'CACHE_TTL');
	if (cacheTtl != null) summarizeOptions.cacheTtl = parseNonNegativeInteger(cacheTtl.name, cacheTtl.value);

	const errorCacheTtl = readSetting(env, 'ERROR_CACHE_TTL');
	if (errorCacheTtl != null) summarizeOptions.errorCacheTtl = parseNonNegativeInteger(errorCacheTtl.name, errorCacheTtl.value);

	return { host, port, summarizeOptions };
}
