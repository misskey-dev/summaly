// Derived from misskey-dev/summaly (MIT)
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { Transform, type TransformCallback } from 'node:stream';
import zlib from 'node:zlib';
import { assertHostAllowed } from './address-guard.js';
import { StatusError } from './status-error.js';
import { TUNNEL_TARGET, type TunnelTarget } from './proxy/index.js';
import { type Transport, selectOwnedAgent } from './transport.js';

export type FetchRequest = {
	url: string;
	method: 'GET' | 'HEAD';
	headers: Record<string, string | undefined>;
	typeFilter?: RegExp;
	followRedirects: boolean;
	/** Connect / socket idle timeout in ms (0 disables) */
	responseTimeout: number;
	/** Whole-operation timeout in ms, across all redirect hops (0 disables) */
	operationTimeout: number;
	contentLengthLimit: number;
	contentLengthRequired: boolean;
};

export type FetchResult = {
	/** Final URL after redirects */
	url: string;
	statusCode: number;
	headers: http.IncomingHttpHeaders;
	/** Decompressed body */
	body: Buffer;
};

const MAX_REDIRECTS = 10;
// Same as got: 300 and 304 are not followed.
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

export async function fetchResponse(transport: Transport, req: FetchRequest): Promise<FetchResult> {
	const controller = new AbortController();
	const timer = req.operationTimeout > 0
		? setTimeout(() => controller.abort(new Error(`Timeout awaiting 'request' for ${req.operationTimeout}ms`)), req.operationTimeout)
		: undefined;
	try {
		return await fetchFollowingRedirects(transport, req, controller.signal);
	} catch (e) {
		if (controller.signal.aborted) throw controller.signal.reason;
		throw e;
	} finally {
		clearTimeout(timer);
	}
}

async function fetchFollowingRedirects(transport: Transport, req: FetchRequest, signal: AbortSignal): Promise<FetchResult> {
	let url = parseHttpUrl(req.url);
	for (let redirects = 0; ; redirects++) {
		const { res, timeoutError } = await sendRequest(transport, req, url, signal);
		const location = res.headers.location;
		if (req.followRedirects && location && REDIRECT_CODES.has(res.statusCode ?? 0)) {
			res.destroy();
			if (redirects >= MAX_REDIRECTS) {
				throw new Error(`Redirected ${MAX_REDIRECTS} times. Aborting.`);
			}
			url = parseHttpUrl(new URL(location, url).href);
			continue;
		}
		try {
			return await receiveResponse(req, url, res);
		} catch (e) {
			throw timeoutError() ?? e;
		}
	}
}

function parseHttpUrl(input: string): URL {
	const url = new URL(input);
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`Unsupported protocol: ${url.protocol}`);
	}
	return url;
}

function buildHeaders(headers: FetchRequest['headers']): http.OutgoingHttpHeaders {
	const result: http.OutgoingHttpHeaders = {};
	for (const [name, value] of Object.entries(headers)) {
		if (value !== undefined && name.toLowerCase() !== 'accept-encoding') result[name] = value;
	}
	result['accept-encoding'] = 'gzip, deflate, br';
	return result;
}

