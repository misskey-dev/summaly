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
}

const repo = JSON.parse(readFileSync(`${_dirname}/../../package.json`, 'utf8'));

const RESPONSE_TIMEOUT = 20 * 1000;
const OPERATION_TIMEOUT = 60 * 1000;
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;
const BOT_UA = `SummalyBot/${repo.version}`;

export async function scpaping(url: string, opts?: { lang?: string; }) {
	const response = await getResponse({
		url,
		method: 'GET',
		headers: {
			'accept': 'text/html,application/xhtml+xml',
			'user-agent': BOT_UA,
			'accept-language': opts?.lang,
		},
		typeFilter: /^(text\/html|application\/xhtml\+xml)/,
	});

	// SUMMALY_ALLOW_PRIVATE_IPはテスト用
	const allowPrivateIp = process.env.SUMMALY_ALLOW_PRIVATE_IP === 'true' || Object.keys(agent).length > 0;

	if (!allowPrivateIp && response.ip && PrivateIp(response.ip)) {
		throw new StatusError(`Private IP rejected ${response.ip}`, 400, 'Private IP Rejected');
	}

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

	return await res.body;
}

export async function head(url: string) {
	const res = await getResponse({
		url,
		method: 'HEAD',
		headers: {
			'accept': '*/*',
		},
	});

	return await res;
}

async function getResponse(args: GotOptions) {
	const timeout = RESPONSE_TIMEOUT;
	const operationTimeout = OPERATION_TIMEOUT;

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

	return await receiveResponse({ req, typeFilter: args.typeFilter });
}

async function receiveResponse<T>(args: { req: Got.CancelableRequest<Got.Response<T>>, typeFilter?: RegExp }) {
	const req = args.req;
	const maxSize = MAX_RESPONSE_SIZE;

	req.on('response', (res: Got.Response) => {
		// Check html
		if (args.typeFilter && !res.headers['content-type']?.match(args.typeFilter)) {
			// console.warn(res.headers['content-type']);
			req.cancel(`Rejected by type filter ${res.headers['content-type']}`);
			return;
		}

		// 応答ヘッダでサイズチェック
		const contentLength = res.headers['content-length'];
		if (contentLength != null) {
			const size = Number(contentLength);
			if (size > maxSize) {
				req.cancel(`maxSize exceeded (${size} > ${maxSize}) on response`);
			}
		}
	});

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
