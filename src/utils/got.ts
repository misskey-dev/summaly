import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import got, * as Got from 'got';
import * as cheerio from 'cheerio';
import PrivateIp from 'private-ip';
import { StatusError } from './status-error.js';
import { detectEncoding, toUtf8 } from './encoding.js';

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);

export let agent: Got.Agents = {};

export function setAgent(_agent: Got.Agents) {
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	agent = _agent || {};
}

export type GotOptions = {
	url: string;
	method: 'GET' | 'POST' | 'HEAD';
	body?: string;
	headers: Record<string, string | undefined>;
	typeFilter?: RegExp;
	responseTimeout?: number;
	operationTimeout?: number;
	contentLengthLimit?: number;
	contentLengthRequired?: boolean;
}

const repo = JSON.parse(readFileSync(`${_dirname}/../../package.json`, 'utf8'));

const DEFAULT_RESPONSE_TIMEOUT = 20 * 1000;
const DEFAULT_OPERATION_TIMEOUT = 60 * 1000;
const DEFAULT_MAX_RESPONSE_SIZE = 10 * 1024 * 1024;
const DEFAULT_BOT_UA = `SummalyBot/${repo.version}`;

export async function scpaping(
	url: string,
	opts?: {
		lang?: string;
		userAgent?: string;
		responseTimeout?: number;
		operationTimeout?: number;
		contentLengthLimit?: number;
		contentLengthRequired?: boolean;
	},
) {
	const args: Omit<GotOptions, 'method'> = {
		url,
		headers: {
			'accept': 'text/html,application/xhtml+xml',
			'user-agent': opts?.userAgent ?? DEFAULT_BOT_UA,
			'accept-language': opts?.lang,
		},
		typeFilter: /^(text\/html|application\/xhtml\+xml)/,
		responseTimeout: opts?.responseTimeout,
		operationTimeout: opts?.operationTimeout,
		contentLengthLimit: opts?.contentLengthLimit,
		contentLengthRequired: opts?.contentLengthRequired,
	};

	const headResponse = await getResponse({
		...args,
		method: 'HEAD',
	});

	// SUMMALY_ALLOW_PRIVATE_IPはテスト用
	const allowPrivateIp = process.env.SUMMALY_ALLOW_PRIVATE_IP === 'true' || Object.keys(agent).length > 0;
	if (!allowPrivateIp && headResponse.ip && PrivateIp(headResponse.ip)) {
		throw new StatusError(`Private IP rejected ${headResponse.ip}`, 400, 'Private IP Rejected');
	}

	const response = await getResponse({
		...args,
		method: 'GET',
	});

	const encoding = detectEncoding(response.rawBody);
	const body = toUtf8(response.rawBody, encoding);
	const $ = cheerio.load(body);

	return {
		body,
		$,
		response,
	};
}

export async function get(url: string) {
	const res = await getResponse({
		url,
		method: 'GET',
		headers: {
			'accept': '*/*',
		},
	});

	return res.body;
}

export async function head(url: string) {
	return await getResponse({
		url,
		method: 'HEAD',
		headers: {
			'accept': '*/*',
		},
	});
}

async function getResponse(args: GotOptions) {
	const timeout = args.responseTimeout ?? DEFAULT_RESPONSE_TIMEOUT;
	const operationTimeout = args.operationTimeout ?? DEFAULT_OPERATION_TIMEOUT;

	const req = got<string>(args.url, {
		method: args.method,
		headers: args.headers,
		body: args.body,
		timeout: {
			lookup: timeout,
			connect: timeout,
			secureConnect: timeout,
			socket: timeout,	// read timeout
			response: timeout,
			send: timeout,
			request: operationTimeout,	// whole operation timeout
		},
		agent,
		http2: false,
		retry: {
			limit: 0,
		},
	});

	const res = await receiveResponse({ req, opts: args });

	// Check html
	const contentType = res.headers['content-type'];
	if (args.typeFilter && !contentType?.match(args.typeFilter)) {
		throw new Error(`Rejected by type filter ${contentType}`);
	}

	// 応答ヘッダでサイズチェック
	const contentLength = res.headers['content-length'];
	if (contentLength) {
		const maxSize = args.contentLengthLimit ?? DEFAULT_MAX_RESPONSE_SIZE;
		const size = Number(contentLength);
		if (size > maxSize) {
			throw new Error(`maxSize exceeded (${size} > ${maxSize}) on response`);
		}
	} else {
		if (args.contentLengthRequired) {
			throw new Error('content-length required');
		}
	}

	return res;
}

async function receiveResponse<T>(args: {
	req: Got.CancelableRequest<Got.Response<T>>,
	opts: GotOptions,
}) {
	const req = args.req;
	const maxSize = args.opts.contentLengthLimit ?? DEFAULT_MAX_RESPONSE_SIZE;

	// 受信中のデータでサイズチェック
	req.on('downloadProgress', (progress: Got.Progress) => {
		if (progress.transferred > maxSize && progress.percent !== 1) {
			req.cancel(`maxSize exceeded (${progress.transferred} > ${maxSize}) on response`);
		}
	});

	// 応答取得 with ステータスコードエラーの整形
	const res = await req.catch(e => {
		if (e instanceof Got.HTTPError) {
			throw new StatusError(`${e.response.statusCode} ${e.response.statusMessage}`, e.response.statusCode, e.response.statusMessage);
		} else {
			throw e;
		}
	});

	return res;
}