/** Sends one hop and resolves once the response headers arrive. */
async function sendRequest(transport: Transport, req: FetchRequest, url: URL, signal: AbortSignal) {
	const isHttps = url.protocol === 'https:';
	// A caller-supplied agent for this scheme takes over private IP blocking; otherwise the hop stays guarded.
	const callerAgent = isHttps ? transport.agents.https : transport.agents.http;
	let agent: http.Agent | undefined = callerAgent;
	let tunnelTarget: TunnelTarget | undefined;
	if (!callerAgent) {
		let validated: string[] | undefined;
		if (transport.guard) {
			// Gate every hop before connecting or asking the proxy. This is the only check of the target when
			// it is an IP literal (net.connect skips `lookup`) or when the hop goes through the proxy.
			validated = await abortable(assertHostAllowed(transport.guard, url.hostname), signal);
		}
		// Direct hops use the transport-owned guarded agents, whose lookup re-checks at connect time
		// (DNS rebinding defense). They never hold sockets opened under another policy, so that check
		// is never skipped by socket reuse.
		// Proxied hops tunnel to an address validated above, so the proxy never resolves the name again
		// (DNS rebinding / split-horizon DNS). The proxy agents read them from the request options and
		// try them in order (IPv4 first) until a tunnel opens, all under the operation's signal.
		agent = selectOwnedAgent(transport, url);
		tunnelTarget = { addresses: validated && ipv4First(validated), signal };
	}

	const options: https.RequestOptions & { [TUNNEL_TARGET]?: TunnelTarget } = {
		method: req.method,
		headers: buildHeaders(req.headers),
		agent,
		signal,
	};
	if (tunnelTarget) options[TUNNEL_TARGET] = tunnelTarget;
	if (req.responseTimeout > 0) {
		options.timeout = req.responseTimeout;
	} else if (agent !== undefined && (agent === transport.guardedAgents?.http || agent === transport.guardedAgents?.https)) {
		// The guarded agents set a timeout on their sockets for idle ones (see createGuardedAgents); without a value
		// of its own, a request would keep it and be cut while waiting for the server. 0 turns it off for this request.
		options.timeout = 0;
	}

	let timeoutError: Error | undefined;
	const send = () => new Promise<http.IncomingMessage>((resolve, reject) => {
		let response: http.IncomingMessage | undefined;
		let failed = false;
		const request = (isHttps ? https : http).request(url, options, r => {
			response = r;
			signal.removeEventListener('abort', onAbort);
			resolve(r);
		});
		// Reject on abort right away: until the agent hands over a socket (e.g. while a proxy CONNECT is pending),
		// destroying the request only records the error.
		const onAbort = () => {
			reject(signal.reason);
			request.destroy(signal.reason as Error);
		};
		signal.addEventListener('abort', onAbort, { once: true });
		request.on('timeout', () => {
			timeoutError = new Error(`Timeout awaiting 'socket' for ${req.responseTimeout}ms`);
			request.destroy(timeoutError);
			response?.destroy(timeoutError);
		});
		// Stays attached after the response so late socket errors never go unhandled.
		request.on('error', err => {
			signal.removeEventListener('abort', onAbort);
			const first = !failed;
			failed = true;
			// A reused keep-alive socket can fail before any response: the server closed it while it sat idle
			// (ECONNRESET), or bytes left over from the previous response reached it after this request went out
			// (an HTTP parser error, HPE_*), e.g. a non-compliant server sending a body after a HEAD response or
			// past Content-Length. GET and HEAD are idempotent, so send again: the retry takes another pooled socket
			// or opens a new one, which goes through the same agent and checks. A request on a new socket is never retried.
			if (first && response === undefined && request.reusedSocket && isStaleSocketError(err)
				&& !signal.aborted && timeoutError === undefined) {
				send().then(resolve, reject);
				return;
			}
			reject(err);
		});
		request.end();
	});
	const res = await send();
	return { res, timeoutError: () => timeoutError };
}

/** An error of a reused socket that says nothing about the server's answer to this request (see sendRequest). */
function isStaleSocketError(err: Error): boolean {
	const code = (err as NodeJS.ErrnoException).code;
	return code === 'ECONNRESET' || (code?.startsWith('HPE_') ?? false);
}

async function receiveResponse(req: FetchRequest, url: URL, res: http.IncomingMessage): Promise<FetchResult> {
	const statusCode = res.statusCode ?? 0;
	// Like got: fall back to the standard reason phrase when the server sends an empty one.
	const statusMessage = res.statusMessage !== undefined && res.statusMessage !== ''
		? res.statusMessage
		: http.STATUS_CODES[statusCode] ?? '';
	try {
		// Status check (same rule as got: with followRedirects, unfollowed 3xx other than 304 are errors)
		const okLimit = req.followRedirects ? 299 : 399;
		if (!((statusCode >= 200 && statusCode <= okLimit) || statusCode === 304)) {
			throw new StatusError(`${statusCode} ${statusMessage}`, statusCode, statusMessage);
		}

		// Check html
		const contentType = res.headers['content-type'];
		if (req.typeFilter && !contentType?.match(req.typeFilter)) {
			throw new Error(`Rejected by type filter ${contentType}`);
		}

		// Size check by the response header
		const contentLength = res.headers['content-length'];
		if (contentLength) {
			const maxSize = req.contentLengthLimit;
			const size = Number(contentLength);
			if (size > maxSize) {
				throw new Error(`maxSize exceeded (${size} > ${maxSize}) on response`);
			}
		} else if (req.contentLengthRequired) {
			throw new Error('content-length required');
		}
	} catch (e) {
		res.destroy();
		throw e;
	}

	const hasNoBody = req.method === 'HEAD'
		|| (statusCode >= 100 && statusCode < 200)
		|| statusCode === 204 || statusCode === 205 || statusCode === 304;
	const encoding = hasNoBody ? undefined : res.headers['content-encoding']?.trim().toLowerCase();
	const decompressor = encoding ? createDecompressor(encoding) : null;
	const body = await readBody(res, decompressor, req.contentLengthLimit);

	let headers = res.headers;
	if (decompressor) {
		// Like got: headers describe the decompressed body.
		headers = { ...res.headers };
		delete headers['content-encoding'];
		delete headers['content-length'];
	}

	const finalUrl = new URL(url);
	finalUrl.username = '';
	finalUrl.password = '';
	return { url: finalUrl.href, statusCode, headers, body };
}

