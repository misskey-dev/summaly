import dns from 'node:dns';
import { describe, expect, test, vi } from 'vitest';
import { StatusError } from '@/http/status-error.js';
import {
	assertHostAllowed,
	createAddressGuard,
	createGuardedLookup,
	isAddressAllowed,
	privateIpAllowedByEnv,
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

	// ipaddr.parseCIDR reads these as other networks (e.g. 192.168.010.0 → 192.168.8.0), so they are rejected.
	test.each(['192.168.010.0/24', '010.0.0.0/8', '0x7f.1/32', '127.1/8', '0x7f000001/32', '2130706433/32'])
		('正規の4つの10進数でない IPv4 CIDR %s は TypeError', cidr => {
			expect(() => createAddressGuard([cidr])).toThrow(TypeError);
			expect(() => createAddressGuard([cidr])).toThrow(`Invalid CIDR: ${cidr}`);
		});

	test.each([
		['::ffff:192.168.0.0/112', '192.168.0.0/16'],
		['::ffff:127.0.0.1/128', '127.0.0.1/32'],
		['::ffff:0:0/96', '0.0.0.0/0'],
	])('IPv4 射影 IPv6 の CIDR %s は IPv4 形式を促す TypeError', (cidr, ipv4) => {
		expect(() => createAddressGuard([cidr])).toThrow(TypeError);
		expect(() => createAddressGuard([cidr])).toThrow(`write it in IPv4 form (${ipv4})`);
	});

	test('IPv4 射影 IPv6 の範囲が /96 より広い CIDR も TypeError', () => {
		expect(() => createAddressGuard(['::ffff:0:0/80'])).toThrow('write it in IPv4 form');
	});

	test('正規の IPv4 / IPv6 CIDR は受け付ける', () => {
		const guard = createAddressGuard(['0.0.0.0/0', '10.0.0.0/8', '192.168.10.0/24', '::/0', '::1/128', 'fd00::/8', '2001:db8::/32']);
		expect(guard.allowedNetworks).toHaveLength(7);
		expect(isAddressAllowed(createAddressGuard(['192.168.10.0/24']), '192.168.10.5')).toBe(true);
		expect(isAddressAllowed(createAddressGuard(['fd00::/8']), 'fd00::1')).toBe(true);
	});

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

	test('privateIpAllowedByEnv: SUMMALY_ALLOW_PRIVATE_IP が true のときだけ true', () => {
		expect(privateIpAllowedByEnv({ SUMMALY_ALLOW_PRIVATE_IP: 'true' })).toBe(true);
		expect(privateIpAllowedByEnv({})).toBe(false);
		expect(privateIpAllowedByEnv({ SUMMALY_ALLOW_PRIVATE_IP: 'false' })).toBe(false);
		expect(privateIpAllowedByEnv({ SUMMALY_ALLOW_PRIVATE_IP: 'TRUE' })).toBe(false);
		expect(privateIpAllowedByEnv({ SUMMALY_ALLOW_PRIVATE_IP: '1' })).toBe(false);
	});

	test('privateIpAllowedByEnv: CHIRAMISS_ALLOW_PRIVATE_IP が true のときも true', () => {
		expect(privateIpAllowedByEnv({ CHIRAMISS_ALLOW_PRIVATE_IP: 'true' })).toBe(true);
		expect(privateIpAllowedByEnv({ CHIRAMISS_ALLOW_PRIVATE_IP: 'false' })).toBe(false);
		expect(privateIpAllowedByEnv({ CHIRAMISS_ALLOW_PRIVATE_IP: 'TRUE' })).toBe(false);
		expect(privateIpAllowedByEnv({ CHIRAMISS_ALLOW_PRIVATE_IP: '1' })).toBe(false);
	});

	test('privateIpAllowedByEnv: 両方あれば CHIRAMISS_ALLOW_PRIVATE_IP が優先、空文字なら SUMMALY_ALLOW_PRIVATE_IP を使う', () => {
		expect(privateIpAllowedByEnv({ CHIRAMISS_ALLOW_PRIVATE_IP: 'false', SUMMALY_ALLOW_PRIVATE_IP: 'true' })).toBe(false);
		expect(privateIpAllowedByEnv({ CHIRAMISS_ALLOW_PRIVATE_IP: 'true', SUMMALY_ALLOW_PRIVATE_IP: 'false' })).toBe(true);
		expect(privateIpAllowedByEnv({ CHIRAMISS_ALLOW_PRIVATE_IP: '', SUMMALY_ALLOW_PRIVATE_IP: 'true' })).toBe(true);
	});
});
