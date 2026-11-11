/**
 * Configuration loader for the standalone summaly server
 */

import type { SummalyOptions } from '@/index.js';

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
	 * Options passed to the summaly fastify plugin
	 */
	summalyOptions: SummalyOptions;
};

export const DEFAULT_SERVER_HOST = 'localhost';
export const DEFAULT_SERVER_PORT = 3000;

const MAX_PORT = 65535;

/**
 * Largest delay accepted by setTimeout (2^31 - 1 ms).
 * Larger values are silently replaced with 1 ms by Node.js, which would make every request time out.
 */
const MAX_TIMEOUT = 2147483647;

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

function parseNonNegativeInteger(name: string, value: string, max = Number.MAX_SAFE_INTEGER): number {
	const expected = `an integer between 0 and ${max}`;
	if (!/^\d+$/.test(value)) throw invalidValue(name, value, expected);

	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed > max) throw invalidValue(name, value, expected);

	return parsed;
}

/**
 * Builds the standalone server configuration from environment variables.
 *
 * Unset or empty variables are omitted from `summalyOptions` entirely, so that they do not
 * override values the fastify plugin derives from the request (e.g. the `lang` query parameter).
 *
 * @throws {ServerConfigError} if a variable has an invalid value
 */
export function loadServerConfig(env: NodeJS.ProcessEnv): ServerConfig {
	const host = readEnv(env, 'SUMMALY_HOST') ?? DEFAULT_SERVER_HOST;

	const rawPort = readEnv(env, 'SUMMALY_PORT');
	const port = rawPort != null ? parseNonNegativeInteger('SUMMALY_PORT', rawPort, MAX_PORT) : DEFAULT_SERVER_PORT;

	const summalyOptions: SummalyOptions = {};

	const lang = readEnv(env, 'SUMMALY_LANG');
	if (lang != null) summalyOptions.lang = lang;

	const userAgent = readEnv(env, 'SUMMALY_USER_AGENT');
	if (userAgent != null) summalyOptions.userAgent = userAgent;

	const followRedirects = readEnv(env, 'SUMMALY_FOLLOW_REDIRECTS');
	if (followRedirects != null) summalyOptions.followRedirects = parseBoolean('SUMMALY_FOLLOW_REDIRECTS', followRedirects);

	const responseTimeout = readEnv(env, 'SUMMALY_RESPONSE_TIMEOUT');
	if (responseTimeout != null) summalyOptions.responseTimeout = parseNonNegativeInteger('SUMMALY_RESPONSE_TIMEOUT', responseTimeout, MAX_TIMEOUT);

	const operationTimeout = readEnv(env, 'SUMMALY_OPERATION_TIMEOUT');
	if (operationTimeout != null) summalyOptions.operationTimeout = parseNonNegativeInteger('SUMMALY_OPERATION_TIMEOUT', operationTimeout, MAX_TIMEOUT);

	const contentLengthLimit = readEnv(env, 'SUMMALY_CONTENT_LENGTH_LIMIT');
	if (contentLengthLimit != null) summalyOptions.contentLengthLimit = parseNonNegativeInteger('SUMMALY_CONTENT_LENGTH_LIMIT', contentLengthLimit);

	const contentLengthRequired = readEnv(env, 'SUMMALY_CONTENT_LENGTH_REQUIRED');
	if (contentLengthRequired != null) summalyOptions.contentLengthRequired = parseBoolean('SUMMALY_CONTENT_LENGTH_REQUIRED', contentLengthRequired);

	return { host, port, summalyOptions };
}
