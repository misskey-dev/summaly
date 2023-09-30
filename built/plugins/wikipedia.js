import { get } from '../utils/got.js';
import debug from 'debug';
import clip from './../utils/clip.js';
const log = debug('summaly:plugins:wikipedia');
export function test(url) {
    if (!url.hostname)
        return false;
    return /\.wikipedia\.org$/.test(url.hostname);
}
export async function summarize(url) {
    const lang = url.host ? url.host.split('.')[0] : null;
    const title = url.pathname ? url.pathname.split('/')[2] : null;
    const endpoint = `https://${lang}.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&exintro=&explaintext=&titles=${title}`;
    log(`lang is ${lang}`);
    log(`title is ${title}`);
    log(`endpoint is ${endpoint}`);
    let body = await get(endpoint);
    body = JSON.parse(body);
    log(body);
    if (!('query' in body) || !('pages' in body.query)) {
        throw 'fetch failed';
    }
    const info = body.query.pages[Object.keys(body.query.pages)[0]];
    return {
        title: info.title,
        icon: 'https://wikipedia.org/static/favicon/wikipedia.ico',
        description: clip(info.extract, 300),
        thumbnail: `https://wikipedia.org/static/images/project-logos/${lang}wiki.png`,
        player: {
            url: null,
            width: null,
            height: null,
            allow: [],
        },
        sitename: 'Wikipedia',
        activityPub: null,
    };
}
