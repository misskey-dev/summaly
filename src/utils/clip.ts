import nullOrEmpty from './null-or-empty.js';

export default function(s: string, max: number): string {
	if (nullOrEmpty(s)) {
		return s;
	}

	// eslint-disable-next-line no-param-reassign
	s = s.trim();

	if (s.length > max) {
		return s.substr(0, max) + '...';
	} else {
		return s;
	}
}
