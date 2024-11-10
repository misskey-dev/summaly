/* eslint-disable @typescript-eslint/no-unnecessary-condition */
export function nullOrEmpty(val: string): boolean {
	if (val === undefined) {
		return true;
	} else if (val === null) {
		return true;
	} else if (val.trim() === '') {
		return true;
	} else {
		return false;
	}
}
