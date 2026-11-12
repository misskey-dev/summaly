/**
 * Outbound proxy support: NO_PROXY matching (no-proxy.ts), proxy URL validation and redaction (proxy-url.ts)
 * and the CONNECT tunnel agents (tunnel.ts).
 */
export { selectProxyUrl } from './no-proxy.js';
export { assertProxyOptions } from './proxy-url.js';
export {
	createProxyAgents,
	TUNNEL_TARGET,
	type TunnelingAgentOptions,
	TunnelingHttpAgent,
	TunnelingHttpsAgent,
	type TunnelTarget,
} from './tunnel.js';
