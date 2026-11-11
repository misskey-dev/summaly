import http from 'node:http';
import { describe, expect, test } from 'vitest';
import { StatusError } from '@/http/status-error.js';
import {
	assertHostAllowed,
	createAddressGuard,
	createGuardedLookup,
	isAddressAllowed,
	isGuardDisabled,
} from '@/http/address-guard.js';

describe('AddressGuard', () => {
	test.each(['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fc00::1', '::ffff:127.0.0.1', '0.0.0.0'])
		('%s は拒否される', ip => expect(isAddressAllowed(createAddressGuard(), ip)).toBe(false));

	test('公開 IP は許可される', () => expect(isAddressAllowed(createAddressGuard(), '93.184.216.34')).toBe(true));

	test('解釈できない文字列は拒否される', () => expect(isAddressAllowed(createAddressGuard(), 'not-an-ip')).toBe(false));

	test('CIDR 例外に入るプライベート IP は許可される', () => {
		expect(isAddressAllowed(createAddressGuard(['10.0.0.0/8']), '10.1.2.3')).toBe(true);
		expect(isAddressAllowed(createAddressGuard(['10.0.0.0/8']), '192.168.0.1')).toBe(false);
	});

	test('不正な CIDR は TypeError', () => expect(() => createAddressGuard(['nope'])).toThrow(TypeError));

	test('assertHostAllowed は localhost を StatusError(400) で拒否する', async () => {
		const e = await assertHostAllowed(createAddressGuard(), 'localhost').catch(e => e);
		expect(e).toBeInstanceOf(StatusError);
		expect(e.statusCode).toBe(400);
		expect(e.message).toContain('Private IP rejected');
	});

	test('assertHostAllowed は IP リテラルをそのまま判定する', async () => {
		await expect(assertHostAllowed(createAddressGuard(), '10.0.0.1')).rejects.toBeInstanceOf(StatusError);
		await expect(assertHostAllowed(createAddressGuard(), '[::1]')).rejects.toBeInstanceOf(StatusError);
		await expect(assertHostAllowed(createAddressGuard(), '93.184.216.34')).resolves.toBeUndefined();
	});

	test('createGuardedLookup は接続時の名前解決でも拒否する', async () => {
		const lookup = createGuardedLookup(createAddressGuard());
		const err = await new Promise<any>(resolve => lookup('localhost', {}, e => resolve(e)));
		expect(err).toBeInstanceOf(StatusError);
		expect(err.statusCode).toBe(400);
	});

	test('createGuardedLookup は例外ネットワークなら通す', async () => {
		const lookup = createGuardedLookup(createAddressGuard(['127.0.0.0/8', '::1/128']));
		const err = await new Promise<any>(resolve => lookup('localhost', { all: true }, e => resolve(e)));
		expect(err).toBeNull();
	});

	test('isGuardDisabled: agent あり→true、空オブジェクト→false、env=true→true', () => {
		expect(isGuardDisabled({ http: new http.Agent() }, {})).toBe(true);
		expect(isGuardDisabled({}, {})).toBe(false);
		expect(isGuardDisabled(undefined, {})).toBe(false);
		expect(isGuardDisabled(undefined, { SUMMALY_ALLOW_PRIVATE_IP: 'true' })).toBe(true);
	});
});
