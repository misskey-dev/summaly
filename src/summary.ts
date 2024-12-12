type Summary = {
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

// eslint-disable-next-line import/no-default-export
export default Summary;

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
