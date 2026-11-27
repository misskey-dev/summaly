import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type TestServer = {
	/** Base URL such as `http://127.0.0.1:12345/` */
	url: string;
	close(): Promise<void>;
};

/**
 * Starts a node:http server on an ephemeral port (port 0).
 * `host` defaults to 127.0.0.1; any loopback address (e.g. 127.0.0.2) can be used.
 */
export function startTestServer(
	handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
	host = '127.0.0.1',
): Promise<TestServer> {
	const server = http.createServer(handler);

	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, host, () => {
			const { port } = server.address() as AddressInfo;
			const urlHost = host.includes(':') ? `[${host}]` : host;

			resolve({
				url: `http://${urlHost}:${port}/`,
				close: () => new Promise<void>((done, fail) => {
					server.close(err => (err ? fail(err) : done()));
					server.closeAllConnections();
				}),
			});
		});
	});
}
