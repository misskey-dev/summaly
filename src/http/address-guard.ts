import dns from 'node:dns';
import type net from 'node:net';
import ipaddr from 'ipaddr.js';
import type { SummalyOptions } from '@/types.js';
import { StatusError } from './status-error.js';

type Network = [ipaddr.IPv4 | ipaddr.IPv6, number];

export type AddressGuard = { allowedNetworks: Network[] };

export function createAddressGuard(allowedNetworks: string[] = []): AddressGuard {
	return {
		allowedNetworks: allowedNetworks.map(cidr => {
			try {
				return ipaddr.parseCIDR(cidr);
			} catch {
				throw new TypeError(`Invalid CIDR: ${cidr}`);
			}
		}),
	};
}

export function isAddressAllowed(guard: AddressGuard, ip: string): boolean {
	let addr: ipaddr.IPv4 | ipaddr.IPv6;
	try {
		addr = ipaddr.process(ip.replace(/^\[|\]$/g, ''));
	} catch {
		return false;
	}
	if (addr.range() === 'unicast') return true;
	return guard.allowedNetworks.some(([net, bits]) => addr.kind() === net.kind() && addr.match(net, bits));
}

function rejected(ip: string): StatusError {
	return new StatusError(`Private IP rejected ${ip}`, 400, 'Private IP Rejected');
}

export async function assertHostAllowed(guard: AddressGuard, hostname: string): Promise<void> {
	const host = hostname.replace(/^\[|\]$/g, '');
	if (ipaddr.isValid(host)) {
		if (!isAddressAllowed(guard, host)) throw rejected(host);
		return;
	}
	const results = await dns.promises.lookup(host, { all: true });
	for (const { address } of results) {
		if (!isAddressAllowed(guard, address)) throw rejected(address);
	}
}

/** Applies the same check at socket connect time (DNS rebinding defense). */
export function createGuardedLookup(guard: AddressGuard): net.LookupFunction {
	return (hostname, options, callback) => {
		dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
			if (err) {
				(callback as (e: NodeJS.ErrnoException | null) => void)(err);
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
	return env.SUMMALY_ALLOW_PRIVATE_IP === 'true' || Object.keys(agent ?? {}).length > 0;
}
