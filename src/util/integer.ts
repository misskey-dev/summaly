/**
 * Largest delay accepted by setTimeout (2^31 - 1 ms).
 * Larger values are silently replaced with 1 ms by Node.js, which would make every request time out.
 */
export const MAX_TIMEOUT = 2147483647;

/**
 * Parses a decimal integer between 0 and `max`, or returns undefined when `value` is not one.
 * Only plain digits are accepted (no sign, exponent, fraction or surrounding spaces).
 */
export function toNonNegativeInteger(value: string, max = Number.MAX_SAFE_INTEGER): number | undefined {
	if (!/^\d+$/.test(value)) {
		return undefined;
	}

	const parsed = Number(value);

	if (!Number.isSafeInteger(parsed) || parsed > max) {
		return undefined;
	}

	return parsed;
}
