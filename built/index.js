/**
 * summaly
 * https://github.com/syuilo/summaly
 */
import { URL } from 'node:url';
import tracer from 'trace-redirect';
import general from './general.js';
import { setAgent } from './utils/got.js';
import { plugins as builtinPlugins } from './plugins/index.js';
const defaultOptions = {
    lang: null,
    followRedirects: true,
    plugins: [],
};
/**
 * Summarize an web page
 */
export const summaly = async (url, options) => {
    if (options?.agent)
        setAgent(options.agent);
    const opts = Object.assign(defaultOptions, options);
    const plugins = builtinPlugins.concat(opts.plugins || []);
    let actualUrl = url;
    if (opts.followRedirects) {
        // .catch(() => url)にすればいいけど、jestにtrace-redirectを食わせるのが面倒なのでtry-catch
        try {
            actualUrl = await tracer(url);
        }
        catch (e) {
            actualUrl = url;
        }
    }
    const _url = new URL(actualUrl);
    // Find matching plugin
    const match = plugins.filter(plugin => plugin.test(_url))[0];
    // Get summary
    const summary = await (match ? match.summarize : general)(_url, opts.lang || undefined);
    if (summary == null) {
        throw 'failed summarize';
    }
    return Object.assign(summary, {
        url: actualUrl
    });
};
export default function (fastify, options, done) {
    fastify.get('/', async (req, reply) => {
        const url = req.query.url;
        if (url == null) {
            return reply.status(400).send({
                error: 'url is required'
            });
        }
        try {
            const summary = await summaly(url, {
                lang: req.query.lang,
                followRedirects: false,
                ...options,
            });
            return summary;
        }
        catch (e) {
            return reply.status(500).send({
                error: e
            });
        }
    });
    done();
}
