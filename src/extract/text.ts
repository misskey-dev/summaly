// Derived from misskey-dev/summaly (MIT)

function isBlank(s: string | null | undefined): boolean {
	return s == null || s.trim() === '';
}

/** Trims `s` and cuts it to `max` characters, appending `...` when cut. Blank input is returned as is. */
export function clip(s: string, max: number): string {
	if (isBlank(s)) {
		return s;
	}

	const trimmed = s.trim();
	return trimmed.length > max ? trimmed.slice(0, max) + '...' : trimmed;
}

/** Removes a trailing site name such as `Title | Site` or `Title - Site` from the title. */
export function cleanupTitle(title: string, siteName?: string | null): string {
	const trimmed = title.trim();
	if (!siteName) {
		return trimmed;
	}

	const pattern = new RegExp(`^(.+?)\\s?[\\-\\|:・]\\s?${RegExp.escape(siteName.trim())}$`);
	return pattern.exec(trimmed)?.[1] ?? trimmed;
}
