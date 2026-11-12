import type * as http from 'node:http';
import type * as https from 'node:https';
import type { InflightCoordinator, SummaryCache } from '@/coalesce/types.js';
import type { SummalyPlugin } from '@/plugin/define.js';

export type Summary = {
	/**
	 * The title of that web page
	 */
	title: string | null;

	/**
	 * The url of the icon of that web page
	 */
	icon: string | null;

	/**
	 * The description of that web page
	 */
	description: string | null;

	/**
	 * The url of the thumbnail of that web page
	 */
	thumbnail: string | null;

	/**
	 * The display style of the thumbnail of that web page
	 */
	thumbnailStyle: 'summary' | 'summary_large_image' | null;

	/**
	 * The name of site of that web page
	 */
	sitename: string | null;

	/**
	 * The player of that web page
	 */
	player: Player;

	/**
	 * Possibly sensitive
	 */
	sensitive?: boolean;

	/**
	 * The url of the ActivityPub representation of that web page
	 */
	activityPub: string | null;

	/**
	* The @ handle of a fediverse user (https://blog.joinmastodon.org/2024/07/highlighting-journalism-on-mastodon/)
	*/
	fediverseCreator: string | null;
};

export type SummalyResult = Summary & {
	/**
	 * The actual url of that web page
	 */
	url: string;
};

export type Player = {
	/**
	 * The url of the player
	 */
	url: string | null;

	/**
	 * The width of the player
	 */
	width: number | null;

	/**
	 * The height of the player
	 */
	height: number | null;

	/**
	 * The allowed permissions of the iframe
	 */
	allow: string[];
};

export type ProxyOptions = {
	/**
	 * Proxy URL for http: targets
	 */
	http?: string;

	/**
	 * Proxy URL for https: targets
	 */
	https?: string;

	/**
	 * Comma-separated host list that bypasses the proxy (same format as NO_PROXY)
	 */
	noProxy?: string;
};

export type SummalyOptions = {
	/**
	 * Accept-Language for the request
	 */
	lang?: string | null;

	/**
	 * Whether follow redirects
	 */
	followRedirects?: boolean;

	/**
	 * Plugins made with defineSummalyPlugin (`@misskey-dev/summaly/plugin`), tried in order before the built-in ones
	 */
	plugins?: readonly SummalyPlugin[];

	/**
	 * Custom HTTP agent
	 */
	agent?: { http?: http.Agent; https?: https.Agent };

	/**
	 * User-Agent for the request
	 */
	userAgent?: string;

	/**
	 * Response timeout.
	 * Set timeouts for each phase, such as host name resolution and socket communication.
	 */
	responseTimeout?: number;

	/**
	 * Operation timeout.
	 * Set the timeout from the start to the end of the request.
	 */
	operationTimeout?: number;

	/**
	 * Maximum content length.
	 * If set to true, an error will occur if the content-length value returned from the other server is larger than this parameter (or if the received body size exceeds this parameter).
	 */
	contentLengthLimit?: number;

	/**
	 * Content length required.
	 * If set to true, it will be an error if the other server does not return content-length.
	 */
	contentLengthRequired?: boolean;

	/**
	 * CIDR list of private networks that are exempt from the private IP block
	 */
	allowedPrivateNetworks?: string[];

	/**
	 * Outbound proxy settings
	 */
	proxy?: ProxyOptions;

	/**
	 * Result cache. Pass false to disable
	 */
	cache?: SummaryCache | false;

	/**
	 * TTL of successful results in the cache (ms). Also used for favicon checks whose HEAD succeeded
	 */
	cacheTtl?: number;

	/**
	 * TTL of failures in the cache (ms). Also used for favicon checks whose HEAD failed (icon is null)
	 */
	errorCacheTtl?: number;

	/**
	 * Coordinator that shares in-flight requests for the same key. Pass false to disable.
	 * Its `run` is called again, with another key, from inside a running task (see InflightCoordinator)
	 */
	coordinator?: InflightCoordinator | false;
};

