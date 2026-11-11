import http from 'node:http';
import https from 'node:https';
import { type AddressGuard, createAddressGuard, createGuardedLookup, guardKey } from './address-guard.js';

/**
 * How long an idle pooled socket is kept, in ms. Shorter than the keep-alive timeout of most servers
 * (Node's default is 5 s), so the client closes first and seldom sends on a socket the server is closing.
 * A shorter `Keep-Alive: timeout=N` from the server wins (Node keeps the socket N - 1 s).
 */
export const IDLE_SOCKET_TIMEOUT = 4000;

/**
 * Idle sockets kept per host (per agent name: host, port and TLS settings). One serves summaries of a site made one
 * after another; a few more cover small bursts. Sockets opened beyond it for a burst are closed when they go idle,
 * so a burst of parallel summaries to one site does not leave dozens of idle connections on it.
 * Active sockets are not limited (see createGuardedAgents).
 */
export const MAX_FREE_SOCKETS_PER_HOST = 4;

/** Guard settings a pool keeps agents for at once (see GuardedAgentPool). */
export const MAX_POOL_ENTRIES = 32;

export type GuardedAgents = { http: http.Agent; https: https.Agent };

/** A private IP guard and the agents built with it: every socket of these agents was checked by this guard. */
export type GuardedAgentSet = { guard: AddressGuard; agents: GuardedAgents };

export type GuardedAgentOptions = {
	/** Idle socket timeout in ms (default IDLE_SOCKET_TIMEOUT) */
	idleTimeout?: number;
	/** Idle sockets kept per host (default MAX_FREE_SOCKETS_PER_HOST) */
	maxFreeSockets?: number;
};

export type GuardedAgentPoolOptions = GuardedAgentOptions & {
	/** Guard settings kept at once (default MAX_POOL_ENTRIES) */
	maxEntries?: number;
};

/**
 * Keep-alive agents built with the guarded lookup, which checks every address a new socket connects to
 * (DNS rebinding defense). A socket goes back to the pool only after a complete response; a response dropped early
 * (error, size limit, timeout) destroys its socket, so it never returns to the pool.
 *
 * `timeout` applies to idle sockets (the agent destroys a pooled socket when it fires) and is unref'd with them, so
 * idle sockets never keep the process alive. An active request sets its own socket timeout (sendRequest passes
 * `responseTimeout`, 0 included), so the idle timeout never cuts a request.
 *
 * Accepted risk, shared by every keep-alive client: a non-compliant server that sends a body after a HEAD response
 * (or past Content-Length) in a later segment can have those bytes read as the next response on the reused socket,
 * which may belong to a later summary of the same host and port. Node destroys an idle pooled socket that receives data,
 * and sendRequest sends again when the bytes break the response (HPE_*), but bytes that happen to parse as a body go
 * unnoticed. Not reusing after a HEAD would give up most of the gain (HEAD for the final URL, then the page).
 */
export function createGuardedAgents(guard: AddressGuard, options: GuardedAgentOptions = {}): GuardedAgents {
	const lookup = createGuardedLookup(guard);
	const agentOptions = {
		keepAlive: true,
		lookup,
		timeout: options.idleTimeout ?? IDLE_SOCKET_TIMEOUT,
		maxFreeSockets: options.maxFreeSockets ?? MAX_FREE_SOCKETS_PER_HOST,
	};
	return {
		http: new http.Agent(agentOptions),
		https: new https.Agent(agentOptions),
	};
}

/**
 * Guarded agents shared by the summaries of one summarizer, one set per guard setting, so summaries of a site made
 * one after another reuse a connection instead of opening (and for https, handshaking) a new one each time.
 * Owned by a summarizer instance (like its MemorySummaryCache), never by the module: separate summarizers never
 * share connections.
 *
 * Summaries share a set only when their guards allow the same networks (see guardKey), so a socket opened under one
 * setting is never used by a summary whose setting would have refused its address; every socket of a set was checked
 * at connect time by the same guard.
 *
 * At most `maxEntries` sets are kept; using a set makes it the newest, and the oldest is dropped past the limit.
 * A dropped set is not destroyed: requests still using it finish normally, and its idle sockets close on their timeout.
 */
export class GuardedAgentPool {
	readonly #entries = new Map<string, GuardedAgentSet>();
	readonly #maxEntries: number;
	readonly #agentOptions: GuardedAgentOptions;

	constructor(options: GuardedAgentPoolOptions = {}) {
		this.#maxEntries = options.maxEntries ?? MAX_POOL_ENTRIES;
		this.#agentOptions = { idleTimeout: options.idleTimeout, maxFreeSockets: options.maxFreeSockets };
	}

	/** Number of guard settings kept. */
	get size(): number {
		return this.#entries.size;
	}

	/**
	 * The set for the guard that allows `allowedNetworks`, built on first use.
	 * @throws {TypeError} if an entry is not a CIDR in canonical form (see createAddressGuard)
	 */
	acquire(allowedNetworks: string[] | undefined): GuardedAgentSet {
		const guard = createAddressGuard(allowedNetworks);
		const key = guardKey(guard);
		let entry = this.#entries.get(key);
		if (entry) {
			// Re-inserted below, so the Map's order is least recently used first.
			this.#entries.delete(key);
		} else {
			entry = { guard, agents: createGuardedAgents(guard, this.#agentOptions) };
		}
		this.#entries.set(key, entry);
		if (this.#entries.size > this.#maxEntries) {
			const oldest = this.#entries.keys().next();
			if (!oldest.done) this.#entries.delete(oldest.value);
		}
		return entry;
	}
}
