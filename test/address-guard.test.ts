import dns from 'node:dns';
import http from 'node:http';
import { describe, expect, test, vi } from 'vitest';
import { StatusError } from '@/http/status-error.js';
import {
	assertHostAllowed,
	createAddressGuard,
	createGuardedLookup,
	isAddressAllowed,
	isGuardDisabled,
} from '@/http/address-guard.js';

describe('AddressGuard', () => {
	test.each(['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fc00::1', '::ffff:127.0.0.1', '0.0.0.0', '::127.0.0.1', '::7f00:1', '::a00:1'])
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
		await expect(assertHostAllowed(createAddressGuard(), '93.184.216.34')).resolves.toEqual(['93.184.216.34']);
		await expect(assertHostAllowed(createAddressGuard(['2001:db8::/32']), '[2001:db8::1]')).resolves.toEqual(['2001:db8::1']);
	});

	test('assertHostAllowed は検証したアドレスを解決順に返す', async () => {
		const spy = vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
			{ address: '93.184.216.34', family: 4 },
			{ address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
		] as any);
		const addresses = await assertHostAllowed(createAddressGuard(), 'example.test');
		spy.mockRestore();
		expect(addresses).toEqual(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']);
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
		const addrs = await new Promise<any>(resolve => lookup('localhost', { all: true }, (e, a) => resolve(a)));
		expect(Array.isArray(addrs)).toBe(true);
		expect(addrs.length).toBeGreaterThan(0);
		for (const a of addrs) {
			expect(typeof a.address).toBe('string');
			expect([4, 6]).toContain(a.family);
		}
	});

	test('createGuardedLookup all:false 成功時は文字列 address と family を返す', async () => {
		const lookup = createGuardedLookup(createAddressGuard(['127.0.0.0/8', '::1/128']));
		const r = await new Promise<any>(resolve => lookup('localhost', {}, (e, a, f) => resolve({ e, a, f })));
		expect(r.e).toBeNull();
		expect(typeof r.a).toBe('string');
		expect([4, 6]).toContain(r.f);
	});

	test('空ホスト名は assertHostAllowed で 400 拒否される', async () => {
		const e = await assertHostAllowed(createAddressGuard(), '').catch(e => e);
		expect(e).toBeInstanceOf(StatusError);
		expect(e.statusCode).toBe(400);
	});

	test('空の解決結果は fail-closed (assertHostAllowed / createGuardedLookup)', async () => {
		const spy = vi.spyOn(dns.promises, 'lookup').mockResolvedValue([] as any);
		const e = await assertHostAllowed(createAddressGuard(), 'example.test').catch(e => e);
		spy.mockRestore();
		expect(e).toBeInstanceOf(StatusError);
		expect(e.statusCode).toBe(400);

		const spy2 = vi.spyOn(dns, 'lookup').mockImplementation(((_h: any, _o: any, cb: any) => cb(null, [])) as any);
		const lookup = createGuardedLookup(createAddressGuard());
		const err = await new Promise<any>(resolve => lookup('example.test', {}, e => resolve(e)));
		spy2.mockRestore();
		expect(err).toBeInstanceOf(Error);
		expect(err.code).toBe('ENOTFOUND');
	});

	test('StatusError は JSON 化しても statusCode 等を保持する', () => {
		const o = JSON.parse(JSON.stringify(new StatusError('m', 400, 'x')));
		expect(o).toMatchObject({ statusCode: 400, statusMessage: 'x', isPermanentError: true });
	});

	test('isGuardDisabled: agent あり→true、空オブジェクト→false、env=true→true', () => {
		expect(isGuardDisabled({ http: new http.Agent() }, {})).toBe(true);
		expect(isGuardDisabled({}, {})).toBe(false);
		expect(isGuardDisabled({ http: undefined }, {})).toBe(false);
		expect(isGuardDisabled(undefined, {})).toBe(false);
		expect(isGuardDisabled(undefined, { SUMMALY_ALLOW_PRIVATE_IP: 'true' })).toBe(true);
	});
});
