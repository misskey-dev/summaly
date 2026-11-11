import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/**
 * Caller-style agents that send every request, whatever its host or scheme, as plain HTTP
 * to `127.0.0.1:<port>`. Lets provider tests use real hostnames (www.amazon.co.jp, ja.wikipedia.org)
 * without touching the network. Passing them hands private IP blocking off to the caller, like any agent.
 */
export function loopbackAgents(port: number): { http: http.Agent; https: https.Agent; destroy(): void } {
	const connect = () => net.connect(port, '127.0.0.1');
	const httpAgent = new http.Agent();
	httpAgent.createConnection = connect as typeof httpAgent.createConnection;
	const httpsAgent = new https.Agent();
	httpsAgent.createConnection = connect as typeof httpsAgent.createConnection;
	return {
		http: httpAgent,
		https: httpsAgent,
		destroy() {
			httpAgent.destroy();
			httpsAgent.destroy();
		},
	};
}