function maxSizeExceeded(size: number, maxSize: number): Error {
	return new Error(`maxSize exceeded (${size} > ${maxSize}) on response`);
}

/**
 * Reads the whole body, decompressed when `decompressor` is given, with the size checked while receiving.
 * Counts decompressed bytes, and also the compressed bytes on the wire, so input that decompresses to little
 * (e.g. endless empty gzip members) cannot stream unbounded.
 *
 * Wired by hand rather than with `stream/promises` pipeline, which builds an AbortController (and a DOMException
 * on completion) for every call. Like pipeline it rejects when the response ends early (connection reset or
 * premature close), and on any failure destroys the response (so its socket is never reused) and the decompressor.
 * Its error listeners stay attached, so errors after settling never go unhandled.
 */
function readBody(res: http.IncomingMessage, decompressor: Transform | null, maxSize: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		let settled = false;
		let resEnded = false;

		const fail = (err: Error) => {
			if (settled) return;
			settled = true;
			res.destroy();
			decompressor?.destroy();
			reject(err);
		};
		const collect = (chunk: Buffer) => {
			if (settled) return;
			size += chunk.length;
			if (size > maxSize) {
				fail(maxSizeExceeded(size, maxSize));
				return;
			}
			chunks.push(chunk);
		};
		const done = () => {
			if (settled) return;
			settled = true;
			resolve(Buffer.concat(chunks, size));
		};

		res.on('error', fail);
		res.on('end', () => {
			resEnded = true;
		});
		res.on('close', () => {
			if (!resEnded) fail(prematureClose());
		});

		if (!decompressor) {
			res.on('data', collect);
			res.on('end', done);
			return;
		}

		let wireSize = 0;
		decompressor.on('error', fail);
		decompressor.on('data', collect);
		decompressor.on('end', done);
		res.on('data', (chunk: Buffer) => {
			if (settled) return;
			wireSize += chunk.length;
			if (wireSize > maxSize) {
				fail(maxSizeExceeded(wireSize, maxSize));
				return;
			}
			if (!decompressor.write(chunk)) {
				res.pause();
				decompressor.once('drain', () => res.resume());
			}
		});
		res.on('end', () => {
			if (!settled) decompressor.end();
		});
	});
}

function prematureClose(): Error {
	const err: NodeJS.ErrnoException = new Error('Premature close');
	err.code = 'ERR_STREAM_PREMATURE_CLOSE';
	return err;
}

function createDecompressor(encoding: string): Transform | null {
	switch (encoding) {
		case 'gzip':
		case 'x-gzip':
		case 'deflate':
		case 'br':
			return new Decompressor(encoding);
		default:
			// Unknown encodings are passed through untouched (same as got).
			return null;
	}
}

/**
 * Picks the zlib stream on the first chunk (raw deflate vs zlib-wrapped, as decompress-response does),
 * and yields an empty body for an empty input instead of a zlib error.
 */
class Decompressor extends Transform {
	readonly #encoding: string;
	#inner: zlib.Unzip | zlib.InflateRaw | zlib.BrotliDecompress | undefined;

	constructor(encoding: string) {
		super();
		this.#encoding = encoding;
	}

	#createInner(first: Buffer) {
		if (this.#encoding === 'br') return zlib.createBrotliDecompress();
		if (this.#encoding === 'deflate' && (first.readUInt8(0) & 0x08) === 0) return zlib.createInflateRaw();
		return zlib.createUnzip();
	}

	override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
		if (!this.#inner) {
			const inner = this.#createInner(chunk);
			inner.on('data', (data: Buffer) => this.push(data));
			inner.on('error', err => this.destroy(err));
			this.#inner = inner;
		}
		this.#inner.write(chunk, () => callback());
	}

	override _flush(callback: TransformCallback) {
		if (!this.#inner) {
			callback();
			return;
		}
		this.#inner.once('end', () => callback());
		this.#inner.end();
	}

	override _destroy(err: Error | null, callback: (error?: Error | null) => void) {
		this.#inner?.destroy();
		callback(err);
	}
}

/** Stable reorder putting IPv4 addresses before IPv6 ones. */
function ipv4First(addresses: string[]): string[] {
	return [...addresses.filter(a => net.isIPv4(a)), ...addresses.filter(a => !net.isIPv4(a))];
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		signal.addEventListener('abort', onAbort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
	});
}
