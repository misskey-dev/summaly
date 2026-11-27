/** Longest message sent back (characters). A message can quote remote content, such as a site name. */
const MAX_MESSAGE_LENGTH = 1024;

/**
 * Why a summary failed, as `GET /` answers it in `{ error }` with status 500. Never includes the stack.
 */
export type SummalyErrorBody = {
	/** Error class name, e.g. `StatusError`, `TypeError` */
	name: string;
	/** Error message, cut to 1024 characters */
	message: string;
	/** For a failed HTTP response (StatusError): its status, e.g. 404 */
	statusCode?: number;
	/** For a failed HTTP response (StatusError): its status message, e.g. `Not Found` */
	statusMessage?: string;
	/** For a failed HTTP response (StatusError): whether retrying cannot help (a 4xx status) */
	isPermanentError?: boolean;
	/** For a Node.js system error: its code, e.g. `ENOTFOUND`, `ECONNREFUSED` */
	code?: string;
};

/** The response body for an error thrown by a summary. */
export function toErrorBody(error: unknown): SummalyErrorBody {
	if (!(error instanceof Error)) {
		return { name: 'Error', message: String(error).slice(0, MAX_MESSAGE_LENGTH) };
	}
	const body: SummalyErrorBody = { name: error.name, message: error.message.slice(0, MAX_MESSAGE_LENGTH) };
	const { statusCode, statusMessage, isPermanentError, code } = error as Error & Partial<Omit<SummalyErrorBody, 'name' | 'message'>>;

	if (typeof statusCode === 'number') {
		body.statusCode = statusCode;
	}
	if (typeof statusMessage === 'string') {
		body.statusMessage = statusMessage;
	}
	if (typeof isPermanentError === 'boolean') {
		body.isPermanentError = isPermanentError;
	}
	if (typeof code === 'string') {
		body.code = code;
	}

	return body;
}
