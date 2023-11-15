import general from '../general.js';
export function test(url) {
    // Branch.io を使用したディープリンクにマッチ
    return /^[a-zA-Z0-9]+\.app\.link$/.test(url.hostname) ||
        url.hostname === 'spotify.link';
}
export async function summarize(url, lang = null) {
    // https://help.branch.io/using-branch/docs/creating-a-deep-link#redirections
    // Web版に強制リダイレクトすることでbranch.ioの独自ページが開くのを防ぐ
    url.searchParams.append('$web_only', 'true');
    return await general(url, lang);
}
