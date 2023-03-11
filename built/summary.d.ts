declare type Summary = {
    /**
     * The description of that web page
     */
    description: string | null;
    /**
     * The url of the icon of that web page
     */
    icon: string | null;
    /**
     * The name of site of that web page
     */
    sitename: string | null;
    /**
     * The url of the thumbnail of that web page
     */
    thumbnail: string | null;
    /**
     * The player of that web page
     */
    player: Player;
    /**
     * The title of that web page
     */
    title: string | null;
    /**
     * Possibly sensitive
     */
    sensitive?: boolean;
    /**
     * The iframe information of oEmbed data from that web page
     */
    oEmbed: OEmbedRichIframe | null;
};
export default Summary;
export declare type Player = {
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
};
/**
 * Extracted iframe information from OEmbed html field.
 * `width` is omitted here as it should always be 100%.
 */
export declare type OEmbedRichIframe = {
    /**
     * The src of the iframe
     */
    src: string;
    /**
     * The height of the iframe
     */
    height: number;
    /**
     * The allowed feature list of the iframe
     */
    allow: string[];
};
