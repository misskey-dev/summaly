import dns from 'node:dns';
import type net from 'node:net';
import ipaddr from 'ipaddr.js';
import type { SummalyOptions } from '@/types.js';
import { StatusError } from './status-error.js';

type Network = [ipaddr.IPv4 | ipaddr.IPv6, number];

export type AddressGuard = { allowedNetworks: Network[] };

/**
 * @throws {TypeError} if an entry is not a CIDR in canonical form (see parseAllowedNetwork)
 */
export function createAddressGuard(allowedNetworks: string[] = []): AddressGuard {
	return { allowedNetworks: allowedNetworks.map(parseAllowedNetwork) };
}

/**
 * Parses one allowed network. Only canonical CIDRs are accepted:
 * - IPv4 must be four plain decimal parts without leading zeros. ipaddr.parseCIDR also reads octal, hex and
 *   short forms ('192.168.010.0/24' is 192.168.8.0/24, '127.1/8' is 127.0.0.1/8), which would silently allow
 *   a network other than the one the administrator meant.
 * - IPv4-mapped IPv6 (::ffff:0:0/96) is refused: addresses are checked after ipaddr.process() turns mapped
 *   addresses into IPv4, so such a network would never match anything.
 *
 * The standalone server repeats these checks at startup (packages/server/src/config.ts checkCidr);
 * change both together.
 */
function parseAllowedNetwork(cidr: string): Network {
	let network: Network;
	try {
		network = ipaddr.parseCIDR(cidr);
	} catch {
		throw new TypeError(`Invalid CIDR: ${cidr}`);
	}
	const [addr, bits] = network;
	if (addr.kind() === 'ipv4') {
		if (!ipaddr.IPv4.isValidCIDRFourPartDecimal(cidr)) throw new TypeError(`Invalid CIDR: ${cidr}`);
	} else if ((addr as ipaddr.IPv6).isIPv4MappedAddress()) {
		const ipv4 = bits >= 96 ? ` (${(addr as ipaddr.IPv6).toIPv4Address().toString()}/${bits - 96})` : '';
		throw new TypeError(`IPv4-mapped IPv6 CIDRs never match, write it in IPv4 form${ipv4}: ${cidr}`);
	}
	return network;
}

export function isAddressAllowed(guard: AddressGuard, ip: string): boolean {
	let addr: ipaddr.IPv4 | ipaddr.IPv6;
	try {
		addr = ipaddr.process(ip.replace(/^\[|\]$/g, ''));
	} catch {
		return false;
	}
	// IPv4-compatible IPv6 (::/96) is deprecated and notation-dependent; treat the whole range as non-public.
	const compat = addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).parts.slice(0, 6).every(p => p === 0);
	if (!compat && addr.range() === 'unicast') return true;
	return guard.allowedNetworks.some(([net, bits]) => addr.kind() === net.kind() && addr.match(net, bits));
}

function noAddress(host: string): StatusError {
	return new StatusError(`Private IP rejected: no address resolved for "${host}"`, 400, 'Private IP Rejected');
}

function rejected(ip: string): StatusError {
	return new StatusError(`Private IP rejected ${ip}`, 400, 'Private IP Rejected');
}

/**
 * Checks every address `hostname` resolves to and returns them (in resolution order) when all are allowed.
 * An IP literal is checked as is (brackets stripped) and returned as the only address.
 * Callers that connect through a proxy must connect to one of the returned addresses, not re-resolve the name.
 */
export async function assertHostAllowed(guard: AddressGuard, hostname: string): Promise<string[]> {
	const host = hostname.replace(/^\[|\]$/g, '');
	if (host === '') throw noAddress(hostname);
	if (ipaddr.isValid(host)) {
		if (!isAddressAllowed(guard, host)) throw rejected(host);
		// Canonical form, so the address handed to the proxy is exactly the one checked here.
		return [ipaddr.parse(host).toString()];
	}
	const results = await dns.promises.lookup(host, { all: true });
	if (results.length === 0) throw noAddress(host);
	for (const { address } of results) {
		if (!isAddressAllowed(guard, address)) throw rejected(address);
	}
	return results.map(r => r.address);
}

/** Applies the same check at socket connect time (DNS rebinding defense). */
export function createGuardedLookup(guard: AddressGuard): net.LookupFunction {
	return (hostname, options, callback) => {
		dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
			if (err) {
				(callback as (e: NodeJS.ErrnoException | null) => void)(err);
				return;
			}
			if (addresses.length === 0) {
				const e: NodeJS.ErrnoException = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
				e.code = 'ENOTFOUND';
				(e as any).hostname = hostname;
				(callback as (e: Error | null) => void)(e);
				return;
			}
			for (const { address } of addresses) {
				if (!isAddressAllowed(guard, address)) {
					(callback as (e: Error | null) => void)(rejected(address));
					return;
				}
			}
			if (options.all) {
				(callback as any)(null, addresses);
			} else {
				(callback as any)(null, addresses[0].address, addresses[0].family);
			}
		});
	};
}

export function isGuardDisabled(agent: SummalyOptions['agent'], env: NodeJS.ProcessEnv = process.env): boolean {
	return env.SUMMALY_ALLOW_PRIVATE_IP === 'true' || Object.values(agent ?? {}).some(Boolean);
}
