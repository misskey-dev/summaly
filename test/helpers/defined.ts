/** Returns `value`, failing the test when it is null or undefined. Used instead of a non-null assertion (`!`). */
export function defined<T>(value: T | null | undefined): T {
	if (value == null) {
		throw new Error(`Expected a value, got ${String(value)}`);
	}

	return value;
}
